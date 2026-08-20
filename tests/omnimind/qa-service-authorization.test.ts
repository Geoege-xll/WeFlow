import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = new Map<string, unknown>([
  ['myWxid', 'account-a'],
  ['dbPath', '/db'],
  ['decryptKey', 'db-key']
])

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/omnimind-wechat-qa-omnimind' },
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

  beforeEach(async () => {
    vi.clearAllMocks()
    const { chatService } = await import('../../electron/services/chatService')
    vi.mocked(chatService.getSessions).mockResolvedValue({ success: true, sessions: [
      { username: 'alice', displayName: 'Alice' },
      { username: 'official', displayName: 'Official' },
      { username: 'other', displayName: 'Other' }
    ] } as never)
    config.set('myWxid', 'account-a')
    config.set('dbPath', '/db')
    config.set('decryptKey', 'db-key')
  })

  it('启动 preflight 在窗口未就绪时 fail closed，不启动 controller 或 subscriber', async () => {
    const service = await createAuthorizedService()
    const { messagePushService } = await import('../../electron/services/messagePushService')
    const order: string[] = []
    const settings = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'all' as const, confirmedAt: 1 },
      autoSend: true,
      hasApiKey: true,
      batchWindowMs: 2000
    }
    const internals = service as unknown as {
      store: { getRendererSettings: () => Promise<typeof settings> }
      permissions: { authorizeAction: ReturnType<typeof vi.fn> }
      wechatReadiness: { checkReadiness: ReturnType<typeof vi.fn> }
      testConnection: ReturnType<typeof vi.fn>
      controller: { start: ReturnType<typeof vi.fn> }
    }
    internals.permissions.authorizeAction = vi.fn(async () => { order.push('permission'); return undefined })
    internals.store.getRendererSettings = async () => { order.push('settings'); return settings }
    internals.wechatReadiness.checkReadiness = vi.fn(async () => {
      order.push('wechat-readiness')
      return { success: false, stage: 'automation', error: 'wechat_window_recovery_timeout' }
    })
    internals.testConnection = vi.fn(async () => { order.push('connection'); return { success: true } })
    internals.controller.start = vi.fn()

    await expect(service.enable()).resolves.toMatchObject({
      runtimeState: 'failed',
      error: 'wechat_window_recovery_timeout'
    })
    expect(order).toEqual(['permission', 'settings', 'wechat-readiness'])
    expect(internals.wechatReadiness.checkReadiness).toHaveBeenCalledWith({ restoreFocus: true })
    expect(internals.testConnection).not.toHaveBeenCalled()
    expect(internals.controller.start).not.toHaveBeenCalled()
    expect(messagePushService.handleOmniMindSubscriberChanged).not.toHaveBeenCalled()
  })

  it('启动就绪后才连接 Python 并进入 running，发送时仍使用同一 readiness 二次复核', async () => {
    const service = await createAuthorizedService()
    const { messagePushService } = await import('../../electron/services/messagePushService')
    const order: string[] = []
    const settings = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'all' as const, confirmedAt: 1 },
      autoSend: true,
      hasApiKey: true,
      batchWindowMs: 2000
    }
    const checkReadiness = vi.fn()
      .mockImplementationOnce(async () => { order.push('wechat-readiness'); return { success: true } })
      .mockResolvedValueOnce({ success: false, stage: 'automation', error: 'wechat_process_unavailable' })
    const runAppleScript = vi.fn(async (_script: string, args: string[]) => args.length === 0 ? 'Finder' : '')
    const internals = service as unknown as {
      store: { getRendererSettings: () => Promise<typeof settings> }
      permissions: { authorizeAction: ReturnType<typeof vi.fn> }
      wechatReadiness: { checkReadiness: typeof checkReadiness }
      testConnection: ReturnType<typeof vi.fn>
      controller: { start: ReturnType<typeof vi.fn> }
      sender: { dependencies: { adapter: {
        dependencies: { runAppleScript: typeof runAppleScript }
        sendText: (input: { accountId: string; sessionId: string; conversationTitle: string; text: string }) => Promise<unknown>
      } } }
    }
    internals.permissions.authorizeAction = vi.fn(async () => { order.push('permission'); return undefined })
    internals.store.getRendererSettings = async () => { order.push('settings'); return settings }
    internals.wechatReadiness.checkReadiness = checkReadiness
    internals.testConnection = vi.fn(async () => { order.push('connection'); return { success: true } })
    internals.controller.start = vi.fn()
    internals.sender.dependencies.adapter.dependencies.runAppleScript = runAppleScript

    await expect(service.enable()).resolves.toMatchObject({ runtimeState: 'running' })
    expect(order).toEqual(['permission', 'settings', 'wechat-readiness', 'connection'])
    expect(internals.controller.start).toHaveBeenCalledOnce()
    expect(messagePushService.handleOmniMindSubscriberChanged).toHaveBeenCalledWith(true)

    await expect(internals.sender.dependencies.adapter.sendText({
      accountId: 'account-a', sessionId: 'alice', conversationTitle: 'Alice', text: 'reply'
    })).resolves.toMatchObject({ success: false, stage: 'automation', error: 'wechat_process_unavailable' })
    expect(checkReadiness).toHaveBeenCalledTimes(2)
    expect(checkReadiness).toHaveBeenNthCalledWith(1, { restoreFocus: true })
    expect(checkReadiness).toHaveBeenNthCalledWith(2)
    // 第二次复核失败后只恢复原前台应用，不会进入 SEND_SCRIPT。
    expect(runAppleScript.mock.calls).toHaveLength(2)
  })

  it('手动发送在 mutex authorize 内发现重名时，不进入 baseline 或 adapter', async () => {
    const service = await createAuthorizedService()
    const { chatService } = await import('../../electron/services/chatService')
    const getSessions = vi.mocked(chatService.getSessions)
    getSessions
      .mockResolvedValueOnce({ success: true, sessions: [{ username: 'target', displayName: 'Alice' }] } as never)
      .mockResolvedValueOnce({ success: true, sessions: [
        { username: 'target', displayName: ' Alice ' },
        { username: 'same-name-group', displayName: 'alice' }
      ] } as never)
    const captureBaseline = vi.fn(async () => undefined)
    const sendText = vi.fn(async () => ({ success: true, sentAt: 1 }))
    const internals = service as unknown as {
      sender: { dependencies: {
        adapter: { sendText: typeof sendText }
        verifier: { captureBaseline: typeof captureBaseline; verify: () => Promise<{ success: true }> }
      } }
    }
    internals.sender.dependencies.adapter = { sendText }
    internals.sender.dependencies.verifier = { captureBaseline, verify: async () => ({ success: true }) }

    await expect(service.sendManual({ sessionId: 'target', text: 'reply' })).resolves.toEqual({
      success: false,
      stage: 'authorization',
      error: 'target_ambiguous'
    })
    expect(getSessions).toHaveBeenCalledTimes(2)
    expect(captureBaseline).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })

  it('手动发送的空显示名也必须进入 mutex authorize 后 fail closed', async () => {
    const service = await createAuthorizedService()
    const { chatService } = await import('../../electron/services/chatService')
    vi.mocked(chatService.getSessions).mockResolvedValue({
      success: true,
      sessions: [{ username: 'target', displayName: '   ' }]
    } as never)
    const captureBaseline = vi.fn(async () => undefined)
    const sendText = vi.fn(async () => ({ success: true, sentAt: 1 }))
    const internals = service as unknown as {
      sender: { dependencies: {
        adapter: { sendText: typeof sendText }
        verifier: { captureBaseline: typeof captureBaseline; verify: () => Promise<{ success: true }> }
      } }
    }
    internals.sender.dependencies.adapter = { sendText }
    internals.sender.dependencies.verifier = { captureBaseline, verify: async () => ({ success: true }) }

    await expect(service.sendManual({ sessionId: 'target', text: 'reply' })).resolves.toEqual({
      success: false,
      stage: 'authorization',
      error: 'conversation_title_unavailable'
    })
    expect(captureBaseline).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })

  it.each([
    ['throws', () => Promise.reject(new Error('private DB failure'))],
    ['returns success false', () => Promise.resolve({ success: false })],
    ['omits sessions', () => Promise.resolve({ success: true })]
  ])('手动发送首次刷新会话 %s 时返回稳定失败且不进入 sender', async (_case, getSessionsResult) => {
    const service = await createAuthorizedService()
    const { chatService } = await import('../../electron/services/chatService')
    vi.mocked(chatService.getSessions).mockImplementation(getSessionsResult as never)
    const sendManual = vi.fn()
    const internals = service as unknown as { sender: { sendManual: typeof sendManual } }
    internals.sender.sendManual = sendManual

    await expect(service.sendManual({ sessionId: 'target', text: 'reply' })).resolves.toEqual({
      success: false,
      error: 'conversation_title_unavailable'
    })
    expect(sendManual).not.toHaveBeenCalled()
  })

  it.each([
    ['empty title', [{ username: 'target', displayName: '  ' }], 'conversation_title_unavailable'],
    ['missing target', [{ username: 'other', displayName: 'Alice' }], 'conversation_title_unavailable'],
    ['title changed', [{ username: 'target', displayName: 'Bob' }], 'target_ambiguous']
  ])('目标复核对 %s fail closed', async (_case, sessions, expectedError) => {
    const service = await createAuthorizedService()
    const { chatService } = await import('../../electron/services/chatService')
    vi.mocked(chatService.getSessions).mockResolvedValue({ success: true, sessions } as never)
    const internals = service as unknown as {
      authorizeUniqueConversationTarget: (sessionId: string, expectedTitle: string) => Promise<unknown>
    }

    await expect(internals.authorizeUniqueConversationTarget('target', 'Alice')).resolves.toEqual({ success: false, error: expectedError })
  })

  it('自动发送与 send_failed retry 都在 mutex 内重新校验显示名唯一性', async () => {
    const service = await createAuthorizedService()
    const { chatService } = await import('../../electron/services/chatService')
    const getSessions = vi.mocked(chatService.getSessions)
    const settings = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'all' as const, confirmedAt: 1 },
      autoSend: true, hasApiKey: true, batchWindowMs: 2000
    }
    let sessions = [
      { username: 'target', displayName: 'Alice' },
      { username: 'duplicate', displayName: ' alice ' }
    ]
    getSessions.mockImplementation(async () => ({ success: true, sessions } as never))
    const captureBaseline = vi.fn(async () => undefined)
    const sendText = vi.fn(async () => ({ success: true, sentAt: 1 }))
    const chat = vi.fn(async () => ({ kind: 'reply' as const, text: 'reply' }))
    const internals = service as unknown as {
      autoSend: boolean
      store: { getRendererSettings: () => Promise<typeof settings>; getApiKey: () => Promise<string> }
      python: { chat: typeof chat }
      sender: { dependencies: {
        adapter: { sendText: typeof sendText }
        verifier: { captureBaseline: typeof captureBaseline; verify: () => Promise<{ success: true; verifiedMessageKey: string }> }
      } }
      controller: { queue: {
        enqueue: (input: { accountId: string; sessionId: string; sessionName: string; messageKeys: string[]; text: string }) => { id: string }
        whenIdle: () => Promise<void>
        findTask: (taskId: string) => { status: string; reason?: string } | undefined
      } }
    }
    internals.autoSend = true
    internals.store.getRendererSettings = async () => settings
    internals.store.getApiKey = async () => 'api-key'
    internals.python.chat = chat
    internals.sender.dependencies.adapter = { sendText }
    internals.sender.dependencies.verifier = { captureBaseline, verify: async () => ({ success: true, verifiedMessageKey: 'verified' }) }

    const task = internals.controller.queue.enqueue({ accountId: 'account-a', sessionId: 'target', sessionName: 'Alice', messageKeys: ['m'], text: 'input' })
    await internals.controller.queue.whenIdle()
    expect(internals.controller.queue.findTask(task.id)).toMatchObject({ status: 'send_failed', reason: 'target_ambiguous' })
    expect(chat).toHaveBeenCalledWith(expect.not.objectContaining({ timeoutMs: expect.anything() }))
    expect(captureBaseline).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()

    sessions = [{ username: 'target', displayName: ' alice ' }]
    expect(service.retryTask(task.id)).toBe(true)
    await internals.controller.queue.whenIdle()
    expect(internals.controller.queue.findTask(task.id)).toMatchObject({ status: 'sent' })
    expect(captureBaseline).toHaveBeenCalledOnce()
    expect(sendText).toHaveBeenCalledOnce()
  })

  it('awaiting generated send 在 mutex 前检查通过但 mutex 内变为重名时仍停止', async () => {
    const service = await createAuthorizedService()
    const { chatService } = await import('../../electron/services/chatService')
    const getSessions = vi.mocked(chatService.getSessions)
    const settings = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'all' as const, confirmedAt: 1 },
      autoSend: false, hasApiKey: true, batchWindowMs: 2000
    }
    const captureBaseline = vi.fn(async () => undefined)
    const sendText = vi.fn(async () => ({ success: true, sentAt: 1 }))
    const internals = service as unknown as {
      autoSend: boolean
      store: { getRendererSettings: () => Promise<typeof settings>; getApiKey: () => Promise<string> }
      python: { chat: () => Promise<{ kind: 'reply'; text: string }> }
      sender: { dependencies: {
        adapter: { sendText: typeof sendText }
        verifier: { captureBaseline: typeof captureBaseline; verify: () => Promise<{ success: true }> }
      } }
      controller: { queue: {
        enqueue: (input: { accountId: string; sessionId: string; sessionName: string; messageKeys: string[]; text: string }) => { id: string }
        whenIdle: () => Promise<void>
      } }
    }
    internals.autoSend = false
    internals.store.getRendererSettings = async () => settings
    internals.store.getApiKey = async () => 'api-key'
    internals.python.chat = async () => ({ kind: 'reply', text: 'reply' })
    internals.sender.dependencies.adapter = { sendText }
    internals.sender.dependencies.verifier = { captureBaseline, verify: async () => ({ success: true }) }
    const task = internals.controller.queue.enqueue({ accountId: 'account-a', sessionId: 'target', sessionName: 'Alice', messageKeys: ['m'], text: 'input' })
    await internals.controller.queue.whenIdle()
    getSessions.mockResolvedValueOnce({ success: true, sessions: [
      { username: 'target', displayName: 'Alice' },
      { username: 'group', displayName: 'Alice' }
    ] } as never)

    await expect(service.sendGeneratedReply(task.id)).resolves.toEqual({
      success: false, stage: 'authorization', error: 'target_ambiguous'
    })
    expect(captureBaseline).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
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
      schemaVersion: 4,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected', conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: false,
      hasApiKey: true,
      batchWindowMs: 2000
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

  it('revalidates scope, permanent official exclusion, and decryptable credentials with typed failures', async () => {
    const service = await createAuthorizedService()
    let settings = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [] as Array<{ sessionId: string; displayName: string }> },
      autoSend: false, hasApiKey: true, batchWindowMs: 2000
    }
    const internals = service as unknown as {
      store: { getRendererSettings: () => Promise<typeof settings>; getApiKey: () => Promise<string | undefined> }
      authorizeGeneratedReply: (task: { accountId: string; sessionId: string; sessionName: string; sessionType: 'official'; messageKeys: string[]; text: string; id: string; status: 'awaiting_manual_send'; createdAt: number; updatedAt: number; replyText: string }) => Promise<unknown>
    }
    internals.store.getRendererSettings = async () => settings
    internals.store.getApiKey = async () => 'api-key'
    const task = { accountId: 'account-a', sessionId: 'official', sessionName: 'Official', sessionType: 'official' as const, messageKeys: ['m'], text: 'private', id: 'task', status: 'awaiting_manual_send' as const, createdAt: 1, updatedAt: 1, replyText: 'reply' }

    await expect(internals.authorizeGeneratedReply(task)).resolves.toEqual({ success: false, error: 'managed_scope_changed' })
    // 即使模拟升级前已进入范围的历史 official 任务，发送授权仍必须独立 fail closed。
    settings = { ...settings, managedScope: { mode: 'selected', conversations: [{ sessionId: 'official', displayName: 'Official' }] } }
    await expect(internals.authorizeGeneratedReply(task)).resolves.toEqual({ success: false, error: 'official_account_filtered' })
    const friendTask = { ...task, sessionId: 'friend', sessionName: 'Friend', sessionType: 'friend' as const }
    settings = { ...settings, managedScope: { mode: 'selected', conversations: [{ sessionId: 'friend', displayName: 'Friend' }] } }
    internals.store.getApiKey = async () => { throw new Error('decrypt failed') }
    await expect(internals.authorizeGeneratedReply(friendTask)).resolves.toEqual({ success: false, error: 'api_key_unavailable' })
  })

  it('rechecks the current account after the generated reply acquires the shared sender mutex', async () => {
    const service = await createAuthorizedService()
    let releaseBlocker!: () => void
    const blocker = new Promise<void>((resolve) => { releaseBlocker = resolve })
    const sentTexts: string[] = []
    const settings = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend: false,
      hasApiKey: true,
      batchWindowMs: 2000
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
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'all' as const, confirmedAt: 1 },
      autoSend: true,
      hasApiKey: true,
      batchWindowMs: 2000
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
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
      autoSend, hasApiKey: true, batchWindowMs: 2000
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
