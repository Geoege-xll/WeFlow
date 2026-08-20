import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindSnapshot } from '../../shared/omnimind/contracts'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const config = new Map<string, unknown>([
  ['myWxid', 'account-a'],
  ['dbPath', '/db'],
  ['decryptKey', 'db-key']
])

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/omnimind-wechat-pause-resume' },
  clipboard: { readText: () => '', writeText: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

vi.mock('../../electron/services/config', () => ({
  ConfigService: { getInstance: () => ({
    get: (key: string) => config.get(key),
    getAccountBundle: () => ({ myWxid: 'account-a', dbPath: '/db', decryptKey: 'db-key', imageXorKey: 0, imageAesKey: '', cachePath: '', lastOpenedDb: '' }),
    setAccountBundle: vi.fn()
  }) }
}))

vi.mock('../../electron/services/chatService', () => ({
  chatService: { getMessages: vi.fn(), getSessions: vi.fn(async () => ({ success: true, sessions: [] })) }
}))

vi.mock('../../electron/services/messagePushService', () => ({
  messagePushService: {
    handleOmniMindSubscriberChanged: vi.fn(async () => true),
    handleConfigCleared: vi.fn(),
    rebaselineForAccountChange: vi.fn(async () => true)
  }
}))

const task = (id: string, status: 'generating' | 'queued' | 'awaiting_manual_send' | 'sent') => ({
  id, sessionId: `session-${id}`, sessionName: `会话 ${id}`, status, createdAt: 1, updatedAt: 1,
  ...(status === 'awaiting_manual_send' ? { replyText: '保留草稿' } : {})
})

const preservedQueue: OmniMindSnapshot = {
  runtimeState: 'running',
  current: task('current', 'generating'),
  waiting: [task('waiting', 'queued')],
  awaitingManualSend: [task('awaiting', 'awaiting_manual_send')],
  recent: [task('recent', 'sent')]
}

describe('OmniMind service pause/resume ingress lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const createRunningService = async () => {
    const { MacOsPermissionService } = await import('../../electron/omnimind/macos-permission-service')
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const permissions = new MacOsPermissionService({
      platform: 'darwin',
      isTrustedAccessibilityClient: () => true,
      probeSystemEvents: async () => 'System Events',
      openExternal: async () => undefined
    })
    await permissions.request('automation')
    const service = new OmniMindService(permissions)
    const internals = service as unknown as {
      runtime: { state: string }
      controller: { getSnapshot: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
      ingressEnabled: boolean
      subscriberActive: boolean
      validateStart: ReturnType<typeof vi.fn>
    }
    internals.runtime.state = 'running'
    internals.ingressEnabled = true
    internals.subscriberActive = true
    internals.controller.getSnapshot = vi.fn(() => preservedQueue)
    internals.controller.start = vi.fn()
    internals.controller.stop = vi.fn()
    internals.validateStart = vi.fn(async () => ({ success: true, accountId: 'account-a' }))
    return { service, internals }
  }

  it('blocks controller/subscriber ingress before paused and preserves every queue group', async () => {
    const { service, internals } = await createRunningService()
    const { messagePushService } = await import('../../electron/services/messagePushService')

    const snapshot = await service.pause()

    expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenCalledWith(false)
    expect(internals.ingressEnabled).toBe(false)
    expect(internals.subscriberActive).toBe(false)
    expect(internals.controller.stop).not.toHaveBeenCalled()
    expect(snapshot).toMatchObject({
      runtimeState: 'paused',
      current: preservedQueue.current,
      waiting: preservedQueue.waiting,
      awaitingManualSend: preservedQueue.awaitingManualSend,
      recent: preservedQueue.recent
    })
  })

  it('revalidates then restores ingress exactly once for concurrent resume commands', async () => {
    const { service, internals } = await createRunningService()
    const { messagePushService } = await import('../../electron/services/messagePushService')
    await service.pause()
    vi.mocked(messagePushService.handleOmniMindSubscriberChanged).mockClear()

    const [first, second] = await Promise.all([service.resume(), service.resume()])

    expect(internals.validateStart).toHaveBeenCalledOnce()
    expect(internals.controller.start).toHaveBeenCalledOnce()
    expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenCalledTimes(1)
    expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenCalledWith(true)
    expect(first.runtimeState).toBe('running')
    expect(second.runtimeState).toBe('running')
    expect(first.waiting).toEqual(preservedQueue.waiting)
    expect(first.awaitingManualSend).toEqual(preservedQueue.awaitingManualSend)
  })

  it('fails closed on resume subscriber bootstrap failure without stopping or cancelling the queue', async () => {
    const { service, internals } = await createRunningService()
    const { messagePushService } = await import('../../electron/services/messagePushService')
    await service.pause()
    vi.mocked(messagePushService.handleOmniMindSubscriberChanged)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const snapshot = await service.resume()

    expect(snapshot.runtimeState).toBe('failed')
    expect(snapshot.error).toBe('subscriber_bootstrap_failed')
    expect(internals.ingressEnabled).toBe(false)
    expect(internals.controller.stop).not.toHaveBeenCalled()
    expect(snapshot.current).toEqual(preservedQueue.current)
    expect(snapshot.waiting).toEqual(preservedQueue.waiting)
    expect(snapshot.awaitingManualSend).toEqual(preservedQueue.awaitingManualSend)
    expect(snapshot.recent).toEqual(preservedQueue.recent)
  })

  it('broadcasts validating and starting while subscriber bootstrap is pending, then running only after success', async () => {
    const { service, internals } = await createRunningService()
    const { messagePushService } = await import('../../electron/services/messagePushService')
    await service.pause()
    vi.mocked(messagePushService.handleOmniMindSubscriberChanged).mockClear()
    const subscriber = deferred<boolean>()
    vi.mocked(messagePushService.handleOmniMindSubscriberChanged).mockImplementationOnce(() => subscriber.promise)
    const emitted: string[] = []
    service.setSnapshotBroadcaster((snapshot) => { emitted.push(snapshot.runtimeState) })

    const pending = service.resume()
    await vi.waitFor(() => expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenCalledWith(true))

    expect(internals.runtime.state).toBe('starting')
    expect(internals.ingressEnabled).toBe(false)
    expect(internals.subscriberActive).toBe(false)
    expect(internals.controller.start).toHaveBeenCalledOnce()
    expect(emitted).toEqual(['validating', 'starting'])
    expect(emitted).not.toContain('running')

    subscriber.resolve(true)
    const snapshot = await pending

    expect(snapshot.runtimeState).toBe('running')
    expect(internals.ingressEnabled).toBe(true)
    expect(internals.subscriberActive).toBe(true)
    expect(emitted).toEqual(['validating', 'starting', 'running'])
    expect(snapshot.waiting).toEqual(preservedQueue.waiting)
  })

  it.each(['false', 'reject'] as const)('fails directly from starting when subscriber bootstrap returns %s and never broadcasts running', async (mode) => {
    const { service, internals } = await createRunningService()
    const { messagePushService } = await import('../../electron/services/messagePushService')
    await service.pause()
    vi.mocked(messagePushService.handleOmniMindSubscriberChanged).mockClear()
    const subscriber = deferred<boolean>()
    vi.mocked(messagePushService.handleOmniMindSubscriberChanged).mockImplementationOnce(() => subscriber.promise)
    const emitted: string[] = []
    service.setSnapshotBroadcaster((snapshot) => { emitted.push(snapshot.runtimeState) })

    const pending = service.resume()
    await vi.waitFor(() => expect(internals.runtime.state).toBe('starting'))
    if (mode === 'false') subscriber.resolve(false)
    else subscriber.reject(new Error('private bootstrap failure'))
    const snapshot = await pending

    expect(emitted).toEqual(['validating', 'starting', 'failed'])
    expect(emitted).not.toContain('running')
    expect(snapshot).toMatchObject({
      runtimeState: 'failed',
      error: 'subscriber_bootstrap_failed',
      current: preservedQueue.current,
      waiting: preservedQueue.waiting,
      awaitingManualSend: preservedQueue.awaitingManualSend,
      recent: preservedQueue.recent
    })
    expect(internals.ingressEnabled).toBe(false)
    expect(internals.subscriberActive).toBe(false)
    expect(internals.controller.stop).not.toHaveBeenCalled()
    // bootstrap 从未成功，因此不能虚构一次 subscriber stop 通知。
    expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenCalledTimes(1)
    expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenCalledWith(true)
  })

  it('retries a failed bootstrap through starting and preserves the existing queue until the second bootstrap commits', async () => {
    const { service, internals } = await createRunningService()
    const { messagePushService } = await import('../../electron/services/messagePushService')
    await service.pause()
    vi.mocked(messagePushService.handleOmniMindSubscriberChanged).mockClear()
    vi.mocked(messagePushService.handleOmniMindSubscriberChanged)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const emitted: string[] = []
    service.setSnapshotBroadcaster((snapshot) => { emitted.push(snapshot.runtimeState) })

    const failed = await service.resume()
    const recovered = await service.enable()

    expect(emitted).toEqual(['validating', 'starting', 'failed', 'validating', 'starting', 'running'])
    expect(failed).toMatchObject({
      runtimeState: 'failed',
      current: preservedQueue.current,
      waiting: preservedQueue.waiting,
      awaitingManualSend: preservedQueue.awaitingManualSend,
      recent: preservedQueue.recent
    })
    expect(recovered).toMatchObject({
      runtimeState: 'running',
      current: preservedQueue.current,
      waiting: preservedQueue.waiting,
      awaitingManualSend: preservedQueue.awaitingManualSend,
      recent: preservedQueue.recent
    })
    expect(internals.controller.stop).not.toHaveBeenCalled()
    expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenNthCalledWith(1, true)
    expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenNthCalledWith(2, true)
  })
})
