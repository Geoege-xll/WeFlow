import { createHash, randomUUID } from 'crypto'
import type { OmniMindFailureStage, OmniMindSendResult } from '../../shared/omnimind/contracts'
import type { DeliveryDiagnosticInput } from './delivery-diagnostics'

export type SendPriority = 'manual' | 'auto'
export type SendResult = OmniMindSendResult
export type RecoverySendResult =
  | { result: 'confirmed_sent'; providerMessageId: string }
  | { result: 'not_sent'; failureCode: string }
  | { result: 'result_unknown'; failureCode: string }
interface InternalSendResult extends OmniMindSendResult { verifiedMessageKey?: string }
type TransactionDiagnosticInput = Omit<DeliveryDiagnosticInput, 'correlationId'>

interface Waiter<T> { priority: SendPriority; operation: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }

export class PrioritySendMutex {
  private active = false
  private readonly waiters: Array<Waiter<unknown>> = []
  private idleResolvers: Array<() => void> = []

  run<T>(priority: SendPriority, operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiters.push({ priority, operation, resolve: resolve as (value: unknown) => void, reject })
      this.pump()
    })
  }

  whenIdle(): Promise<void> {
    if (!this.active && this.waiters.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleResolvers.push(resolve))
  }

  private pump(): void {
    if (this.active || this.waiters.length === 0) return
    const manualIndex = this.waiters.findIndex((waiter) => waiter.priority === 'manual')
    const [waiter] = this.waiters.splice(manualIndex >= 0 ? manualIndex : 0, 1)
    this.active = true
    void waiter.operation().then(waiter.resolve, waiter.reject).finally(() => {
      this.active = false
      this.pump()
      if (!this.active && this.waiters.length === 0) this.idleResolvers.splice(0).forEach((resolve) => resolve())
    })
  }
}

export interface SendTextAdapter { sendText(input: { accountId: string; sessionId: string; conversationTitle?: string; text: string }): Promise<{ success: boolean; error?: string; stage?: OmniMindFailureStage; sentAt?: number; actionMayHaveOccurred?: boolean; cleanupWarnings?: string[] }> }
export interface OutboundVerifier {
  captureBaseline(input: { accountId: string; sessionId: string }): Promise<unknown>
  verify(input: { accountId: string; sessionId: string; text: string; sentAt: number; watermark?: unknown }): Promise<{ success: boolean; error?: string; verifiedMessageKey?: string }>
}

export class UnifiedSender {
  private readonly mutex = new PrioritySendMutex()
  private readonly pendingAutomatic = new Set<{
    accountId: string
    sessionId: string
    acquired: boolean
    cancelled: boolean
  }>()

  constructor(private readonly dependencies: {
    cancelForManualSend: (accountId: string, sessionId: string) => string[]
    adapter: SendTextAdapter
    verifier: OutboundVerifier
    recordDiagnostic?: (input: DeliveryDiagnosticInput) => void | Promise<void>
    createCorrelationId?: () => string
    now?: () => number
  }) {}

  async sendManual(
    input: { accountId: string; sessionId: string; conversationTitle?: string; text: string },
    authorize?: () => Promise<{ success: false; error: string } | undefined>
  ): Promise<SendResult> {
    for (const command of this.pendingAutomatic) {
      if (!command.acquired && command.accountId === input.accountId && command.sessionId === input.sessionId) {
        command.cancelled = true
      }
    }
    return this.send('manual', input, {
      onAcquire: () => undefined,
      isCancelled: () => false,
      authorize,
      onAuthorized: () => { this.dependencies.cancelForManualSend(input.accountId, input.sessionId) }
    }).then(({ verifiedMessageKey: _privateReceipt, ...result }) => result)
  }

  sendAutomatic(
    input: { accountId: string; sessionId: string; conversationTitle?: string; text: string },
    control: { onAcquire: () => void; isCancelled: () => boolean; authorize?: () => Promise<{ success: false; error: string } | undefined>; onAuthorized?: () => void } = { onAcquire: () => undefined, isCancelled: () => false }
  ): Promise<SendResult> {
    return this.sendAutomaticInternal(input, control)
      .then(({ verifiedMessageKey: _privateReceipt, ...result }) => result)
  }

  /**
   * 已审核恢复投递与普通自动回复共用同一个 mutex、授权回调和渠道验证器。
   * 唯一差异是本方法在 Electron main 内把 WCDB messageKey 摘要成稳定 providerMessageId，
   * 供服务端 ACK 幂等使用；原始 key 绝不进入公开合同、renderer、日志或 journal。
   */
  sendRecoveryDelivery(
    input: { accountId: string; sessionId: string; conversationTitle?: string; text: string },
    control: { onAcquire: () => void; isCancelled: () => boolean; authorize: () => Promise<{ success: false; error: string } | undefined> }
  ): Promise<RecoverySendResult> {
    return this.sendAutomaticInternal(input, control).then((result) => {
      if (result.success && result.verifiedMessageKey) {
        return {
          result: 'confirmed_sent' as const,
          providerMessageId: `sha256:${createHash('sha256').update(result.verifiedMessageKey, 'utf8').digest('hex')}`
        }
      }
      // adapter 可能已执行动作但 WCDB 无法确认，此时 UnifiedSender 固定使用 verification_postsend；
      // 该状态必须对账为 result_unknown，绝不能因为 success=false 自动重发。
      if (result.success || result.stage === 'verification_postsend') {
        return { result: 'result_unknown' as const, failureCode: 'wechat_send_result_unknown' }
      }
      const localCode = String(result.error || 'wechat_not_sent').trim().toLowerCase()
      return {
        result: 'not_sent' as const,
        failureCode: /^[a-z0-9_]{1,64}$/.test(localCode) ? localCode : 'wechat_not_sent'
      }
    })
  }

