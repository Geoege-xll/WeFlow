import { describe, expect, it, vi } from 'vitest'
import { OmniMindController } from '../../electron/omnimind/omnimind-controller'
import { registerOmniMindIpc } from '../../electron/omnimind/register-omnimind-ipc'
import { NormalizedMessageEventHub } from '../../electron/omnimind/normalized-message-event-hub'

describe('OmniMind controller and IPC', () => {
  it('processes one eligible normalized inbound event exactly once end to end', async () => {
    vi.useFakeTimers()
    const hub = new NormalizedMessageEventHub()
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'reply' }))
    const send = vi.fn(async () => ({ success: true, verifiedMessageKey: 'out' }))
    const controller = new OmniMindController({ hub, generate, send, batchDelayMs: 2000, accountId: () => 'a', scope: () => ['s'] })
    controller.start()
    const event = { accountId: 'a', sessionId: 's', messageKey: 'm', direction: 'inbound' as const, text: 'hello', timestamp: 1, sessionType: 'private' as const, messageType: 1, contentType: 'text' as const }
    hub.publish(event); hub.publish(event)
    await vi.advanceTimersByTimeAsync(2000)
    await controller.whenIdle()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    controller.stop()
    vi.useRealTimers()
  })

  it('ignores outbound, blank, official, out-of-scope, and wrong-account events', async () => {
    vi.useFakeTimers()
    const hub = new NormalizedMessageEventHub()
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'reply' }))
    const controller = new OmniMindController({ hub, generate, send: async () => ({ success: true }), batchDelayMs: 2000, accountId: () => 'a', scope: () => ['s'] })
    controller.start()
    const base = { accountId: 'a', sessionId: 's', messageKey: 'm', direction: 'inbound' as const, text: 'hello', timestamp: 1, sessionType: 'private' as const, messageType: 1, contentType: 'text' as const }
    hub.publish({ ...base, messageKey: '1', direction: 'outbound' })
    hub.publish({ ...base, messageKey: '2', text: ' ' })
    hub.publish({ ...base, messageKey: '3', sessionType: 'official' })
    hub.publish({ ...base, messageKey: '4', sessionId: 'other' })
    hub.publish({ ...base, messageKey: '5', accountId: 'other' })
    hub.publish({ ...base, messageKey: '6', messageType: 3, contentType: 'image', text: '[图片]' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(generate).not.toHaveBeenCalled()
    controller.stop(); vi.useRealTimers()
  })

  it('fails closed before batching or generation when cached native permissions are not ready', async () => {
    vi.useFakeTimers()
    const hub = new NormalizedMessageEventHub()
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'reply' }))
    const controller = new OmniMindController({
      hub, generate, send: async () => ({ success: true }), batchDelayMs: 500,
      accountId: () => 'a', scope: () => ['s'], authorizeIngress: () => false
    })
    controller.start()
    hub.publish({ accountId: 'a', sessionId: 's', messageKey: 'm', direction: 'inbound', text: 'private', timestamp: 1, sessionType: 'private', messageType: 1, contentType: 'text' })
    await vi.advanceTimersByTimeAsync(500)

    expect(generate).not.toHaveBeenCalled()
    expect(controller.getSnapshot().waiting).toEqual([])
    controller.stop()
    vi.useRealTimers()
  })

  it('registers strict namespaced handlers and snapshot listeners unsubscribe exactly', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = { handle: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler)), removeHandler: vi.fn() }
    const controller = {
      getSnapshot: vi.fn(() => ({ runtimeState: 'stopped', waiting: [], recent: [] })),
      getSettings: vi.fn(async () => ({ pythonBaseUrl: 'http://127.0.0.1:8000', scope: [], hasApiKey: false })),
      saveSettings: vi.fn(), testConnection: vi.fn(), clearApiKey: vi.fn(), enable: vi.fn(), disable: vi.fn(), sendManual: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn(),
      getPermissions: vi.fn(), requestPermission: vi.fn(), recheckPermission: vi.fn(), openPermissionSettings: vi.fn()
    }
    const unregister = registerOmniMindIpc(ipc, controller)
    expect(handlers.has('omnimind:getSnapshot')).toBe(true)
    expect(handlers.get('omnimind:sendManual')!({}, { sessionId: 's', text: 'x' })).toBeUndefined()
    expect(() => handlers.get('omnimind:sendManual')!({}, { accountId: 'renderer-controlled', sessionId: 's', text: 'x' })).toThrow('Invalid manual send payload')
    expect(() => handlers.get('omnimind:sendGeneratedReply')!({}, { taskId: 'x', replyText: 'renderer-controlled' })).toThrow()
    expect(handlers.get('omnimind:testConnection')!({}, { pythonBaseUrl: 'https://api.example.com' })).toBeUndefined()
    expect(handlers.get('omnimind:requestPermission')!({}, { permission: 'automation' })).toBeUndefined()
    expect(handlers.get('omnimind:recheckPermission')!({}, { permission: 'accessibility' })).toBeUndefined()
    expect(() => handlers.get('omnimind:recheckPermission')!({}, { permission: 'accessibility', url: 'renderer-controlled' })).toThrow('Invalid permission payload')
    expect(handlers.has('omnimind:recheckPermissions')).toBe(false)
    expect(() => handlers.get('omnimind:openPermissionSettings')!({}, { permission: 'automation', url: 'https://example.test' })).toThrow('Invalid permission payload')
    unregister()
    expect(ipc.removeHandler).toHaveBeenCalledWith('omnimind:getSnapshot')
    expect(ipc.removeHandler).toHaveBeenCalledTimes(16)
  })
})
