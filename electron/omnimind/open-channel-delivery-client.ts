import { createHash } from 'crypto'
import type {
  OpenRecoveryDeliveryClaim,
  OpenRecoveryDeliveryItem,
  OpenRecoveryDeliveryStatus
} from '../../shared/omnimind/contracts'
import { OPEN_CHAT_CHANNEL_IDENTITY } from '../../shared/app-identity'
import type { PersistentDeliveryJournal, PersistedDeliveryEntry } from './persistent-delivery-journal'
import type { RecoverySendResult } from './unified-sender'

type ClientFailureKind = 'network' | 'auth' | 'not_found' | 'conflict' | 'rejected' | 'malformed'

export class OpenDeliveryClientError extends Error {
  constructor(readonly kind: ClientFailureKind) {
    // Error.message 只保留本地稳定码，绝不拼接 Response body、URL、Key 或渠道身份。
    super(kind)
    this.name = 'OpenDeliveryClientError'
  }
}

interface DeliveryScope {
  sourceApplication: typeof OPEN_CHAT_CHANNEL_IDENTITY.application
  sourceChannel: typeof OPEN_CHAT_CHANNEL_IDENTITY.channel
  sourceInstanceId: string
}

interface ClientContext extends DeliveryScope {
  baseUrl: string
  apiKey: string
}

interface StrictRecord { [key: string]: unknown }

const isRecord = (value: unknown): value is StrictRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const strictRecord = (value: unknown, keys: readonly string[]): StrictRecord => {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new OpenDeliveryClientError('malformed')
  return value
}

const requiredString = (record: StrictRecord, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new OpenDeliveryClientError('malformed')
  return value.trim()
}

const optionalString = (record: StrictRecord, key: string): string | undefined => {
  const value = record[key]
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new OpenDeliveryClientError('malformed')
  return value.trim()
}

const positiveInteger = (record: StrictRecord, key: string): number => {
  const value = record[key]
  if (!Number.isInteger(value) || Number(value) <= 0) throw new OpenDeliveryClientError('malformed')
  return Number(value)
}

const DELIVERY_STATUSES = ['queued', 'claimed', 'acknowledged', 'failed', 'result_unknown'] as const
const DELIVERY_RESULTS = ['pending', 'confirmed_sent', 'not_sent', 'result_unknown'] as const

/**
 * Open API Key 只存在于 Electron main 的请求 Header。所有响应都按字段白名单重新投影，
 * 即使服务端未来误加 raw external id、provider receipt 或异常正文，本客户端也会拒绝整个响应。
 */
