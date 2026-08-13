import type { NormalizedMessageEvent } from '../../shared/omnimind/contracts'

export interface SessionTextBatch {
  accountId: string
  sessionId: string
  sessionName: string
  messages: NormalizedMessageEvent[]
}

interface PendingBatch { messages: NormalizedMessageEvent[]; timer: ReturnType<typeof setTimeout> }

export class SessionTextBatcher {
  private readonly pending = new Map<string, PendingBatch>()

  constructor(
    private readonly delayMs: number | (() => number),
    private readonly flush: (batch: SessionTextBatch) => Promise<void>
  ) {}

  accept(event: NormalizedMessageEvent): void {
    const key = `${event.accountId}\u001f${event.sessionId}`
    const existing = this.pending.get(key)
    if (existing) clearTimeout(existing.timer)
    const messages = existing ? [...existing.messages, event] : [event]
    const timer = setTimeout(() => {
      this.pending.delete(key)
      void this.flush({ accountId: event.accountId, sessionId: event.sessionId, sessionName: event.sessionName || event.sessionId, messages })
    }, typeof this.delayMs === 'function' ? this.delayMs() : this.delayMs)
    this.pending.set(key, { messages, timer })
  }

  clear(): void {
    for (const batch of this.pending.values()) clearTimeout(batch.timer)
    this.pending.clear()
  }
}