  private sendAutomaticInternal(
    input: { accountId: string; sessionId: string; conversationTitle?: string; text: string },
    control: { onAcquire: () => void; isCancelled: () => boolean; authorize?: () => Promise<{ success: false; error: string } | undefined>; onAuthorized?: () => void } = { onAcquire: () => undefined, isCancelled: () => false }
  ): Promise<InternalSendResult> {
    const command = {
      accountId: input.accountId,
      sessionId: input.sessionId,
      acquired: false,
      cancelled: false
    }
    this.pendingAutomatic.add(command)
    return this.send('auto', input, {
      isCancelled: () => command.cancelled || control.isCancelled(),
      onAcquire: () => {
        command.acquired = true
        control.onAcquire()
      },
      authorize: control.authorize,
      onAuthorized: control.onAuthorized
    }).finally(() => this.pendingAutomatic.delete(command))
  }

  whenIdle(): Promise<void> { return this.mutex.whenIdle() }

  private send(
    priority: SendPriority,
    input: { accountId: string; sessionId: string; conversationTitle?: string; text: string },
    control: { onAcquire: () => void; isCancelled: () => boolean; authorize?: () => Promise<{ success: false; error: string } | undefined>; onAuthorized?: () => void } = { onAcquire: () => undefined, isCancelled: () => false }
  ): Promise<InternalSendResult> {
    return this.mutex.run(priority, async () => {
      const correlationId = this.dependencies.createCorrelationId?.() ?? randomUUID()
      if (control.isCancelled()) return { success: false, error: 'cancelled_before_sending' }
      const authorizationFailure = await control.authorize?.()
      if (control.isCancelled()) return { success: false, error: 'cancelled_before_sending' }
      if (authorizationFailure) {
        await this.recordDiagnostics(correlationId, [{ stage: 'authorization', terminalState: 'send_failed', reason: authorizationFailure.error }])
        return { ...authorizationFailure, stage: 'authorization' }
      }
      control.onAuthorized?.()
      control.onAcquire()
      let watermark: unknown
      try {
        watermark = await this.dependencies.verifier.captureBaseline(input)
      } catch {
        await this.recordDiagnostics(correlationId, [{ stage: 'verification_baseline', terminalState: 'send_failed', reason: 'verification_baseline_failed' }])
        return { success: false, stage: 'verification_baseline', error: 'verification_baseline_failed' }
      }
      let sent: Awaited<ReturnType<SendTextAdapter['sendText']>>
      try {
        sent = await this.dependencies.adapter.sendText(input)
      } catch {
        sent = { success: false, stage: 'automation', error: 'automation_failed', actionMayHaveOccurred: true, sentAt: this.dependencies.now?.() ?? Date.now() }
      }
      if (!sent.success && !sent.actionMayHaveOccurred) {
        const stage = sent.stage ?? 'automation'
        const error = sent.error ?? 'automation_failed'
        await this.recordDiagnostics(correlationId, [
          { stage, terminalState: 'send_failed', reason: error },
          ...(sent.cleanupWarnings ?? []).map((reason) => ({ stage: 'cleanup' as const, terminalState: 'send_failed' as const, reason }))
        ])
        return { success: false, stage, error }
      }
      let verified: Awaited<ReturnType<OutboundVerifier['verify']>>
      try {
        verified = await this.dependencies.verifier.verify({ ...input, sentAt: sent.sentAt ?? this.dependencies.now?.() ?? Date.now(), watermark })
      } catch {
        verified = { success: false, error: 'verification_read_failed' }
      }
      const terminalState: TransactionDiagnosticInput['terminalState'] = verified.success ? 'sent' : 'delivery_unconfirmed'
      await this.recordDiagnostics(correlationId, [
        ...(!sent.success && sent.error ? [{ stage: sent.stage ?? 'automation' as const, terminalState, reason: sent.error }] : []),
        ...(!verified.success ? [{ stage: 'verification_postsend' as const, terminalState, reason: verified.error ?? 'outbound_not_verified' }] : []),
        ...(sent.cleanupWarnings ?? []).map((reason) => ({ stage: 'cleanup' as const, terminalState, reason }))
      ])
      return verified.success
        ? { success: true, ...(verified.verifiedMessageKey ? { verifiedMessageKey: verified.verifiedMessageKey } : {}) }
        : { ...verified, stage: 'verification_postsend' }
    })
  }

  private async recordDiagnostics(correlationId: string, entries: TransactionDiagnosticInput[]): Promise<void> {
    for (const entry of entries) {
      try { await this.dependencies.recordDiagnostic?.({ correlationId, ...entry }) } catch { /* Diagnostics never change delivery state. */ }
    }
  }
}
