import { isManagedSession, type ManagedScope, type NormalizedMessageEvent, type OmniMindSnapshot, type OmniMindTask } from '../../shared/omnimind/contracts'
import { GlobalAiQueue, type GenerationResult, type QueueSendResult } from './global-ai-queue'
import { type NormalizedMessageEventHub } from './normalized-message-event-hub'
import { SessionTextBatcher } from './session-text-batcher'

interface ControllerDependencies {
  hub: NormalizedMessageEventHub
  generate: (task: OmniMindTask) => Promise<GenerationResult>
  send: (task: OmniMindTask, text: string, control: { onAcquire: () => void; isCancelled: () => boolean; authorize?: () => Promise<{ success: false; error: string } | undefined> }) => Promise<QueueSendResult>
  batchDelayMs?: number | (() => number)
  accountId: () => string | undefined
  managedScope?: () => ManagedScope
  scope?: () => string[]
  autoSend?: () => boolean
  ignoreOfficial?: () => boolean
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
    this.batcher = new SessionTextBatcher(dependencies.batchDelayMs ?? 2000, async (batch) => {
      this.queue.enqueue({
        accountId: batch.accountId,
        sessionId: batch.sessionId,
        sessionName: batch.sessionName,
        sessionType: batch.messages[0]?.sessionType,
        messageKeys: batch.messages.map((message) => message.messageKey),
        text: batch.messages.map((message) => message.text).join('\n')
      })
    })
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
    this.queue.noteIncomingMessage(event.accountId, event.sessionId)
    if (event.sessionType === 'official' && (this.dependencies.ignoreOfficial?.() ?? true)) return
    const managedScope = this.dependencies.managedScope?.() ?? { mode: 'selected' as const, conversations: (this.dependencies.scope?.() ?? []).map((sessionId) => ({ sessionId, displayName: '' })) }
    if (!isManagedSession(managedScope, event.sessionId)) return
    this.batcher.accept(event)
  }
}
