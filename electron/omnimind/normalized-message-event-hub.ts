import { makeStableMessageId, type NormalizedMessageEvent } from '../../shared/omnimind/contracts'

export type NormalizedMessageListener = (event: NormalizedMessageEvent) => void

export class NormalizedMessageEventHub {
  private readonly listeners = new Set<NormalizedMessageListener>()
  private readonly seen = new Map<string, number>()
  private readonly maxSeen = 5000

  get hasSubscribers(): boolean { return this.listeners.size > 0 }

  subscribe(listener: NormalizedMessageListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(event: NormalizedMessageEvent): boolean {
    const id = makeStableMessageId(event.accountId, event.sessionId, event.messageKey)
    if (this.seen.has(id)) return false
    this.seen.set(id, Date.now())
    while (this.seen.size > this.maxSeen) this.seen.delete(this.seen.keys().next().value!)
    for (const listener of this.listeners) listener(event)
    return true
  }

  reset(): void { this.seen.clear() }
  get dedupeSize(): number { return this.seen.size }
}

export const normalizedMessageEventHub = new NormalizedMessageEventHub()
