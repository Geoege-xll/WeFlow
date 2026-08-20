import { randomUUID } from 'crypto'
import type { NormalizedMessageEvent, OmniMindSendResult, OmniMindTask } from '../../shared/omnimind/contracts'

export type GenerationResult =
  | { kind: 'reply'; text: string }
  | { kind: 'auth' | 'timeout' | 'network' | 'malformed' | 'empty' | 'handoff' | 'processing' | 'execution_result_unknown' | 'retry_exhausted' | 'invalid_persisted_request' | 'service_unavailable' | 'conflict'; error?: string }

export type QueueSendResult = OmniMindSendResult
export interface QueueInput {
  accountId: string
  sessionId: string
  sessionName: string
  sessionType?: NormalizedMessageEvent['sessionType']
  /**
   * 队列必须保留批次中的逐消息事实，不能只留下拼接文本；否则群聊 sender、occurred_at
   * 和逐消息幂等 ID 会在进入 Python client 前不可恢复地丢失。
   */
  inboundMessages?: NormalizedMessageEvent[]
  messageKeys: string[]
  text: string
  retryOf?: string
}

interface QueueDependencies {
  generate: (task: OmniMindTask) => Promise<GenerationResult>
  send: (task: OmniMindTask, text: string, control: { onAcquire: () => void; isCancelled: () => boolean; authorize?: () => Promise<{ success: false; error: string } | undefined> }) => Promise<QueueSendResult>
  now?: () => number
  onChanged?: () => void
  autoSend?: () => boolean
}

const cancellable = new Set(['queued', 'generating', 'waiting_to_send'])
/**
 * 这些结果都不能通过“重试”创建新的队列任务：结果未知可能已经执行过模型，凭据撤销后
 * 换 Key 会改变服务端幂等作用域，其余稳定失败也已有 Operation tombstone。用户应先人工
 * 核对或修复服务端状态；OmniMindWeChat 只能继续用原消息事实派生同一个 Idempotency-Key 对账。
 */
const nonRetryableGenerationReasons = new Set([
  'timeout',
  'handoff',
  'execution_result_unknown',
  'credential_revoked',
  'retry_exhausted',
  'invalid_persisted_request',
  'service_unavailable',
  'conflict'
])

export class GlobalAiQueue {
  private readonly tasks: OmniMindTask[] = []
  private readonly preservedReplyRetries = new Set<string>()
  private processing = false
  private idleResolvers: Array<() => void> = []

  constructor(private readonly dependencies: QueueDependencies) {}

  enqueue(input: QueueInput): OmniMindTask {
    const now = this.dependencies.now?.() ?? Date.now()
    // 生产入口由 Controller 始终传入完整逐消息事件。这里的合成分支只保留旧的队列级
    // 单元测试/内部调用兼容性；它不会从 MessagePush 生产链路触发，也不会伪造群聊 sender。
    const inboundMessages = input.inboundMessages ?? input.messageKeys.map((messageKey) => ({
      accountId: input.accountId,
      sessionId: input.sessionId,
      sessionName: input.sessionName,
      sessionType: input.sessionType ?? 'other',
      messageKey,
      direction: 'inbound' as const,
      text: input.text,
      timestamp: 0,
      messageType: 1,
      contentType: 'text' as const
    }))
    const task: OmniMindTask = { ...input, inboundMessages, id: randomUUID(), status: 'queued', createdAt: now, updatedAt: now }
    this.tasks.push(task)
    this.changed()
    void this.drain()
    return task
  }

  retry(taskId: string): OmniMindTask | undefined {
    const source = this.findTask(taskId)
    if (!source || !['generation_failed', 'send_failed'].includes(source.status)) return undefined
    // Python 服务端的稳定终态或执行结果未知都已有 Operation 真源；通用 retry 入口不能
    // 换 task / Key 作用域盲目重放。processing 仍保留显式对账能力，并继续复用原消息事实。
    if (source.status === 'generation_failed' && nonRetryableGenerationReasons.has(source.reason ?? '')) return undefined
    if (source.status === 'send_failed' && source.replyText) {
      this.preservedReplyRetries.add(source.id)
      this.transition(source, 'queued')
      void this.drain()
      return source
    }
    return this.enqueue({
      accountId: source.accountId,
      sessionId: source.sessionId,
      sessionName: source.sessionName,
      sessionType: source.sessionType,
      inboundMessages: source.inboundMessages,
      messageKeys: source.messageKeys,
      text: source.text,
      retryOf: source.id
    })
  }

