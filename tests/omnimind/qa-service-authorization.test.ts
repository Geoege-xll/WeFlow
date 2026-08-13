import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = new Map<string, unknown>([
  ['myWxid', 'account-a'],
  ['dbPath', '/db'],
  ['decryptKey', 'db-key']
])

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/weflow-qa-omnimind' },
  clipboard: { readText: () => '', writeText: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

vi.mock('../../electron/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      get: (key: string) => config.get(key),
      getAccountBundle: () => ({
        myWxid: String(config.get('myWxid') || ''),
        dbPath: String(config.get('dbPath') || ''),
        decryptKey: String(config.get('decryptKey') || ''),
        imageXorKey: 0,
        imageAesKey: '',
        cachePath: '',
        lastOpenedDb: ''
      }),
      setAccountBundle: vi.fn()
    })
  }
}))

vi.mock('../../electron/services/chatService', () => ({
  chatService: {
    getMessages: vi.fn(),
    getSessions: vi.fn(async () => ({ success: true, sessions: [] }))
  }
}))

vi.mock('../../electron/services/messagePushService', () => ({
  messagePushService: {
    handleOmniMindSubscriberChanged: vi.fn(async () => true),
    handleConfigCleared: vi.fn(),
    rebaselineForAccountChange: vi.fn(async () => true)
  }
}))

