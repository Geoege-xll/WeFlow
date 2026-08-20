import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let httpPushEnabled = false
const connect = vi.fn(async () => ({ success: true }))
const getSessions = vi.fn(async () => ({ success: true, sessions: [] }))
const getGroupNicknames = vi.fn(async () => ({ success: true, nicknames: {} }))

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('../../electron/services/config', () => ({
  ConfigService: { getInstance: () => ({ get: (key: string) => key === 'messagePushEnabled' ? httpPushEnabled : key === 'myWxid' ? 'a' : '', getCacheBasePath: () => '/tmp' }) }
}))
vi.mock('../../electron/services/chatService', () => ({ chatService: { connect, getSessions, close: vi.fn() } }))
vi.mock('../../electron/services/wcdbService', () => ({ wcdbService: { getGroupNicknames } }))
vi.mock('../../electron/services/httpService', () => ({ httpService: {} }))

describe('MessagePushService destination lifecycle seam', () => {
  beforeEach(() => {
    httpPushEnabled = false
    connect.mockReset().mockResolvedValue({ success: true })
    getSessions.mockReset().mockResolvedValue({ success: true, sessions: [] })
    getGroupNicknames.mockReset().mockResolvedValue({ success: true, nicknames: {} })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('uses the shared conversation classifier for message ingress session types', async () => {
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const classify = (service as unknown as { getSessionType: (sessionId: string, session: { type: number }) => string }).getSessionType.bind(service)
    expect(classify('ROOM@CHATROOM', { type: 0 })).toBe('group')
    expect(classify('GH_Service', { type: 0 })).toBe('official')
    expect(classify('session-only-private', { type: 0 })).toBe('private')
    expect(classify('placeholder_foldgroup_1', { type: 0 })).toBe('other')
  })

  it('rolls back a failed first baseline and performs a real bootstrap on the next activation', async () => {
    getSessions
      .mockResolvedValueOnce({ success: false, sessions: [] })
      .mockResolvedValueOnce({ success: true, sessions: [] })
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean; baselineReady: boolean }
    const scheduleSync = vi.spyOn(service as never, 'scheduleSync')
    service.start()

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(false)
    expect(internals.omniMindSubscriberActive).toBe(false)
    expect(internals.baselineReady).toBe(false)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(getSessions).toHaveBeenCalledTimes(1)
    service.handleDbMonitorChange('update', JSON.stringify({ table: 'Session' }))
    expect(scheduleSync).not.toHaveBeenCalled()

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getSessions).toHaveBeenCalledTimes(2)
    expect(internals.omniMindSubscriberActive).toBe(true)
    expect(internals.baselineReady).toBe(true)
    service.stop()
  })

  it('rolls back a rejected baseline without leaking the stale destination into retry', async () => {
    getSessions
      .mockRejectedValueOnce(new Error('private database detail'))
      .mockResolvedValueOnce({ success: true, sessions: [] })
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean; baselineReady: boolean }
    service.start()

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(false)
    expect(internals.omniMindSubscriberActive).toBe(false)
    expect(internals.baselineReady).toBe(false)

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getSessions).toHaveBeenCalledTimes(2)
    expect(internals.omniMindSubscriberActive).toBe(true)
    service.stop()
  })

  it('keeps connection failure details private and retries the full bootstrap', async () => {
    connect
      .mockResolvedValueOnce({ success: false, error: '/private/database/account-a' })
      .mockResolvedValueOnce({ success: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean }
    service.start()

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(false)
    expect(internals.omniMindSubscriberActive).toBe(false)
    expect(warn).toHaveBeenCalledWith('[MessagePushService] Bootstrap connect failed (omnimind-subscriber-bootstrap)')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/private/database/account-a')

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getSessions).toHaveBeenCalledOnce()
    expect(internals.omniMindSubscriberActive).toBe(true)
    warn.mockRestore()
    service.stop()
  })

  it('coalesces concurrent activation into one bootstrap transaction', async () => {
    const connection = deferred<{ success: boolean }>()
    connect.mockImplementationOnce(() => connection.promise)
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean }
    service.start()

    const first = service.handleOmniMindSubscriberChanged(true)
    const second = service.handleOmniMindSubscriberChanged(true)
    expect(second).toBe(first)
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
    expect(internals.omniMindSubscriberActive).toBe(false)

    connection.resolve({ success: true })
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(connect).toHaveBeenCalledOnce()
    expect(getSessions).toHaveBeenCalledOnce()
    expect(internals.omniMindSubscriberActive).toBe(true)
    service.stop()
  })

  it('lets a newer stop invalidate pending activation and prevents late success from restoring it', async () => {
    const connection = deferred<{ success: boolean }>()
    connect.mockImplementationOnce(() => connection.promise)
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean; baselineReady: boolean }
    service.start()

    const activating = service.handleOmniMindSubscriberChanged(true)
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
    const stopping = service.handleOmniMindSubscriberChanged(false)
    connection.resolve({ success: true })

    await expect(activating).resolves.toBe(false)
    await expect(stopping).resolves.toBe(true)
    expect(internals.omniMindSubscriberActive).toBe(false)
    expect(internals.baselineReady).toBe(false)
    // false 在 connect pending 时已失效旧事务，因此不应继续读取或提交 baseline。
    expect(getSessions).not.toHaveBeenCalled()

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getSessions).toHaveBeenCalledOnce()
    expect(internals.omniMindSubscriberActive).toBe(true)
    service.stop()
  })

  it('preserves an established HTTP destination while OmniMind joins and leaves', async () => {
    httpPushEnabled = true
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean; baselineReady: boolean }
    service.start()
    await vi.waitFor(() => expect(internals.baselineReady).toBe(true))

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    expect(internals.omniMindSubscriberActive).toBe(true)
    expect(connect).toHaveBeenCalledOnce()
    expect(getSessions).toHaveBeenCalledOnce()

    await expect(service.handleOmniMindSubscriberChanged(false)).resolves.toBe(true)
    expect(internals.omniMindSubscriberActive).toBe(false)
    expect(internals.baselineReady).toBe(true)
    expect(connect).toHaveBeenCalledOnce()
    service.stop()
  })

  it('does not treat an HTTP configuration with a failed connect as an active destination', async () => {
    httpPushEnabled = true
    connect
      .mockResolvedValueOnce({ success: false, error: 'private-startup-detail' })
      .mockResolvedValueOnce({ success: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as {
      omniMindSubscriberActive: boolean
      baselineReady: boolean
      sharedBootstrap?: { promise: Promise<boolean> }
    }
    const scheduleSync = vi.spyOn(service as never, 'scheduleSync')

    service.start()
    const startup = internals.sharedBootstrap?.promise
    expect(startup).toBeDefined()
    await expect(startup).resolves.toBe(false)
    expect(internals.baselineReady).toBe(false)
    service.handleDbMonitorChange('update', JSON.stringify({ table: 'Session' }))
    expect(scheduleSync).not.toHaveBeenCalled()

    // HTTP 只是“已配置”，失败后 OmniMind 加入必须重新执行真实 connect/baseline。
    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getSessions).toHaveBeenCalledOnce()
    expect(internals.omniMindSubscriberActive).toBe(true)
    expect(internals.baselineReady).toBe(true)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-startup-detail')
    warn.mockRestore()
    service.stop()
  })

  it('retries a real baseline after HTTP startup returns an unsuccessful baseline result', async () => {
    httpPushEnabled = true
    getSessions
      .mockResolvedValueOnce({ success: false, sessions: [] })
      .mockResolvedValueOnce({ success: true, sessions: [] })
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as {
      omniMindSubscriberActive: boolean
      baselineReady: boolean
      sharedBootstrap?: { promise: Promise<boolean> }
    }

    service.start()
    const startup = internals.sharedBootstrap?.promise
    expect(startup).toBeDefined()
    await expect(startup).resolves.toBe(false)

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getSessions).toHaveBeenCalledTimes(2)
    expect(internals.omniMindSubscriberActive).toBe(true)
    expect(internals.baselineReady).toBe(true)
    service.stop()
  })

  it('retries a real baseline after HTTP startup baseline rejects', async () => {
    httpPushEnabled = true
    getSessions
      .mockRejectedValueOnce(new Error('private-baseline-detail'))
      .mockResolvedValueOnce({ success: true, sessions: [] })
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as {
      omniMindSubscriberActive: boolean
      baselineReady: boolean
      sharedBootstrap?: { promise: Promise<boolean> }
    }

    service.start()
    const startup = internals.sharedBootstrap?.promise
    expect(startup).toBeDefined()
    await expect(startup).resolves.toBe(false)

    await expect(service.handleOmniMindSubscriberChanged(true)).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getSessions).toHaveBeenCalledTimes(2)
    expect(internals.omniMindSubscriberActive).toBe(true)
    expect(internals.baselineReady).toBe(true)
    service.stop()
  })

  it('joins OmniMind activation to the pending HTTP startup bootstrap', async () => {
    httpPushEnabled = true
    const connection = deferred<{ success: boolean }>()
    connect.mockImplementationOnce(() => connection.promise)
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean; baselineReady: boolean }

    service.start()
    const activating = service.handleOmniMindSubscriberChanged(true)
    let settled = false
    void activating.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(connect).toHaveBeenCalledOnce()
    expect(internals.omniMindSubscriberActive).toBe(false)

    connection.resolve({ success: true })
    await expect(activating).resolves.toBe(true)
    expect(connect).toHaveBeenCalledOnce()
    expect(getSessions).toHaveBeenCalledOnce()
    expect(internals.omniMindSubscriberActive).toBe(true)
    expect(internals.baselineReady).toBe(true)
    service.stop()
  })

  it('returns false to a joined OmniMind activation when pending HTTP bootstrap fails', async () => {
    httpPushEnabled = true
    const connection = deferred<{ success: boolean }>()
    connect.mockImplementationOnce(() => connection.promise)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean; baselineReady: boolean }

    service.start()
    const activating = service.handleOmniMindSubscriberChanged(true)
    connection.resolve({ success: false })
    await expect(activating).resolves.toBe(false)
    expect(connect).toHaveBeenCalledOnce()
    expect(getSessions).not.toHaveBeenCalled()
    expect(internals.omniMindSubscriberActive).toBe(false)
    expect(internals.baselineReady).toBe(false)
    warn.mockRestore()
    service.stop()
  })

  it('returns false to a joined OmniMind activation when pending HTTP baseline rejects', async () => {
    httpPushEnabled = true
    const baseline = deferred<{ success: boolean; sessions: never[] }>()
    getSessions.mockImplementationOnce(() => baseline.promise)
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const service = new MessagePushService()
    const internals = service as unknown as { omniMindSubscriberActive: boolean; baselineReady: boolean }

    service.start()
    const activating = service.handleOmniMindSubscriberChanged(true)
    await vi.waitFor(() => expect(getSessions).toHaveBeenCalledOnce())
    baseline.reject(new Error('private-baseline-detail'))
    await expect(activating).resolves.toBe(false)
    expect(connect).toHaveBeenCalledOnce()
    expect(getSessions).toHaveBeenCalledOnce()
    expect(internals.omniMindSubscriberActive).toBe(false)
    expect(internals.baselineReady).toBe(false)
    service.stop()
  })

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
    const activating = service.handleOmniMindSubscriberChanged(true)
    service.stop()
    resolveConnect({ success: true })
    await expect(activating).resolves.toBe(false)

    expect(getSessions).not.toHaveBeenCalled()
    expect((service as unknown as { omniMindSubscriberActive: boolean }).omniMindSubscriberActive).toBe(false)
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
    // flush 只允许已提交 destination；手工搭建该前置条件以专测 stop 的 generation 边界。
    Object.assign(service, { started: true, generation: 7, baselineReady: true })
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
    // flush 只允许已提交 destination；手工搭建该前置条件以隔离 processing generation 行为。
    Object.assign(internals, { started: true, generation: 10, baselineReady: true })

    const oldFlush = internals.flushPendingChanges()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    service.stop()
    Object.assign(internals, { started: true, generation: 12, baselineReady: true })
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
    const generate = vi.fn(async (task) => {
      expect(task.inboundMessages).toEqual([
        expect.objectContaining({
          sessionId: 's', messageKey: 'm', senderExternalId: 's', senderDisplayName: 'Alice', timestamp: 100
        })
      ])
      return { kind: 'reply' as const, text: 'reply' }
    })
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

  it('群聊事件只传播消息行 sender，缺失时绝不回退为 chatroom 房间 ID', async () => {
    const { MessagePushService } = await import('../../electron/services/messagePushService')
    const { normalizedMessageEventHub } = await import('../../electron/omnimind/normalized-message-event-hub')
    normalizedMessageEventHub.reset()
    const received: unknown[] = []
    const unsubscribe = normalizedMessageEventHub.subscribe((event) => received.push(event))
    const service = new MessagePushService()
    const emitPayload = (service as unknown as { emitPayload(payload: unknown, message: unknown): boolean }).emitPayload.bind(service)

    emitPayload(
      { event: 'message.new', sessionId: 'room@chatroom', sessionType: 'group', rawid: '1', sourceName: 'Bob', groupName: '群聊', content: '有 sender', timestamp: 100 },
      { messageKey: 'group-message-1', senderUsername: 'wxid-bob', isSend: 0, localType: 1 }
    )
    emitPayload(
      { event: 'message.new', sessionId: 'room@chatroom', sessionType: 'group', rawid: '2', sourceName: '未知发送者', groupName: '群聊', content: '无 sender', timestamp: 101 },
      { messageKey: 'group-message-2', senderUsername: null, isSend: 0, localType: 1 }
    )
    emitPayload(
      { event: 'message.new', sessionId: 'room@chatroom', sessionType: 'group', rawid: '3', sourceName: '错误房间回退', groupName: '群聊', content: 'room 伪 sender', timestamp: 102 },
      { messageKey: 'group-message-3', senderUsername: 'ROOM@CHATROOM', isSend: 0, localType: 1 }
    )

    expect(received).toEqual([
      expect.objectContaining({ sessionId: 'room@chatroom', senderExternalId: 'wxid-bob', senderDisplayName: 'Bob' }),
      expect.objectContaining({ sessionId: 'room@chatroom', senderExternalId: undefined, senderDisplayName: undefined }),
      expect.objectContaining({ sessionId: 'room@chatroom', senderExternalId: undefined, senderDisplayName: undefined })
    ])
    expect(JSON.stringify(received[1])).not.toContain('senderExternalId')
    expect(JSON.stringify(received[2])).not.toContain('ROOM@CHATROOM')
    unsubscribe()
    normalizedMessageEventHub.reset()
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
    await expect(store.getRendererSettings()).resolves.toMatchObject({ schemaVersion: 4, managedScope: { mode: 'selected' } })
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