  findTask(taskId: string): OmniMindTask | undefined { return this.tasks.find((task) => task.id === taskId) }

  cancelTask(taskId: string, reason: string): boolean {
    const task = this.findTask(taskId)
    if (!task || !cancellable.has(task.status)) return false
    this.transition(task, 'cancelled', reason)
    return true
  }

  cancelForManualSend(accountId: string, sessionId: string): string[] {
    const cancelled: string[] = []
    for (const task of this.tasks) {
      if (task.accountId === accountId && task.sessionId === sessionId && this.cancelTask(task.id, 'manual_send_same_session')) cancelled.push(task.id)
    }
    return cancelled
  }

  cancelAll(reason: string): string[] {
    const cancelled: string[] = []
    for (const task of this.tasks) if (this.cancelTask(task.id, reason)) cancelled.push(task.id)
    return cancelled
  }

  noteIncomingMessage(accountId: string, sessionId: string): void {
    for (const task of this.tasks) {
      if (task.status === 'awaiting_manual_send' && task.accountId === accountId && task.sessionId.toLocaleLowerCase() === sessionId.trim().toLocaleLowerCase()) {
        task.newMessagesSinceGenerated = (task.newMessagesSinceGenerated ?? 0) + 1
        task.staleAcknowledged = false
        this.changed()
      }
    }
  }

  async sendGeneratedReply(taskId: string): Promise<QueueSendResult> {
    const task = this.findTask(taskId)
    if (!task || task.status !== 'awaiting_manual_send' || !task.replyText) return { success: false, error: 'task_not_awaiting_manual_send' }
    if ((task.newMessagesSinceGenerated ?? 0) > 0 && !task.staleAcknowledged) {
      task.staleAcknowledged = true
      this.changed()
      return { success: false, error: 'stale_reply_confirmation_required' }
    }
    this.transition(task, 'waiting_to_send')
    let sent: QueueSendResult
    try {
      sent = await this.dependencies.send(task, task.replyText, {
        onAcquire: () => { if (task.status === 'waiting_to_send') this.transition(task, 'sending') },
        isCancelled: () => task.status === 'cancelled'
      })
    } catch { sent = { success: false, error: 'send_exception' } }
    if (task.status !== 'cancelled') this.transitionAfterSend(task, sent)
    return sent
  }

  abandonGeneratedReply(taskId: string): boolean {
    const task = this.findTask(taskId)
    if (!task) return false
    if (task.status === 'cancelled' && task.reason === 'manual_abandoned') return true
    if (task.status !== 'awaiting_manual_send') return false
    this.transition(task, 'cancelled', 'manual_abandoned')
    return true
  }

  /**
   * 将用户已在微信中核对的“不确定送达”任务原子确认成 sent。
   * 仅 delivery_unconfirmed 有资格转换；未知 ID、发送失败或其他终态一律 fail closed，
   * 不触发重试、不调用 sender，也不会伪造其他任务的成功结果。
   */
  confirmDelivery(taskId: string): boolean {
    const task = this.findTask(taskId)
    if (!task || task.status !== 'delivery_unconfirmed') return false
    // 清除失败与旧动作资格，但保留 replyText、generatedAt、createdAt、messageKeys 等审计上下文。
    task.failureStage = undefined
    task.staleAcknowledged = undefined
    this.transition(task, 'sent')
    return true
  }

  getSnapshot(): { current?: OmniMindTask; waiting: OmniMindTask[]; awaitingManualSend: OmniMindTask[]; recent: OmniMindTask[] } {
    const current = this.tasks.find((task) => ['generating', 'waiting_to_send', 'sending'].includes(task.status))
    const waiting = this.tasks.filter((task) => task.status === 'queued')
    const awaitingManualSend = this.tasks.filter((task) => task.status === 'awaiting_manual_send')
    const recent = this.tasks.filter((task) => ['sent', 'delivery_unconfirmed', 'cancelled', 'generation_failed', 'send_failed'].includes(task.status)).slice(-20)
    return { current, waiting, awaitingManualSend, recent }
  }

  whenIdle(): Promise<void> {
    if (!this.processing && !this.tasks.some((task) => task.status === 'queued')) return Promise.resolve()
    return new Promise((resolve) => this.idleResolvers.push(resolve))
  }