describe('OmniMind generated-reply authorization seam', () => {
  const createAuthorizedService = async () => {
    const { MacOsPermissionService } = await import('../../electron/omnimind/macos-permission-service')
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const permissions = new MacOsPermissionService({
      platform: 'darwin',
      isTrustedAccessibilityClient: () => true,
      probeSystemEvents: async () => 'System Events',
      openExternal: async () => undefined
    })
    await permissions.request('automation')
    return new OmniMindService(permissions)
  }

  beforeEach(() => {
    config.set('myWxid', 'account-a')
    config.set('dbPath', '/db')
    config.set('decryptKey', 'db-key')
  })

  it('fails closed when an awaiting reply belongs to a previous account', async () => {
    const service = await createAuthorizedService()
    const internals = service as unknown as {
      autoSend: boolean
      store: {
        getRendererSettings: () => Promise<unknown>
        getApiKey: () => Promise<string>
      }
      python: { chat: () => Promise<{ kind: 'reply'; text: string }> }
      sender: { sendAutomatic: ReturnType<typeof vi.fn> }
      controller: { queue: {
        enqueue: (input: { accountId: string; sessionId: string; sessionName: string; messageKeys: string[]; text: string }) => { id: string }
        whenIdle: () => Promise<void>
        findTask: (taskId: string) => { status: string } | undefined
      } }
    }
    internals.autoSend = false
    internals.store.getRendererSettings = async () => ({
      schemaVersion: 2,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected', conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: false,
      ignoreOfficial: true,
      hasApiKey: true,
      batchWindowMs: 2000,
      requestTimeoutMs: 15000
    })
    internals.store.getApiKey = async () => 'api-key'
    internals.python.chat = async () => ({ kind: 'reply', text: 'reply for account A' })
    internals.sender.sendAutomatic = vi.fn(async () => ({ success: true, verifiedMessageKey: 'sent' }))

    const task = internals.controller.queue.enqueue({
      accountId: 'account-a',
      sessionId: 'alice',
      sessionName: 'Alice',
      messageKeys: ['message-a'],
      text: 'customer input'
    })
    await internals.controller.queue.whenIdle()
    expect(internals.controller.queue.findTask(task.id)?.status).toBe('awaiting_manual_send')

    config.set('myWxid', 'account-b')
    await expect(service.sendGeneratedReply(task.id)).resolves.toEqual({
      success: false,
      error: 'current_account_changed'
    })
    expect(internals.sender.sendAutomatic).not.toHaveBeenCalled()
  })

  it('revalidates scope, official policy, and decryptable credentials with typed failures', async () => {
    const service = await createAuthorizedService()
    let settings = {
      schemaVersion: 2 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [] as Array<{ sessionId: string; displayName: string }> },
      autoSend: false, ignoreOfficial: true, hasApiKey: true, batchWindowMs: 2000, requestTimeoutMs: 15000
    }
    const internals = service as unknown as {
      store: { getRendererSettings: () => Promise<typeof settings>; getApiKey: () => Promise<string | undefined> }
      authorizeGeneratedReply: (task: { accountId: string; sessionId: string; sessionName: string; sessionType: 'official'; messageKeys: string[]; text: string; id: string; status: 'awaiting_manual_send'; createdAt: number; updatedAt: number; replyText: string }) => Promise<unknown>
    }
    internals.store.getRendererSettings = async () => settings
    internals.store.getApiKey = async () => 'api-key'
    const task = { accountId: 'account-a', sessionId: 'official', sessionName: 'Official', sessionType: 'official' as const, messageKeys: ['m'], text: 'private', id: 'task', status: 'awaiting_manual_send' as const, createdAt: 1, updatedAt: 1, replyText: 'reply' }

    await expect(internals.authorizeGeneratedReply(task)).resolves.toEqual({ success: false, error: 'managed_scope_changed' })
    settings = { ...settings, managedScope: { mode: 'selected', conversations: [{ sessionId: ' Official ', displayName: 'Official' }] } }
    await expect(internals.authorizeGeneratedReply(task)).resolves.toEqual({ success: false, error: 'official_account_filtered' })
    settings = { ...settings, ignoreOfficial: false }
    internals.store.getApiKey = async () => { throw new Error('decrypt failed') }
    await expect(internals.authorizeGeneratedReply(task)).resolves.toEqual({ success: false, error: 'api_key_unavailable' })
  })

  it('rechecks the current account after the generated reply acquires the shared sender mutex', async () => {
    const service = await createAuthorizedService()
    let releaseBlocker!: () => void
    const blocker = new Promise<void>((resolve) => { releaseBlocker = resolve })
    const sentTexts: string[] = []
    const settings = {
      schemaVersion: 2 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: false,
      ignoreOfficial: true,
      hasApiKey: true,
      batchWindowMs: 2000,
      requestTimeoutMs: 15000
    }
    const internals = service as unknown as {
      autoSend: boolean
      store: { getRendererSettings: () => Promise<typeof settings>; getApiKey: () => Promise<string> }
      python: { chat: ReturnType<typeof vi.fn> }
      sender: {
        dependencies: {
          adapter: { sendText: (input: { text: string }) => Promise<{ success: boolean; sentAt: number }> }
          verifier: { captureBaseline: () => Promise<unknown>; verify: () => Promise<{ success: boolean; verifiedMessageKey: string }> }
        }
        sendManual: (input: { accountId: string; sessionId: string; text: string }) => Promise<unknown>
      }
      controller: { queue: {
        enqueue: (input: { accountId: string; sessionId: string; sessionName: string; messageKeys: string[]; text: string }) => { id: string }
        whenIdle: () => Promise<void>
        findTask: (taskId: string) => { status: string } | undefined
      } }
    }
    internals.autoSend = false
    internals.store.getRendererSettings = async () => settings
    internals.store.getApiKey = async () => 'api-key'
    internals.python.chat = vi.fn(async () => ({ kind: 'reply', text: 'generated reply' }))
    internals.sender.dependencies.adapter = {
      sendText: async ({ text }) => {
        sentTexts.push(text)
        if (text === 'mutex blocker') await blocker
        return { success: true, sentAt: 1 }
      }
    }
    internals.sender.dependencies.verifier = { captureBaseline: async () => undefined, verify: async () => ({ success: true, verifiedMessageKey: 'verified' }) }

    const task = internals.controller.queue.enqueue({ accountId: 'account-a', sessionId: 'alice', sessionName: 'Alice', messageKeys: ['m'], text: 'private input' })
    await internals.controller.queue.whenIdle()
    const blockingSend = internals.sender.sendManual({ accountId: 'account-a', sessionId: 'other', text: 'mutex blocker' })
    await vi.waitFor(() => expect(sentTexts).toEqual(['mutex blocker']))

    const generatedSend = service.sendGeneratedReply(task.id)
    await vi.waitFor(() => expect(internals.controller.queue.findTask(task.id)?.status).toBe('waiting_to_send'))
    config.set('myWxid', 'account-b')
    releaseBlocker()

    await blockingSend
    await expect(generatedSend).resolves.toEqual({ success: false, stage: 'authorization', error: 'current_account_changed' })
    expect(sentTexts).toEqual(['mutex blocker'])
    expect(internals.controller.queue.findTask(task.id)?.status).toBe('send_failed')
  })

  it('preserves an unconfirmed delivery and prohibits blind retry', async () => {
    const service = await createAuthorizedService()
    const settings = {
      schemaVersion: 2 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'all' as const, confirmedAt: 1 },
      autoSend: true,
      ignoreOfficial: false,
      hasApiKey: true,
      batchWindowMs: 2000,
      requestTimeoutMs: 15000
    }
    const sendText = vi.fn(async () => ({ success: true, sentAt: 1 }))
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'preserved reply' }))
    const internals = service as unknown as {
      autoSend: boolean
      store: { getRendererSettings: () => Promise<typeof settings>; getApiKey: () => Promise<string> }
      python: { chat: typeof generate }
      sender: { dependencies: { adapter: { sendText: typeof sendText }; verifier: { captureBaseline: () => Promise<unknown>; verify: () => Promise<{ success: boolean; error: string }> } } }
      controller: { queue: {
        enqueue: (input: { accountId: string; sessionId: string; sessionName: string; messageKeys: string[]; text: string }) => { id: string }
        whenIdle: () => Promise<void>
        findTask: (taskId: string) => { id: string; status: string; replyText?: string; reason?: string } | undefined
      } }
    }
    internals.autoSend = true
    internals.store.getRendererSettings = async () => settings
    internals.store.getApiKey = async () => 'api-key'
    internals.python.chat = generate
    internals.sender.dependencies.adapter = { sendText }
    internals.sender.dependencies.verifier = { captureBaseline: async () => undefined, verify: async () => ({ success: false, error: 'outbound_not_verified' }) }

    const task = internals.controller.queue.enqueue({ accountId: 'account-a', sessionId: 'alice', sessionName: 'Alice', messageKeys: ['m'], text: 'private input' })
    await internals.controller.queue.whenIdle()
    expect(internals.controller.queue.findTask(task.id)).toMatchObject({ id: task.id, status: 'delivery_unconfirmed', replyText: 'preserved reply', reason: 'outbound_not_verified' })
    expect(sendText).toHaveBeenCalledTimes(1)

    config.set('myWxid', 'account-b')
    expect(service.retryTask(task.id)).toBe(false)
    await internals.controller.queue.whenIdle()

    expect(generate).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(internals.controller.queue.findTask(task.id)).toMatchObject({ id: task.id, status: 'delivery_unconfirmed', replyText: 'preserved reply', reason: 'outbound_not_verified' })
  })

  it.each([false, true])('fails generated and automatic/retry paths closed after Automation revocation (autoSend=%s)', async (autoSend) => {
    const { MacOsPermissionService } = await import('../../electron/omnimind/macos-permission-service')
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const probeSystemEvents = vi.fn()
      .mockResolvedValueOnce('System Events')
      .mockRejectedValue(Object.assign(new Error('private native detail'), { code: -1743 }))
    const permissions = new MacOsPermissionService({
      platform: 'darwin', isTrustedAccessibilityClient: () => true,
      probeSystemEvents, openExternal: async () => undefined
    })
    await permissions.request('automation')
    const service = new OmniMindService(permissions)
    const settings = {
      schemaVersion: 2 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend, ignoreOfficial: false, hasApiKey: true, batchWindowMs: 2000, requestTimeoutMs: 15000
    }
    const captureBaseline = vi.fn(async () => undefined)
    const sendText = vi.fn(async () => ({ success: true, sentAt: 1 }))
    const verify = vi.fn(async () => ({ success: true, verifiedMessageKey: 'private-key' }))
    const internals = service as unknown as {
      autoSend: boolean
      store: { getRendererSettings: () => Promise<typeof settings>; getApiKey: () => Promise<string> }
      python: { chat: () => Promise<{ kind: 'reply'; text: string }> }
      sender: { dependencies: { adapter: { sendText: typeof sendText }; verifier: { captureBaseline: typeof captureBaseline; verify: typeof verify } } }
      controller: { queue: {
        enqueue: (input: { accountId: string; sessionId: string; sessionName: string; messageKeys: string[]; text: string }) => { id: string }
        whenIdle: () => Promise<void>
        findTask: (taskId: string) => { status: string; replyText?: string; reason?: string } | undefined
      } }
    }
    internals.autoSend = autoSend
    internals.store.getRendererSettings = async () => settings
    internals.store.getApiKey = async () => 'api-key'
    internals.python.chat = async () => ({ kind: 'reply', text: 'preserved reply' })
    internals.sender.dependencies.adapter = { sendText }
    internals.sender.dependencies.verifier = { captureBaseline, verify }
    const task = internals.controller.queue.enqueue({ accountId: 'account-a', sessionId: 'alice', sessionName: 'Alice', messageKeys: ['private-message'], text: 'private input' })
    await internals.controller.queue.whenIdle()

    if (autoSend) {
      expect(internals.controller.queue.findTask(task.id)).toMatchObject({ status: 'send_failed', replyText: 'preserved reply', reason: 'automation_permission_denied' })
      expect(service.retryTask(task.id)).toBe(true)
      await internals.controller.queue.whenIdle()
      expect(internals.controller.queue.findTask(task.id)).toMatchObject({ status: 'send_failed', replyText: 'preserved reply', reason: 'automation_permission_denied' })
    } else {
      expect(internals.controller.queue.findTask(task.id)).toMatchObject({ status: 'awaiting_manual_send', replyText: 'preserved reply' })
      await expect(service.sendGeneratedReply(task.id)).resolves.toEqual({ success: false, error: 'automation_permission_denied' })
      expect(internals.controller.queue.findTask(task.id)).toMatchObject({ status: 'awaiting_manual_send', replyText: 'preserved reply' })
    }
    expect(captureBaseline).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
  })
})
