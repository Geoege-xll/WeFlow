import { describe, expect, it, vi } from 'vitest'
import { NormalizedMessageEventHub } from '../../electron/omnimind/normalized-message-event-hub'

describe('NormalizedMessageEventHub', () => {
  it('emits each stable message once and unsubscribes the exact listener', () => {
    const hub = new NormalizedMessageEventHub()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribe = hub.subscribe(first)
    hub.subscribe(second)
    const event = { accountId: 'a', sessionId: 's', messageKey: 'm', direction: 'inbound' as const, text: 'hello', timestamp: 1, sessionType: 'private' as const }
    hub.publish(event)
    hub.publish(event)
    unsubscribe()
    hub.publish({ ...event, messageKey: 'm2' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('keeps dedupe memory bounded and clears it on teardown', () => {
    const hub = new NormalizedMessageEventHub()
    for (let index = 0; index < 6000; index += 1) hub.publish({ accountId: 'a', sessionId: 's', messageKey: String(index), direction: 'inbound', text: 'x', timestamp: index, sessionType: 'private', messageType: 1, contentType: 'text' })
    expect(hub.dedupeSize).toBe(5000)
    hub.reset()
    expect(hub.dedupeSize).toBe(0)
  })
})
