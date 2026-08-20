import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { OmniMindController } from '../../electron/omnimind/omnimind-controller'
import { registerOmniMindIpc } from '../../electron/omnimind/register-omnimind-ipc'
import { NormalizedMessageEventHub } from '../../electron/omnimind/normalized-message-event-hub'

vi.mock('electron', () => ({
  app: { getPath: () => '/private/tmp/omnimind-wechat-omnimind-service-test' },
  clipboard: { readText: () => '', writeText: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
  shell: { openExternal: vi.fn() },
  systemPreferences: { isTrustedAccessibilityClient: () => true }
}))
vi.mock('../../electron/services/chatService', () => ({ chatService: {} }))
vi.mock('../../electron/services/messagePushService', () => ({ messagePushService: {} }))
vi.mock('../../electron/services/config', () => ({ ConfigService: { getInstance: () => ({ get: vi.fn() }) } }))
vi.mock('../../electron/safe-console', () => ({ registerClosedStreamDiagnosticSink: vi.fn() }))

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

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

  it('rejects official ingress before it can mutate an existing awaiting-reply task', async () => {
    vi.useFakeTimers()
    const hub = new NormalizedMessageEventHub()
    const controller = new OmniMindController({
      hub,
      generate: async () => ({ kind: 'reply', text: 'reply' }),
      send: async () => ({ success: true }),
      batchDelayMs: 500,
      accountId: () => 'a',
      scope: () => ['s'],
      autoSend: () => false
    })
    controller.start()
    const base = { accountId: 'a', sessionId: 's', direction: 'inbound' as const, text: 'hello', timestamp: 1, messageType: 1, contentType: 'text' as const }
    hub.publish({ ...base, messageKey: 'private-message', sessionType: 'private' as const })
    await vi.advanceTimersByTimeAsync(500)
    await controller.whenIdle()
    expect(controller.getSnapshot().awaitingManualSend[0]?.newMessagesSinceGenerated).toBe(0)

    hub.publish({ ...base, messageKey: 'official-message', sessionType: 'official' as const })
    expect(controller.getSnapshot().awaitingManualSend[0]?.newMessagesSinceGenerated).toBe(0)
    controller.stop()
    vi.useRealTimers()
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
      saveSettings: vi.fn(), testConnection: vi.fn(), clearApiKey: vi.fn(), enable: vi.fn(), pause: vi.fn(), resume: vi.fn(), disable: vi.fn(), sendManual: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn(), confirmDelivery: vi.fn(() => ({ runtimeState: 'running', waiting: [], recent: [] })),
      getPermissions: vi.fn(), requestPermission: vi.fn(), recheckPermission: vi.fn(), openPermissionSettings: vi.fn()
    }
    const unregister = registerOmniMindIpc(ipc, controller)
    expect(handlers.has('omnimind:getSnapshot')).toBe(true)
    expect(handlers.get('omnimind:pause')!({}, {})).toBeUndefined()
    expect(handlers.get('omnimind:resume')!({}, {})).toBeUndefined()
    expect(() => handlers.get('omnimind:pause')!({}, { state: 'paused' })).toThrow('Invalid enable payload')
    expect(() => handlers.get('omnimind:resume')!({}, { accountId: 'renderer-controlled' })).toThrow('Invalid enable payload')
    expect(handlers.get('omnimind:sendManual')!({}, { sessionId: 's', text: 'x' })).toBeUndefined()
    expect(() => handlers.get('omnimind:sendManual')!({}, { accountId: 'renderer-controlled', sessionId: 's', text: 'x' })).toThrow('Invalid manual send payload')
    expect(() => handlers.get('omnimind:sendGeneratedReply')!({}, { taskId: 'x', replyText: 'renderer-controlled' })).toThrow()
    expect(handlers.get('omnimind:confirmDelivery')!({}, { taskId: 'delivery-task' })).toEqual({ runtimeState: 'running', waiting: [], recent: [] })
    expect(controller.confirmDelivery).toHaveBeenCalledWith('delivery-task')
    expect(() => handlers.get('omnimind:confirmDelivery')!({}, { taskId: 'delivery-task', status: 'sent' })).toThrow('Invalid cancel task payload')
    expect(handlers.get('omnimind:testConnection')!({}, { pythonBaseUrl: 'https://api.example.com' })).toBeUndefined()
    expect(handlers.get('omnimind:requestPermission')!({}, { permission: 'automation' })).toBeUndefined()
    expect(handlers.get('omnimind:recheckPermission')!({}, { permission: 'accessibility' })).toBeUndefined()
    expect(() => handlers.get('omnimind:recheckPermission')!({}, { permission: 'accessibility', url: 'renderer-controlled' })).toThrow('Invalid permission payload')
    expect(handlers.has('omnimind:recheckPermissions')).toBe(false)
    expect(() => handlers.get('omnimind:openPermissionSettings')!({}, { permission: 'automation', url: 'https://example.test' })).toThrow('Invalid permission payload')
    expect(handlers.get('omnimind:clearApiKey')!({}, {})).toBeUndefined()
    expect(controller.clearApiKey).toHaveBeenCalledOnce()
    expect(() => handlers.get('omnimind:clearApiKey')!({}, { clearApiKey: true })).toThrow('Invalid enable payload')
    expect(() => handlers.get('omnimind:saveSettings')!({}, {
      schemaVersion: 4,
      pythonBaseUrl: 'http://127.0.0.1:8000',
      managedScope: { mode: 'selected', conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: true,
      clearApiKey: true,
      batchWindowMs: 2000
    })).toThrow('Invalid settings payload')
    expect(() => handlers.get('omnimind:saveSettings')!({}, {
      schemaVersion: 4,
      pythonBaseUrl: 'http://127.0.0.1:8000',
      managedScope: { mode: 'selected', conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: true,
      ignoreOfficial: false,
      batchWindowMs: 2000
    })).toThrow('Invalid settings payload')
    expect(() => handlers.get('omnimind:saveSettings')!({}, {
      schemaVersion: 4,
      pythonBaseUrl: 'http://127.0.0.1:8000',
      managedScope: { mode: 'selected', conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: true,
      batchWindowMs: 2000,
      requestTimeoutMs: 15000
    })).toThrow('Invalid settings payload')
    unregister()
    expect(ipc.removeHandler).toHaveBeenCalledWith('omnimind:getSnapshot')
    expect(ipc.removeHandler).toHaveBeenCalledWith('omnimind:pause')
    expect(ipc.removeHandler).toHaveBeenCalledWith('omnimind:resume')
    expect(ipc.removeHandler).toHaveBeenCalledWith('omnimind:confirmDelivery')
    expect(ipc.removeHandler).toHaveBeenCalledTimes(19)
  })

  it('keeps preload and renderer typing on narrow snapshot-returning pause/resume methods', () => {
    const preload = readFileSync(new URL('../../electron/preload.ts', import.meta.url), 'utf8')
    const rendererTypes = readFileSync(new URL('../../src/types/electron.d.ts', import.meta.url), 'utf8')

    expect(preload).toContain("pause: () => ipcRenderer.invoke('omnimind:pause', {})")
    expect(preload).toContain("resume: () => ipcRenderer.invoke('omnimind:resume', {})")
    expect(preload).toContain("confirmDelivery: (taskId: string) => ipcRenderer.invoke('omnimind:confirmDelivery', { taskId })")
    expect(rendererTypes).toContain('pause: () => Promise<OmniMindSnapshot>')
    expect(rendererTypes).toContain('resume: () => Promise<OmniMindSnapshot>')
    expect(rendererTypes).toContain('confirmDelivery: (taskId: string) => Promise<OmniMindSnapshot>')
  })

  it('clears credentials through the Store-only command after active hosting stops fail closed', async () => {
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const order: string[] = []
    // 不运行真实构造器，只为此方法注入最小端口；验证的是 Service 编排而非文件系统或 Electron。
    const service = Object.create(OmniMindService.prototype) as any
    service.store = {
      getRendererSettings: vi.fn(async () => ({ hasApiKey: true })),
      clearApiKey: vi.fn(async () => { order.push('clear-key') })
    }
    service.runtime = {
      getState: vi.fn(() => 'running'),
      disable: vi.fn(async () => { order.push('runtime-disable') })
    }
    service.controller = { stop: vi.fn(() => { order.push('controller-stop') }) }
    service.stopActiveSubscriber = vi.fn(async () => { order.push('subscriber-stop') })
    service.broadcast = vi.fn(() => { order.push('broadcast') })
    service.ingressEnabled = true
    service.settingsMutationTail = Promise.resolve()

    await service.clearApiKey()

    expect(order).toEqual(['controller-stop', 'subscriber-stop', 'runtime-disable', 'clear-key', 'broadcast'])
    expect(service.ingressEnabled).toBe(false)
    expect(service.store.clearApiKey).toHaveBeenCalledOnce()
  })

  it('serializes save then clear so new non-Key settings survive and the old Key stays cleared', async () => {
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const saveGate = deferred<void>()
    const saveEntered = deferred<void>()
    let key: string | undefined = 'old-key'
    let current = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: true,
      batchWindowMs: 2000
    }
    const next = { ...current, pythonBaseUrl: 'https://new.example.com/api/v1/open', autoSend: false, batchWindowMs: 3500 }
    const service = Object.create(OmniMindService.prototype) as any
    service.settingsMutationTail = Promise.resolve()
    service.store = {
      getRendererSettings: vi.fn(async () => ({ ...current, hasApiKey: Boolean(key) })),
      clearApiKey: vi.fn(async () => { key = undefined })
    }
    service.runtime = {
      getState: vi.fn(() => 'stopped'),
      saveSettings: vi.fn(async (input: typeof next) => {
        saveEntered.resolve()
        await saveGate.promise
        current = { ...input }
      })
    }
    service.broadcast = vi.fn()

    const saving = service.saveSettings(next)
    await saveEntered.promise
    const clearing = service.clearApiKey()
    await Promise.resolve()
    expect(service.store.clearApiKey).not.toHaveBeenCalled()

    saveGate.resolve()
    await Promise.all([saving, clearing])

    expect(current).toEqual(next)
    expect(key).toBeUndefined()
    expect(service.store.clearApiKey).toHaveBeenCalledOnce()
  })

  it('serializes clear then save so the later command applies its new Key and all new settings', async () => {
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const clearGate = deferred<void>()
    const clearEntered = deferred<void>()
    let key: string | undefined = 'old-key'
    let current = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: true,
      batchWindowMs: 2000
    }
    const next = { ...current, pythonBaseUrl: 'https://later.example.com/api/v1/open', autoSend: false, batchWindowMs: 4000, apiKeyDraft: 'new-key' }
    const service = Object.create(OmniMindService.prototype) as any
    service.settingsMutationTail = Promise.resolve()
    service.store = {
      getRendererSettings: vi.fn(async () => ({ ...current, hasApiKey: Boolean(key) })),
      clearApiKey: vi.fn(async () => {
        clearEntered.resolve()
        await clearGate.promise
        key = undefined
      })
    }
    service.runtime = {
      getState: vi.fn(() => 'stopped'),
      saveSettings: vi.fn(async (input: typeof next) => {
        const { apiKeyDraft, ...persisted } = input
        current = persisted
        key = apiKeyDraft
      })
    }
    service.broadcast = vi.fn()

    const clearing = service.clearApiKey()
    await clearEntered.promise
    const saving = service.saveSettings(next)
    await Promise.resolve()
    expect(service.runtime.saveSettings).not.toHaveBeenCalled()

    clearGate.resolve()
    await Promise.all([clearing, saving])

    const { apiKeyDraft: _apiKeyDraft, ...persistedNext } = next
    expect(current).toEqual(persistedNext)
    expect(key).toBe('new-key')
  })

  it('continues the settings mutation queue after one command fails', async () => {
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const next = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'https://recovery.example.com/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: false,
      batchWindowMs: 2500
    }
    const service = Object.create(OmniMindService.prototype) as any
    service.settingsMutationTail = Promise.resolve()
    service.store = {
      getRendererSettings: vi.fn(async () => ({ ...next, hasApiKey: true })),
      clearApiKey: vi.fn(async () => { throw new Error('clear-failed') })
    }
    service.runtime = { getState: vi.fn(() => 'stopped'), saveSettings: vi.fn(async () => undefined) }
    service.broadcast = vi.fn()

    await expect(service.clearApiKey()).rejects.toThrow('clear-failed')
    await expect(service.saveSettings(next)).resolves.toBeUndefined()
    expect(service.runtime.saveSettings).toHaveBeenCalledWith(next, false)
  })
})
