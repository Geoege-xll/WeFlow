import { isManagedSession, type ManagedScope, type NormalizedMessageEvent, type OmniMindSnapshot, type OmniMindTask } from '../../shared/omnimind/contracts'
import { GlobalAiQueue, type GenerationResult, type QueueSendResult } from './global-ai-queue'
import { type NormalizedMessageEventHub } from './normalized-message-event-hub'
import { SessionTextBatcher } from './session-text-batcher'
import { UNIFIED_AUTOMATIC_HOSTING_POLICY } from '../../shared/omnimind/automatic-hosting-policy.generated'

interface ControllerDependencies {
  hub: NormalizedMessageEventHub
  generate: (task: OmniMindTask) => Promise<GenerationResult>
  send: (task: OmniMindTask, text: string, control: { onAcquire: () => void; isCancelled: () => boolean; authorize?: () => Promise<{ success: false; error: string } | undefined> }) => Promise<QueueSendResult>
  batchDelayMs?: number | (() => number)
  accountId: () => string | undefined
  managedScope?: () => ManagedScope
  scope?: () => string[]
  autoSend?: () => boolean
  authorizeIngress?: () => boolean
  onSnapshotChanged?: (snapshot: OmniMindSnapshot) => void
}

export class OmniMindController {
  private readonly queue: GlobalAiQueue
  private readonly batcher: SessionTextBatcher
  private unsubscribe?: () => void
  private running = false

  constructor(private readonly dependencies: ControllerDependencies) {
    this.queue = new GlobalAiQueue({ generate: dependencies.generate, send: dependencies.send, autoSend: dependencies.autoSend, onChanged: () => dependencies.onSnapshotChanged?.(this.getSnapshot()) })
    this.batcher = new SessionTextBatcher(
      dependencies.batchDelayMs ?? UNIFIED_AUTOMATIC_HOSTING_POLICY.batchWindowMs.default,
      async (batch) => {
      // Open Chat 当前声明 max_messages=50。高频会话在一个聚合窗口内超过该限制时，
      // 按已经稳定排序的消息序列切成多个队列任务；每个任务仍保留独立消息身份，不能截断或合并丢失。
      const maxMessages = UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.maxMessagesPerBatch
      for (let offset = 0; offset < batch.messages.length; offset += maxMessages) {
        const messages = batch.messages.slice(offset, offset + maxMessages)
        this.queue.enqueue({
          accountId: batch.accountId,
          sessionId: batch.sessionId,
          sessionName: batch.sessionName,
          sessionType: messages[0]?.sessionType,
          // messageKey 仍是本地私有值，后续只允许 Python client 摘要后出网；
          // Controller 不在此提前拼成不可追踪的单条协议消息。
          inboundMessages: messages,
          messageKeys: messages.map((message) => message.messageKey),
          text: messages.map((message) => message.text).join('\n')
        })
      }
      },
    )
  }

  start(): void {
    if (this.unsubscribe) return
    this.running = true
    this.unsubscribe = this.dependencies.hub.subscribe((event) => this.onMessage(event))
  }

  stop(): void { this.running = false; this.batcher.clear(); this.queue.cancelAll('hosting_disabled'); this.unsubscribe?.(); this.unsubscribe = undefined }
  whenIdle(): Promise<void> { return this.queue.whenIdle() }
  cancelForManualSend(accountId: string, sessionId: string): string[] { return this.queue.cancelForManualSend(accountId, sessionId) }
  cancelTask(taskId: string): boolean { return this.queue.cancelTask(taskId, 'user_cancelled') }
  retryTask(taskId: string): OmniMindTask | undefined { return this.queue.retry(taskId) }
  findTask(taskId: string): OmniMindTask | undefined { return this.queue.findTask(taskId) }
  sendGeneratedReply(taskId: string): ReturnType<GlobalAiQueue['sendGeneratedReply']> { return this.queue.sendGeneratedReply(taskId) }
  abandonGeneratedReply(taskId: string): boolean { return this.queue.abandonGeneratedReply(taskId) }
  confirmDelivery(taskId: string): boolean { return this.queue.confirmDelivery(taskId) }
  getSnapshot(): OmniMindSnapshot {
    const snapshot = this.queue.getSnapshot()
    const project = ({ id, sessionId, sessionName, status, createdAt, updatedAt, failureStage, reason, retryOf, replyText, generatedAt, newMessagesSinceGenerated }: OmniMindTask) => ({
      id, sessionId, sessionName, status, createdAt, updatedAt, failureStage, reason, retryOf,
      ...(['awaiting_manual_send', 'send_failed', 'delivery_unconfirmed'].includes(status) ? { replyText, generatedAt, newMessagesSinceGenerated } : {})
    })
    return {
      runtimeState: this.running ? 'running' : 'stopped',
      current: snapshot.current ? project(snapshot.current) : undefined,
      waiting: snapshot.waiting.map(project),
      awaitingManualSend: snapshot.awaitingManualSend.map(project),
      recent: snapshot.recent.map(project)
    }
  }

  private onMessage(event: NormalizedMessageEvent): void {
    if (!this.running || event.direction !== 'inbound' || event.messageType !== 1 || event.contentType !== 'text' || !event.text.trim()) return
    if (this.dependencies.authorizeIngress?.() === false) return
    if (event.accountId !== this.dependencies.accountId()) return
    // 官方账号固定不回复，必须在 queue.noteIncomingMessage 之前退出；否则即使不生成新任务，
    // 也可能错误修改升级前遗留的待确认任务状态。发送授权层仍会再次独立 fail closed。
    if (event.sessionType === 'official') return
    this.queue.noteIncomingMessage(event.accountId, event.sessionId)
    const managedScope = this.dependencies.managedScope?.() ?? { mode: 'selected' as const, conversations: (this.dependencies.scope?.() ?? []).map((sessionId) => ({ sessionId, displayName: '' })) }
    if (!isManagedSession(managedScope, event.sessionId)) return
    this.batcher.accept(event)
  }
}
