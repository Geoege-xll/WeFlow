import { describe, expect, it, vi } from 'vitest'
import type { ManagedScope, NormalizedMessageEvent } from '../../shared/omnimind/contracts'
import { NormalizedMessageEventHub } from '../../electron/omnimind/normalized-message-event-hub'
import { OmniMindController } from '../../electron/omnimind/omnimind-controller'

const event = (sessionId: string, messageKey: string, sessionType: NormalizedMessageEvent['sessionType'] = 'private'): NormalizedMessageEvent => ({
  accountId: 'a', sessionId, messageKey, direction: 'inbound', text: `message-${messageKey}`, timestamp: 1,
  sessionType, messageType: 1, contentType: 'text', sessionName: sessionId
})

describe('OmniMind production policy seam', () => {
  it('applies selected/all, official filtering, and auto/manual generation at the authoritative controller', async () => {
    vi.useFakeTimers()
    const hub = new NormalizedMessageEventHub()
    let managedScope: ManagedScope = { mode: 'selected', conversations: [{ sessionId: ' Alice ', displayName: 'Alice' }] }
    let ignoreOfficial = true
    let autoSend = true
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'generated reply' }))
    const send = vi.fn(async () => ({ success: true }))
    const controller = new OmniMindController({
      hub, generate, send, batchDelayMs: 500, accountId: () => 'a',
      managedScope: () => managedScope, ignoreOfficial: () => ignoreOfficial, autoSend: () => autoSend
    })
    controller.start()
    hub.publish(event('alice', 'selected'))
    hub.publish(event('other', 'denied'))
    hub.publish(event('official', 'official-denied', 'official'))
    await vi.advanceTimersByTimeAsync(500); await controller.whenIdle()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)

    managedScope = { mode: 'all', confirmedAt: 1 }
    ignoreOfficial = false
    autoSend = false
    hub.publish(event('future-contact', 'future'))
    hub.publish(event('official', 'official-allowed', 'official'))
    await vi.advanceTimersByTimeAsync(500); await controller.whenIdle()
    expect(generate).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().awaitingManualSend).toHaveLength(2)
    controller.stop(); vi.useRealTimers()
  })
})