  private async drain(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (true) {
        const task = this.tasks.find((candidate) => candidate.status === 'queued')
        if (!task) break
        if (this.preservedReplyRetries.delete(task.id) && task.replyText) {
          this.transition(task, 'waiting_to_send')
          let resent: QueueSendResult
          try {
            resent = await this.dependencies.send(task, task.replyText, {
              onAcquire: () => { if (task.status === 'waiting_to_send') this.transition(task, 'sending') },
              isCancelled: () => task.status === 'cancelled'
            })
          } catch { resent = { success: false, error: 'send_exception' } }
          if (!this.isTaskCancelled(task)) this.transitionAfterSend(task, resent)
          continue
        }
        this.transition(task, 'generating')
        let generation: GenerationResult
        try {
          generation = await this.dependencies.generate(task)
        } catch {
          task.failureStage = 'generation'
          this.transition(task, 'generation_failed', 'generation_exception')
          continue
        }
        if (task.status === 'cancelled') continue
        if (generation.kind === 'handoff') {
          task.failureStage = 'generation'
          // execution_result_unknown 由客户端归入人工接管语义时，也只允许记录白名单稳定码，
          // 不能把服务端 message 或原始网络异常写入可见快照。
          this.transition(task, 'generation_failed', generation.error === 'execution_result_unknown' ? generation.error : 'handoff')
          continue
        }
        if (generation.kind !== 'reply') {
          task.failureStage = 'generation'
          // credential_revoked 对外仍是 auth 类别，但需要保留其不可重试语义；其他 error
          // 都不能覆盖 kind，避免 fetch/服务端正文意外进入任务 reason。
          const reason = generation.kind === 'auth' && generation.error === 'credential_revoked'
            ? generation.error
            : generation.kind
          this.transition(task, 'generation_failed', reason)
          continue
        }
        task.replyText = generation.text
        task.generatedAt = this.dependencies.now?.() ?? Date.now()
        task.newMessagesSinceGenerated = 0
        if (this.dependencies.autoSend?.() === false) {
          this.transition(task, 'awaiting_manual_send')
          continue
        }
        this.transition(task, 'waiting_to_send')
        let sent: QueueSendResult
        try {
          sent = await this.dependencies.send(task, generation.text, {
            onAcquire: () => { if (task.status === 'waiting_to_send') this.transition(task, 'sending') },
            isCancelled: () => task.status === 'cancelled'
          })
        } catch {
          if (this.isTaskCancelled(task)) continue
          task.failureStage = 'automation'
          this.transition(task, 'send_failed', 'send_exception')
          continue
        }
        if (this.isTaskCancelled(task)) continue
        this.transitionAfterSend(task, sent)
      }
    } finally {
      this.processing = false
      const resolvers = this.idleResolvers.splice(0)
      resolvers.forEach((resolve) => resolve())
    }
  }

  private transition(task: OmniMindTask, status: OmniMindTask['status'], reason?: string): void {
    task.status = status
    task.updatedAt = this.dependencies.now?.() ?? Date.now()
    task.reason = reason
    if (['sent', 'delivery_unconfirmed', 'cancelled', 'generation_failed', 'send_failed'].includes(status)) this.evictOldTerminalTasks()
    this.changed()
  }

  private evictOldTerminalTasks(): void {
    const terminal = this.tasks.filter((task) => ['sent', 'delivery_unconfirmed', 'cancelled', 'generation_failed', 'send_failed'].includes(task.status))
    const excess = terminal.length - 20
    if (excess <= 0) return
    const evictedIds = new Set(terminal.slice(0, excess).map((task) => task.id))
    for (let index = this.tasks.length - 1; index >= 0; index -= 1) if (evictedIds.has(this.tasks[index].id)) this.tasks.splice(index, 1)
  }

  private changed(): void { this.dependencies.onChanged?.() }
  private isTaskCancelled(task: OmniMindTask): boolean { return task.status === 'cancelled' }

  private transitionAfterSend(task: OmniMindTask, result: QueueSendResult): void {
    task.failureStage = result.success ? undefined : result.stage
    const status = result.success ? 'sent' : result.stage === 'verification_postsend' ? 'delivery_unconfirmed' : 'send_failed'
    this.transition(task, status, result.error)
  }
}
