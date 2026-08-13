import { beforeEach, describe, expect, it, vi } from 'vitest'

let httpPushEnabled = false
const connect = vi.fn(async () => ({ success: true }))
const getSessions = vi.fn(async () => ({ success: true, sessions: [] }))
const getGroupNicknames = vi.fn(async () => ({ success: true, nicknames: {} }))

vi.mock('../../electron/services/config', () => ({
  ConfigService: { getInstance: () => ({ get: (key: string) => key === 'messagePushEnabled' ? httpPushEnabled : key === 'myWxid' ? 'a' : '', getCacheBasePath: () => '/tmp' }) }
}))
vi.mock('../../electron/services/chatService', () => ({ chatService: { connect, getSessions, close: vi.fn() } }))
vi.mock('../../electron/services/wcdbService', () => ({ wcdbService: { getGroupNicknames } }))
vi.mock('../../electron/services/httpService', () => ({ httpService: {} }))

describe('MessagePushService destination lifecycle seam', () => {
  beforeEach(() => { httpPushEnabled = false; connect.mockClear(); getSessions.mockClear(); getGroupNicknames.mockClear() })

  it('bootstraps only no-destination to first-destination and never reconnects after stop', async () => {
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    service.start()
    await service.handleOmniMindSubscriberChanged(true)
    expect(connect).toHaveBeenCalledTimes(1)
    await service.handleOmniMindSubscriberChanged(true)
    expect(connect).toHaveBeenCalledTimes(1)
    service.stop()
    await service.handleOmniMindSubscriberChanged(false)
    await service.handleOmniMindSubscriberChanged(true)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('does not continue an in-flight bootstrap after the service is stopped', async () => {
    httpPushEnabled = true
    let resolveConnect!: (value: { success: boolean }) => void
    connect.mockImplementationOnce(() => new Promise((resolve) => { resolveConnect = resolve }))
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()

    service.start()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    service.stop()
    resolveConnect({ success: true })
    await Promise.resolve()
    await Promise.resolve()

    expect(getSessions).not.toHaveBeenCalled()
  })

  it('does not let an old bootstrap continuation pollute a restarted generation', async () => {
    httpPushEnabled = true
    let resolveOld!: (value: { success: boolean }) => void
    connect.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve })).mockResolvedValueOnce({ success: true })
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    service.start()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    service.stop(); service.start()
    await vi.waitFor(() => expect(getSessions).toHaveBeenCalledTimes(1))
    resolveOld({ success: true })
    await Promise.resolve()
    expect(getSessions).toHaveBeenCalledTimes(1)
  })

  it('abandons an in-flight flush connect when stopped', async () => {
    httpPushEnabled = true
    let resolveFlush!: (value: { success: boolean }) => void
    connect.mockImplementationOnce(() => new Promise((resolve) => { resolveFlush = resolve }))
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    Object.assign(service, { started: true, generation: 7 })
    const flushing = (service as unknown as { flushPendingChanges(): Promise<void> }).flushPendingChanges()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    service.stop(); resolveFlush({ success: true }); await flushing
    expect(getSessions).not.toHaveBeenCalled()
  })

  it('does not let an old flush finally clear the processing state of a restarted generation', async () => {
    httpPushEnabled = true
    let resolveOld!: (value: { success: boolean }) => void
    let resolveNew!: (value: { success: boolean }) => void
    connect
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve }))
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { started: boolean; generation: number; processing: boolean; rerunRequested: boolean; flushPendingChanges(): Promise<void> }
    Object.assign(internals, { started: true, generation: 10 })

    const oldFlush = internals.flushPendingChanges()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    service.stop()
    Object.assign(internals, { started: true, generation: 12 })
    const newFlush = internals.flushPendingChanges()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))

    resolveOld({ success: true })
    await oldFlush
    expect(internals.processing).toBe(true)

    await internals.flushPendingChanges()
    expect(connect).toHaveBeenCalledTimes(2)
    expect(internals.rerunRequested).toBe(true)

    resolveNew({ success: true })
    await newFlush
    expect(internals.processing).toBe(false)
    service.stop()
  })

  it('does not repopulate shared nickname cache from an old generation helper', async () => {
    let resolveOld!: (value: { success: boolean; nicknames: Record<string, string> }) => void
    getGroupNicknames.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { started: boolean; generation: number; groupNicknameCache: Map<string, unknown>; getGroupNicknames(id: string): Promise<Record<string, string>> }
    Object.assign(internals, { started: true, generation: 20 })
    const old = internals.getGroupNicknames('group-a')
    await vi.waitFor(() => expect(getGroupNicknames).toHaveBeenCalledTimes(1))
    service.stop(); Object.assign(internals, { started: true, generation: 22 })
    resolveOld({ success: true, nicknames: { member: 'Old Nickname' } })
    await old
    expect(internals.groupNicknameCache.size).toBe(0)
  })

  it('does not reset or bootstrap when HTTP already supplies the active destination', async () => {
    httpPushEnabled = true
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    service.start()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    await service.handleOmniMindSubscriberChanged(true)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('delivers the production normalized MessagePush event through controller filtering and batching to mocked generation and sender ports once', async () => {
    vi.useFakeTimers()
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const { normalizedMessageEventHub } = await import('../../electron/omnimind/normalized-message-event-hub')
    const { OmniMindController } = await import('../../electron/omnimind/omnimind-controller')
    normalizedMessageEventHub.reset()
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'reply' }))
    const send = vi.fn(async () => ({ success: true }))
    const controller = new OmniMindController({ hub: normalizedMessageEventHub, generate, send, batchDelayMs: 2000, accountId: () => 'a', scope: () => ['s'] })
    controller.start()
    const service = new MessagePushService()
    const emitPayload = (service as unknown as { emitPayload(payload: unknown, message: unknown): boolean }).emitPayload.bind(service)
    emitPayload({ event: 'message.new', sessionId: 's', sessionType: 'private', rawid: 'r', sourceName: 'Alice', content: 'hello', timestamp: 100 }, { messageKey: 'm', isSend: 0, localType: 1 })
    emitPayload({ event: 'message.new', sessionId: 's', sessionType: 'private', rawid: 'r', sourceName: 'Alice', content: 'hello', timestamp: 100 }, { messageKey: 'm', isSend: 0, localType: 1 })
    await vi.advanceTimersByTimeAsync(2000)
    await controller.whenIdle()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    controller.stop(); normalizedMessageEventHub.reset(); vi.useRealTimers()
  })

  it('reports a failed account-change baseline instead of hiding it from the coordinator', async () => {
    httpPushEnabled = true
    connect.mockResolvedValueOnce({ success: false, error: 'new-account-unavailable' })
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()

    await expect(service.handleConfigChanged('myWxid')).resolves.toBe(false)
  })

  it('establishes a one-shot account baseline without enabling either destination', async () => {
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const emit = vi.spyOn(service as never, 'emitPayload')

    await expect(service.rebaselineForAccountChange()).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(getSessions).toHaveBeenCalledTimes(1)
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not replay baseline history after a v1 settings bundle is migrated to v2', async () => {
    const storage = new Map<string, string>([['settings', JSON.stringify({ pythonBaseUrl: 'http://localhost:8000', scope: ['s'], officialAccountPolicy: 'ignore' })]])
    const { SecureOmniMindSettingsStore } = await import('../../electron/omnimind/secure-settings-store')
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => storage.get(key), writeAtomic: async (key, value) => { storage.set(key, value) }
    })
    await expect(store.getRendererSettings()).resolves.toMatchObject({ schemaVersion: 2, managedScope: { mode: 'selected' } })
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const emit = vi.spyOn(service as never, 'emitPayload')
    await expect(service.rebaselineForAccountChange()).resolves.toBe(true)
    expect(emit).not.toHaveBeenCalled()
  })

  it('propagates a one-shot baseline read failure without activating destinations', async () => {
    getSessions.mockResolvedValueOnce({ success: false, sessions: [] })
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()

    await expect(service.rebaselineForAccountChange()).resolves.toBe(false)
  })
})