export class OpenChannelDeliveryClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async list(context: ClientContext, signal?: AbortSignal): Promise<OpenRecoveryDeliveryItem[]> {
    const payload = await this.request(context, '', { method: 'GET' }, signal)
    const data = strictRecord(payload, ['items', 'total'])
    if (!Array.isArray(data.items) || !Number.isInteger(data.total) || Number(data.total) < 0 || data.total !== data.items.length) {
      throw new OpenDeliveryClientError('malformed')
    }
    return data.items.map((value) => {
      const item = strictRecord(value, [
        'delivery_id', 'fulfillment_id', 'attempt_number', 'parent_delivery_id',
        'session_reference', 'route_reference', 'content', 'status'
      ])
      if (item.status !== 'queued' || typeof item.content !== 'string' || !item.content.trim()) throw new OpenDeliveryClientError('malformed')
      return {
        deliveryId: requiredString(item, 'delivery_id'),
        fulfillmentId: requiredString(item, 'fulfillment_id'),
        attemptNumber: positiveInteger(item, 'attempt_number'),
        ...(optionalString(item, 'parent_delivery_id') ? { parentDeliveryId: optionalString(item, 'parent_delivery_id') } : {}),
        sessionReference: requiredString(item, 'session_reference'),
        routeReference: requiredString(item, 'route_reference'),
        content: item.content,
        status: 'queued' as const
      }
    })
  }

  async get(context: ClientContext, deliveryId: string, signal?: AbortSignal): Promise<OpenRecoveryDeliveryStatus> {
    return this.parseStatus(await this.request(context, `/${encodeURIComponent(deliveryId)}`, { method: 'GET' }, signal))
  }

  async claim(context: ClientContext, deliveryId: string, leaseOwner: string, signal?: AbortSignal): Promise<OpenRecoveryDeliveryClaim> {
    const payload = await this.request(context, `/${encodeURIComponent(deliveryId)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ lease_owner: leaseOwner, lease_seconds: 300 })
    }, signal)
    const data = strictRecord(payload, ['delivery_id', 'lease_token', 'lease_expires_at', 'fencing_token'])
    const leaseExpiresAt = requiredString(data, 'lease_expires_at')
    if (!Number.isFinite(Date.parse(leaseExpiresAt))) throw new OpenDeliveryClientError('malformed')
    return {
      deliveryId: requiredString(data, 'delivery_id'),
      leaseToken: requiredString(data, 'lease_token'),
      leaseExpiresAt,
      fencingToken: positiveInteger(data, 'fencing_token')
    }
  }

  acknowledge(context: ClientContext, entry: PersistedDeliveryEntry, signal?: AbortSignal): Promise<OpenRecoveryDeliveryStatus> {
    if (!entry.providerMessageId) throw new OpenDeliveryClientError('malformed')
    return this.terminal(context, entry, 'ack', {
      result: 'confirmed_sent',
      provider_message_id: entry.providerMessageId,
      ack_code: 'wechat_verified'
    }, signal)
  }

  notSent(context: ClientContext, entry: PersistedDeliveryEntry, signal?: AbortSignal): Promise<OpenRecoveryDeliveryStatus> {
    return this.terminal(context, entry, 'not-sent', {
      result: 'not_sent',
      failure_code: entry.failureCode ?? 'connector_not_sent'
    }, signal)
  }

  resultUnknown(context: ClientContext, entry: PersistedDeliveryEntry, signal?: AbortSignal): Promise<OpenRecoveryDeliveryStatus> {
    return this.terminal(context, entry, 'result-unknown', {
      result: 'result_unknown',
      failure_code: entry.failureCode ?? 'connector_result_unknown'
    }, signal)
  }

  private async terminal(
    context: ClientContext,
    entry: PersistedDeliveryEntry,
    action: 'ack' | 'not-sent' | 'result-unknown',
    facts: Record<string, string>,
    signal?: AbortSignal
  ): Promise<OpenRecoveryDeliveryStatus> {
    // claim_pending/reconcile_pending 可能没有完整租约；它们只能走 claim 或 GET 对账，
    // 绝不能构造一个带 undefined fence 的终态请求。
    if (!entry.leaseToken || !Number.isInteger(entry.fencingToken) || Number(entry.fencingToken) <= 0) {
      throw new OpenDeliveryClientError('malformed')
    }
    return this.parseStatus(await this.request(context, `/${encodeURIComponent(entry.deliveryId)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        ...facts,
        lease_token: entry.leaseToken,
        fencing_token: entry.fencingToken
      })
    }, signal))
  }

  private parseStatus(payload: unknown): OpenRecoveryDeliveryStatus {
    const data = strictRecord(payload, ['delivery_id', 'fulfillment_id', 'attempt_number', 'parent_delivery_id', 'status', 'result'])
    if (!DELIVERY_STATUSES.includes(data.status as typeof DELIVERY_STATUSES[number])) throw new OpenDeliveryClientError('malformed')
    if (!DELIVERY_RESULTS.includes(data.result as typeof DELIVERY_RESULTS[number])) throw new OpenDeliveryClientError('malformed')
    return {
      deliveryId: requiredString(data, 'delivery_id'),
      fulfillmentId: requiredString(data, 'fulfillment_id'),
      attemptNumber: positiveInteger(data, 'attempt_number'),
      ...(optionalString(data, 'parent_delivery_id') ? { parentDeliveryId: optionalString(data, 'parent_delivery_id') } : {}),
      status: data.status as OpenRecoveryDeliveryStatus['status'],
      result: data.result as OpenRecoveryDeliveryStatus['result']
    }
  }

  private async request(
    context: ClientContext,
    suffix: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<unknown> {
    const scope = new URLSearchParams({
      source_application: context.sourceApplication,
      source_channel: context.sourceChannel,
      source_instance_id: context.sourceInstanceId,
      limit: '50'
    })
    let response: Response
    try {
      response = await this.fetchImpl(`${context.baseUrl.replace(/\/$/, '')}/recovery/deliveries${suffix}?${scope}`, {
        ...init,
        signal,
        headers: { 'content-type': 'application/json', 'X-Omni-Api-Key': context.apiKey }
      })
    } catch {
      throw new OpenDeliveryClientError('network')
    }
    if (!response.ok) {
      // 故意不读取非 2xx 正文：HTTP 状态已经足够驱动安全收敛，正文可能包含内部异常。
      void response.body?.cancel().catch(() => undefined)
      if (response.status === 401 || response.status === 403) throw new OpenDeliveryClientError('auth')
      if (response.status === 404) throw new OpenDeliveryClientError('not_found')
      if (response.status === 409) throw new OpenDeliveryClientError('conflict')
      if (response.status === 400 || response.status === 422) throw new OpenDeliveryClientError('rejected')
      throw new OpenDeliveryClientError('network')
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json')) throw new OpenDeliveryClientError('malformed')
    let envelope: StrictRecord
    try {
      envelope = strictRecord(await response.json(), ['code', 'message', 'data', 'timestamp', 'trace_id'])
    } catch (error) {
      if (error instanceof OpenDeliveryClientError) throw error
      throw new OpenDeliveryClientError('malformed')
    }
    if (
      envelope.code !== response.status
      || typeof envelope.message !== 'string'
      || !(typeof envelope.timestamp === 'string' || typeof envelope.timestamp === 'number')
      || typeof envelope.trace_id !== 'string'
      || !envelope.trace_id.trim()
      || envelope.data === undefined
    ) {
      throw new OpenDeliveryClientError('malformed')
    }
    return envelope.data
  }
}

export interface OpenRecoveryDeliveryLoopDependencies {
  client: OpenChannelDeliveryClient
  journal: PersistentDeliveryJournal
  send: (
    input: { accountId: string; sessionId: string; text: string },
    control: { onAcquire: () => void; isCancelled: () => boolean; authorize: () => Promise<{ success: false; error: string } | undefined> }
  ) => Promise<RecoverySendResult>
  authorize: (accountId: string, sessionId: string) => Promise<{ success: false; error: string } | undefined>
  pollIntervalMs?: number
}

/**
 * 该循环只消费服务端已经审核通过的 Delivery，不参与入站消息生成，也不建立第二套 sender。
 * start/stop 完全受 OmniMind Runtime 生命周期控制；所有真正微信发送仍进入同一个 UnifiedSender mutex。
 */
export class OpenRecoveryDeliveryLoop {
  private epoch = 0
  private timer?: ReturnType<typeof setTimeout>
  private abortController?: AbortController
  private inFlight?: Promise<void>
  private context?: ClientContext

  constructor(private readonly dependencies: OpenRecoveryDeliveryLoopDependencies) {}

  start(input: { baseUrl: string; apiKey: string; accountId: string }): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.abortController?.abort()
    const epoch = ++this.epoch
    this.context = {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      sourceApplication: OPEN_CHAT_CHANNEL_IDENTITY.application,
      sourceChannel: OPEN_CHAT_CHANNEL_IDENTITY.channel,
      sourceInstanceId: input.accountId
    }
    this.schedule(epoch, 0)
  }

  async stop(): Promise<void> {
    this.epoch += 1
    this.context = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.abortController?.abort()
    try { await this.inFlight } catch { /* 循环内部已将所有错误收敛为安全状态。 */ }
  }

  private schedule(epoch: number, delay: number): void {
    if (epoch !== this.epoch || !this.context) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const operation = this.runOnce(epoch).finally(() => {
        if (this.inFlight === operation) this.inFlight = undefined
        this.schedule(epoch, this.dependencies.pollIntervalMs ?? 2_000)
      })
      this.inFlight = operation
    }, delay)
    // Electron/Node 测试退出不能被一个等待下次轮询的 timer 阻塞；生产进程由 BrowserWindow 生命周期持有。
    this.timer.unref?.()
  }

  private async runOnce(epoch: number): Promise<void> {
    const context = this.context
    if (!context || epoch !== this.epoch) return
    const abortController = new AbortController()
    this.abortController = abortController
    try {
      await this.recoverJournal(context, epoch, abortController.signal)
      if (epoch !== this.epoch) return
      const items = await this.dependencies.client.list(context, abortController.signal)
      for (const item of items) {
        if (epoch !== this.epoch) return
        if (await this.dependencies.journal.getDelivery(item.deliveryId)) continue
        const route = await this.dependencies.journal.getRoute(item.sessionReference, context.sourceInstanceId)
        // 没有本地加密路由证明时绝不 claim，避免认领后才发现无法定位微信会话。
        if (!route) continue
        // 必须先原子落 claim_pending，再发网络 claim。此顺序关闭“服务端已认领、客户端却
        // 没有 Delivery identity”的崩溃窗口；同一实例重启会用稳定 leaseOwner 恢复认领。
        await this.dependencies.journal.recordClaimIntent(item, route, this.leaseOwner(context))
        const intent = await this.dependencies.journal.getDelivery(item.deliveryId)
        if (intent) await this.attemptClaim(context, intent, epoch, abortController.signal)
      }
    } catch {
      // 网络、鉴权、损坏响应都只终止本轮；不记录正文、不改变 Runtime，也不会触发渠道发送。
    } finally {
      if (this.abortController === abortController) this.abortController = undefined
    }
  }

  private async recoverJournal(context: ClientContext, epoch: number, signal: AbortSignal): Promise<void> {
    const entries = await this.dependencies.journal.listRecoverable(context.sourceInstanceId)
    for (let entry of entries) {
      if (epoch !== this.epoch) return
      if (entry.state === 'claim_pending') {
        await this.attemptClaim(context, entry, epoch, signal)
        continue
      }
      if (entry.state === 'settled') {
        // 兼容旧版错误终态：settled 没有服务端终态证据，升级后只能继续 GET 对账。
        entry = await this.dependencies.journal.markReconcilePending(entry.deliveryId)
      }
      if (entry.state === 'sending') {
        // sending 先于任何渠道动作落盘；进程若在该状态崩溃，重启后无法证明是否已发送，
        // 因而必须先冻结为 result_unknown_pending，绝不能再次调用 UnifiedSender。
        entry = await this.dependencies.journal.markResultUnknownPending(entry.deliveryId, 'connector_restart_during_send')
      }
      if (entry.state === 'claimed') await this.processClaimed(context, entry, epoch, signal)
      else if (entry.state === 'confirmed_sent' || entry.state === 'ack_pending') await this.replayAck(context, entry, signal)
      else if (entry.state === 'not_sent_pending') await this.replayNotSent(context, entry, signal)
      else if (entry.state === 'result_unknown_pending') await this.replayResultUnknown(context, entry, signal)
      else if (entry.state === 'reconcile_pending') await this.reconcile(context, entry, signal)
    }
  }

  /**
   * 对已经持久化的认领意图执行 claim。network/auth 保留意图以便同 owner 重试；任何明确拒绝
   * 或异常响应都冻结为只对账，避免下一轮 list 把同一 identity 当成新投递。
   */
  private async attemptClaim(context: ClientContext, entry: PersistedDeliveryEntry, epoch: number, signal: AbortSignal): Promise<void> {
    if (epoch !== this.epoch || entry.state !== 'claim_pending') return
    try {
      const claim = await this.dependencies.client.claim(
        context,
        entry.deliveryId,
        entry.leaseOwner ?? this.leaseOwner(context),
        signal
      )
      const claimed = await this.dependencies.journal.recordClaimed(entry.deliveryId, claim)
      await this.processClaimed(context, claimed, epoch, signal)
    } catch (error) {
      if (!(error instanceof OpenDeliveryClientError)) {
        // journal 原子写失败时 copy-on-write 保留 claim_pending；下一轮仍以相同 owner 恢复。
        return
      }
      if (error.kind === 'network' || error.kind === 'auth') return
      const pending = await this.dependencies.journal.markReconcilePending(entry.deliveryId)
      await this.reconcile(context, pending, signal)
    }
  }

  private async processClaimed(context: ClientContext, entry: PersistedDeliveryEntry, epoch: number, signal: AbortSignal): Promise<void> {
    // stop/account-switch 的旧 epoch 回调不得修改新账户 journal，也不得发起对账请求。
    if (epoch !== this.epoch) return
    if (!entry.leaseExpiresAt || Date.parse(entry.leaseExpiresAt) <= Date.now()) {
      // 租约过期并不等于服务端成功/失败；冻结为只 GET 对账，绝不再次渠道发送。
      const pending = await this.dependencies.journal.markReconcilePending(entry.deliveryId)
      await this.reconcile(context, pending, signal)
      return
    }
    await this.dependencies.journal.markSending(entry.deliveryId)
    let result: RecoverySendResult
    try {
      result = await this.dependencies.send(
        { accountId: entry.accountId, sessionId: entry.sessionId, text: entry.content },
        {
          onAcquire: () => undefined,
          isCancelled: () => epoch !== this.epoch,
          authorize: () => epoch === this.epoch
            ? this.dependencies.authorize(entry.accountId, entry.sessionId)
            : Promise.resolve({ success: false as const, error: 'delivery_loop_stopped' })
        }
      )
    } catch {
      result = { result: 'result_unknown', failureCode: 'sender_exception' }
    }
    if (result.result === 'confirmed_sent') {
      const confirmed = await this.dependencies.journal.markConfirmedSent(entry.deliveryId, result.providerMessageId)
      const pending = await this.dependencies.journal.markAckPending(confirmed.deliveryId)
      await this.replayAck(context, pending, signal)
    } else if (result.result === 'not_sent') {
      const pending = await this.dependencies.journal.markNotSentPending(entry.deliveryId, result.failureCode)
      await this.replayNotSent(context, pending, signal)
    } else {
      const pending = await this.dependencies.journal.markResultUnknownPending(entry.deliveryId, result.failureCode)
      await this.replayResultUnknown(context, pending, signal)
    }
  }

  private async replayAck(context: ClientContext, entry: PersistedDeliveryEntry, signal: AbortSignal): Promise<void> {
    try {
      const status = await this.dependencies.client.acknowledge(context, entry, signal)
      await this.applyAuthoritativeStatus(entry, status)
    } catch (error) { await this.handleTerminalFailure(context, entry, error, signal) }
  }

  private async replayNotSent(context: ClientContext, entry: PersistedDeliveryEntry, signal: AbortSignal): Promise<void> {
    try {
      const status = await this.dependencies.client.notSent(context, entry, signal)
      await this.applyAuthoritativeStatus(entry, status)
    } catch (error) { await this.handleTerminalFailure(context, entry, error, signal) }
  }

  private async replayResultUnknown(context: ClientContext, entry: PersistedDeliveryEntry, signal: AbortSignal): Promise<void> {
    try {
      const status = await this.dependencies.client.resultUnknown(context, entry, signal)
      await this.applyAuthoritativeStatus(entry, status)
    } catch (error) { await this.handleTerminalFailure(context, entry, error, signal) }
  }

  private async handleTerminalFailure(context: ClientContext, entry: PersistedDeliveryEntry, error: unknown, signal: AbortSignal): Promise<void> {
    if (!(error instanceof OpenDeliveryClientError)) return
    // 网络失败保留 pending，下一轮只重放同一个 ACK/终态事实，绝不重放微信发送。
    if (error.kind === 'network' || error.kind === 'auth') return
    const pending = await this.dependencies.journal.markReconcilePending(entry.deliveryId)
    await this.reconcile(context, pending, signal)
  }

  private async reconcile(context: ClientContext, entry: PersistedDeliveryEntry, signal: AbortSignal): Promise<void> {
    try {
      const status = await this.dependencies.client.get(context, entry.deliveryId, signal)
      await this.applyAuthoritativeStatus(entry, status)
    } catch {
      // GET 的 404/409/网络未知都不是业务终态证据。保留 reconcile_pending，等待服务端
      // 最终返回 confirmed_sent/not_sent/result_unknown 或进入人工对账，绝不本地误归档。
    }
  }

  private async applyAuthoritativeStatus(
    entry: PersistedDeliveryEntry,
    status: OpenRecoveryDeliveryStatus
  ): Promise<void> {
    // 响应 identity 不匹配视为不可信事实，只保留待对账状态。
    if (status.deliveryId !== entry.deliveryId || status.fulfillmentId !== entry.fulfillmentId || status.attemptNumber !== entry.attemptNumber) {
      await this.dependencies.journal.markReconcilePending(entry.deliveryId)
      return
    }
    if (status.result === 'confirmed_sent') await this.dependencies.journal.settle(entry.deliveryId, 'acked')
    else if (status.result === 'not_sent') await this.dependencies.journal.settle(entry.deliveryId, 'not_sent')
    else if (status.result === 'result_unknown') await this.dependencies.journal.settle(entry.deliveryId, 'result_unknown')
    else await this.dependencies.journal.markReconcilePending(entry.deliveryId)
  }

  private leaseOwner(context: ClientContext): string {
    return `${context.sourceApplication}-${context.sourceChannel}:${createHash('sha256').update(context.sourceInstanceId).digest('hex').slice(0, 32)}`
  }
}
