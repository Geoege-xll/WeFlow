import { describe, expect, it, vi } from 'vitest'
import type { ManagedScope, NormalizedMessageEvent } from '../../shared/omnimind/contracts'
import { NormalizedMessageEventHub } from '../../electron/omnimind/normalized-message-event-hub'
import { OmniMindController } from '../../electron/omnimind/omnimind-controller'

const event = (sessionId: string, messageKey: string, sessionType: NormalizedMessageEvent['sessionType'] = 'private'): NormalizedMessageEvent => ({
  accountId: 'a', sessionId, messageKey, direction: 'inbound', text: `message-${messageKey}`, timestamp: 1,
  sessionType, messageType: 1, contentType: 'text', sessionName: sessionId
})

describe('OmniMind production policy seam', () => {
  it('applies selected/all, permanent official exclusion, and auto/manual generation at the authoritative controller', async () => {
    vi.useFakeTimers()
    const hub = new NormalizedMessageEventHub()
    let managedScope: ManagedScope = { mode: 'selected', conversations: [{ sessionId: ' Alice ', displayName: 'Alice' }] }
    let autoSend = true
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'generated reply' }))
    const send = vi.fn(async () => ({ success: true }))
    const controller = new OmniMindController({
      hub, generate, send, batchDelayMs: 500, accountId: () => 'a',
      managedScope: () => managedScope, autoSend: () => autoSend
    })
    controller.start()
    hub.publish(event('alice', 'selected'))
    hub.publish(event('other', 'denied'))
    hub.publish(event('official', 'official-denied', 'official'))
    await vi.advanceTimersByTimeAsync(500); await controller.whenIdle()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)

    managedScope = { mode: 'all', confirmedAt: 1 }
    autoSend = false
    hub.publish(event('future-contact', 'future'))
    hub.publish(event('official', 'official-allowed', 'official'))
    await vi.advanceTimersByTimeAsync(500); await controller.whenIdle()
    expect(generate).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().awaitingManualSend).toHaveLength(1)
    controller.stop(); vi.useRealTimers()
  })

  it('将单个聚合窗口内超过 Open Chat 上限的消息稳定拆成多个队列任务', async () => {
    vi.useFakeTimers()
    const hub = new NormalizedMessageEventHub()
    const taskSizes: number[] = []
    const controller = new OmniMindController({
      hub,
      generate: async (task) => { taskSizes.push(task.inboundMessages.length); return { kind: 'network' } },
      send: async () => ({ success: true }),
      batchDelayMs: 100,
      accountId: () => 'a',
      managedScope: () => ({ mode: 'all', confirmedAt: 1 })
    })
    controller.start()
    for (let index = 0; index < 51; index += 1) {
      hub.publish({ ...event('alice', `message-${index}`), timestamp: index + 1, senderExternalId: 'alice' })
    }
    await vi.advanceTimersByTimeAsync(100)
    await controller.whenIdle()
    expect(taskSizes).toEqual([50, 1])
    controller.stop()
    vi.useRealTimers()
  })
})
