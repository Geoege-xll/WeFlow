import { randomUUID } from 'crypto'
import type { OmniMindSendResult, OmniMindTask } from '../../shared/omnimind/contracts'

export type GenerationResult =
  | { kind: 'reply'; text: string }
  | { kind: 'auth' | 'timeout' | 'network' | 'malformed' | 'empty' | 'handoff'; error?: string }

export type QueueSendResult = OmniMindSendResult
export interface QueueInput { accountId: string; sessionId: string; sessionName: string; messageKeys: string[]; text: string; retryOf?: string }

interface QueueDependencies {
  generate: (task: OmniMindTask) => Promise<GenerationResult>
  send: (task: OmniMindTask, text: string, control: { onAcquire: () => void; isCancelled: () => boolean; authorize?: () => Promise<{ success: false; error: string } | undefined> }) => Promise<QueueSendResult>
  now?: () => number
  onChanged?: () => void
  autoSend?: () => boolean
}

const cancellable = new Set(['queued', 'generating', 'waiting_to_send'])

export class GlobalAiQueue {
  private readonly tasks: OmniMindTask[] = []
  private readonly preservedReplyRetries = new Set<string>()
  private processing = false
  private idleResolvers: Array<() => void> = []

  constructor(private readonly dependencies: QueueDependencies) {}

  enqueue(input: QueueInput): OmniMindTask {
    const now = this.dependencies.now?.() ?? Date.now()
    const task: OmniMindTask = { ...input, id: randomUUID(), status: 'queued', createdAt: now, updatedAt: now }
    this.tasks.push(task)
    this.changed()
    void this.drain()
    return task
  }

  retry(taskId: string): OmniMindTask | undefined {
    const source = this.findTask(taskId)
    if (!source || !['generation_failed', 'send_failed'].includes(source.status)) return undefined
    if (source.status === 'send_failed' && source.replyText) {
      this.preservedReplyRetries.add(source.id)
      this.transition(source, 'queued')
      void this.drain()
      return source
    }
    return this.enqueue({ accountId: source.accountId, sessionId: source.sessionId, sessionName: source.sessionName, messageKeys: source.messageKeys, text: source.text, retryOf: source.id })
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
          this.transition(task, 'generation_failed', 'handoff')
          continue
        }
        if (generation.kind !== 'reply') {
          task.failureStage = 'generation'
          this.transition(task, 'generation_failed', generation.kind)
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
