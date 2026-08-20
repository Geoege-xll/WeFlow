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
      // WCDB 多表扫描可能让同一批消息以非时间顺序到达。这里以 occurred_at（秒级时间戳）
      // 为主、仅在同秒时用本地 messageKey 作稳定排序，确保正文顺序和幂等请求指纹可复现。
      // messageKey 仍只存在于 Electron main 内，真正出网前必须由 Python client 做不可逆摘要。
      const orderedMessages = [...messages].sort((left, right) =>
        (left.timestamp - right.timestamp) || left.messageKey.localeCompare(right.messageKey)
      )
      void this.flush({ accountId: event.accountId, sessionId: event.sessionId, sessionName: event.sessionName || event.sessionId, messages: orderedMessages })
    }, typeof this.delayMs === 'function' ? this.delayMs() : this.delayMs)
    this.pending.set(key, { messages, timer })
  }

  clear(): void {
    for (const batch of this.pending.values()) clearTimeout(batch.timer)
    this.pending.clear()
  }
}
