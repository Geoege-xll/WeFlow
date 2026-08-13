import { describe, expect, it, vi } from 'vitest'
import { SecureOmniMindSettingsStore } from '../../electron/omnimind/secure-settings-store'
import { buildOsascriptArguments, MacOsWeChatTextAdapter, WcdbOutboundVerifier } from '../../electron/omnimind/macos-wechat-text-adapter'

describe('secure settings and macOS sender', () => {
  it('migrates nonempty v1 scope to selected v2 and fails closed for empty scope', async () => {
    const storage = new Map<string, string>([['settings', JSON.stringify({ pythonBaseUrl: 'http://localhost:8000', scope: [' Alice ', 'alice'], officialAccountPolicy: 'ignore' })]])
    const createStore = () => new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => storage.get(key), writeAtomic: async (key, value) => { storage.set(key, value) }
    })
    await expect(createStore().getRendererSettings()).resolves.toMatchObject({
      schemaVersion: 2, managedScope: { mode: 'selected', conversations: [{ sessionId: 'Alice', displayName: '' }] }, autoSend: true, ignoreOfficial: true
    })
    storage.set('settings', JSON.stringify({ pythonBaseUrl: 'http://localhost:8000', scope: [] }))
    await expect(createStore().getRendererSettings()).resolves.toMatchObject({
      managedScope: { mode: 'selected', conversations: [] }, migrationNotice: 'scope_confirmation_required'
    })
  })

  it('does not persist a half-migrated v2 bundle when legacy timing data is invalid', async () => {
    const legacy = JSON.stringify({
      pythonBaseUrl: 'http://localhost:8000',
      scope: ['alice'],
      officialAccountPolicy: 'ignore',
      batchWindowMs: 'not-a-number',
      requestTimeoutMs: 15000
    })
    const storage = new Map<string, string>([['settings', legacy]])
    const writeAtomic = vi.fn(async (key: string, value: string) => { storage.set(key, value) })
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => storage.get(key),
      writeAtomic
    })

    await expect(store.getRendererSettings()).rejects.toThrow('settings_corrupt')
    expect(writeAtomic).not.toHaveBeenCalled()
    expect(storage.get('settings')).toBe(legacy)
  })

  it('replaces, keeps and explicitly clears the key in the atomic v2 bundle', async () => {
    const storage = new Map<string, string>()
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`encrypted:${value}`), decryptString: (value) => value.toString().replace('encrypted:', '') },
      read: async (key) => storage.get(key), writeAtomic: async (key, value) => { storage.set(key, value) }
    })
    const input = { schemaVersion: 2 as const, pythonBaseUrl: 'https://api.example.com/api/v1/open', managedScope: { mode: 'all' as const, confirmedAt: 1 }, autoSend: false, ignoreOfficial: false, batchWindowMs: 2000, requestTimeoutMs: 15000 }
    await store.save({ ...input, apiKeyDraft: 'secret' })
    await store.save(input)
    expect(await store.getApiKey()).toBe('secret')
    await store.save({ ...input, clearApiKey: true })
    expect(await store.getApiKey()).toBeUndefined()
    expect((await store.getRendererSettings()).hasApiKey).toBe(false)
  })
  it('fails closed when safe storage encryption is unavailable', async () => {
    const storage = new Map<string, string>()
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' },
      read: async (key) => storage.get(key),
      writeAtomic: async (key, value) => { storage.set(key, value) }
    })
    await expect(store.save({ schemaVersion: 2, pythonBaseUrl: 'http://127.0.0.1:8000', managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, ignoreOfficial: true, apiKeyDraft: 'secret', batchWindowMs: 2000, requestTimeoutMs: 15000 })).rejects.toThrow('secure_storage_unavailable')
    expect([...storage.values()].join('')).not.toContain('secret')
  })

  it('renderer settings expose only hasApiKey', async () => {
    const storage = new Map<string, string>()
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`encrypted:${value}`), decryptString: (value) => value.toString().replace('encrypted:', '') },
      read: async (key) => storage.get(key),
      writeAtomic: async (key, value) => { storage.set(key, value) }
    })
    await store.save({ schemaVersion: 2, pythonBaseUrl: 'http://127.0.0.1:8000', managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, ignoreOfficial: true, apiKeyDraft: 'secret', batchWindowMs: 2000, requestTimeoutMs: 15000 })
    expect(await store.getRendererSettings()).toEqual({ schemaVersion: 2, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, ignoreOfficial: true, hasApiKey: true, batchWindowMs: 2000, requestTimeoutMs: 15000 })
    expect(JSON.stringify(await store.getRendererSettings())).not.toContain('secret')
    expect(await store.getApiKey()).toBe('secret')
  })

  it('encrypts before one atomic bundle write and exposes corrupt settings', async () => {
    const storage = new Map<string, string>()
    const writeAtomic = vi.fn(async (key: string, value: string) => { storage.set(key, value) })
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`encrypted:${value}`), decryptString: (value) => value.toString().replace('encrypted:', '') },
      read: async (key) => storage.get(key), writeAtomic
    })
    await store.save({ schemaVersion: 2, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, ignoreOfficial: true, apiKeyDraft: 'secret', batchWindowMs: 2000, requestTimeoutMs: 15000 })
    expect(writeAtomic).toHaveBeenCalledTimes(1)
    expect(storage.get('settings')).not.toContain('secret')
    storage.set('settings', '{broken')
    await expect(store.getRendererSettings()).rejects.toThrow('settings_corrupt')
  })

  it('macOS adapter fails closed off darwin and restores clipboard after injection failure', async () => {
    const clipboard = { readText: vi.fn(() => 'before'), writeText: vi.fn() }
    const unsupported = new MacOsWeChatTextAdapter({ platform: 'win32', clipboard, runAppleScript: vi.fn() })
    expect(await unsupported.sendText({ accountId: 'a', sessionId: 's', text: 'secret text' })).toEqual({ success: false, error: 'unsupported_platform' })

    const runAppleScript = vi.fn(async (_script: string, args: string[]) => { if (args.length === 0) return 'Finder'; throw new Error('ambiguous') })
    const adapter = new MacOsWeChatTextAdapter({ platform: 'darwin', clipboard, runAppleScript })
    expect((await adapter.sendText({ accountId: 'a', sessionId: 's', conversationTitle: 'Alice', text: 'secret text' })).success).toBe(false)
    expect(clipboard.writeText).toHaveBeenLastCalledWith('before')
  })

  it('places the osascript option terminator before every untrusted argv value', () => {
    const values = ['-e', '-l', `quote'\"`, 'line one\nline two', '你好']
    expect(buildOsascriptArguments('on run argv\nreturn argv\nend run', values)).toEqual([
      '-e', 'on run argv\nreturn argv\nend run', '--', ...values
    ])
  })

  it('requires a post-send row newer than the pre-send outbound watermark', async () => {
    const getMessages = vi.fn()
      .mockResolvedValueOnce({ success: true, messages: [
        { messageKey: 'old', localId: 10, isSend: 1, createTime: 100, parsedContent: 'hello' }
      ] })
      .mockResolvedValueOnce({ success: true, messages: [
        { messageKey: 'old', localId: 10, isSend: 1, createTime: 100, parsedContent: 'hello' }
      ] })
      .mockResolvedValueOnce({ success: true, messages: [
        { messageKey: 'old', localId: 10, isSend: 1, createTime: 100, parsedContent: 'hello' },
        { messageKey: 'new', localId: 11, isSend: 1, createTime: 100, parsedContent: 'hello' }
      ] })
    let now = 100_900
    const verifier = new WcdbOutboundVerifier({ getMessages }, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
      verificationDeadlineMs: 500,
      pollIntervalMs: 100
    })
    const watermark = await verifier.captureBaseline({ accountId: 'a', sessionId: 's' })
    expect(getMessages).toHaveBeenNthCalledWith(1, 's', 0, 50, 0, expect.any(Number), false)
    expect(await verifier.verify({ accountId: 'a', sessionId: 's', text: 'hello', sentAt: 100_900, watermark })).toEqual({ success: true, verifiedMessageKey: 'new' })
  })

  it('captures the latest outbound watermark when the newest session row is inbound', async () => {
    const descendingRows = [
      { messageKey: 'latest-inbound', localId: 11, isSend: 0, createTime: 101, parsedContent: 'customer' },
      { messageKey: 'latest-outbound', localId: 10, isSend: 1, createTime: 100, parsedContent: 'old reply' }
    ]
    const getMessages = vi.fn(async (_sessionId: string, offset: number, limit: number) => ({
      success: true,
      messages: descendingRows.slice(offset, offset + limit)
    }))
    const verifier = new WcdbOutboundVerifier({ getMessages })

    await expect(verifier.captureBaseline({ accountId: 'a', sessionId: 's' })).resolves.toEqual({
      keys: ['latest-outbound'], createTime: 101, localId: 11
    })
  })

  it('paginates past more than fifty inbound rows to find the latest outbound watermark', async () => {
    const rows = [
      ...Array.from({ length: 57 }, (_, index) => ({ messageKey: `in-${index}`, localId: 100 - index, isSend: 0, createTime: 200 - index, parsedContent: 'inbound' })),
      { messageKey: 'outbound', localId: 40, isSend: 1, createTime: 140, parsedContent: 'old reply' }
    ]
    const getMessages = vi.fn(async (_sessionId: string, offset: number, limit: number) => ({
      success: true,
      messages: rows.slice(offset, offset + limit),
      hasMore: offset + limit < rows.length
    }))

    await expect(new WcdbOutboundVerifier({ getMessages }).captureBaseline({ accountId: 'a', sessionId: 's' })).resolves.toEqual({
      keys: ['outbound'], createTime: 200, localId: 100
    })
    expect(getMessages).toHaveBeenCalledTimes(2)
  })

  it('fails closed when baseline pagination cannot be completed', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ messageKey: `in-${index}`, localId: 100 - index, isSend: 0, createTime: 200 - index }))
    const getMessages = vi.fn()
      .mockResolvedValueOnce({ success: true, messages: firstPage, hasMore: true })
      .mockResolvedValueOnce({ success: false })

    await expect(new WcdbOutboundVerifier({ getMessages }).captureBaseline({ accountId: 'a', sessionId: 's' })).rejects.toThrow('verification_baseline_failed')
  })

  it('uses the latest overall row as the empty-outbound baseline', async () => {
    const getMessages = vi.fn(async () => ({ success: true, messages: [
      { messageKey: 'latest-inbound', localId: 9, isSend: 0, createTime: 100, parsedContent: 'hello' }
    ], hasMore: false }))

    await expect(new WcdbOutboundVerifier({ getMessages }).captureBaseline({ accountId: 'a', sessionId: 's' })).resolves.toEqual({
      keys: [], createTime: 100, localId: 9
    })
  })

  it('paginates verification when more than fifty inbound rows arrive after the send', async () => {
    const inbound = Array.from({ length: 50 }, (_, index) => ({
      messageKey: `in-${index}`,
      localId: 200 - index,
      isSend: 0,
      createTime: 105,
      parsedContent: 'customer burst'
    }))
    const getMessages = vi.fn()
      .mockResolvedValueOnce({ success: true, messages: inbound, hasMore: true })
      .mockResolvedValueOnce({ success: true, messages: [
        { messageKey: 'new-outbound', localId: 101, isSend: 1, createTime: 104, parsedContent: 'hello' }
      ], hasMore: false })
    const verifier = new WcdbOutboundVerifier({ getMessages })

    await expect(verifier.verify({
      accountId: 'a', sessionId: 's', text: 'hello', sentAt: 104_000,
      watermark: { keys: ['old-outbound'], createTime: 100, localId: 10 }
    })).resolves.toEqual({ success: true, verifiedMessageKey: 'new-outbound' })
    expect(getMessages).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a later verification page cannot be read', async () => {
    const page = Array.from({ length: 50 }, (_, index) => ({ messageKey: `in-${index}`, localId: 200 - index, isSend: 0, createTime: 105 }))
    const getMessages = vi.fn().mockResolvedValueOnce({ success: true, messages: page, hasMore: true }).mockResolvedValueOnce({ success: false })
    await expect(new WcdbOutboundVerifier({ getMessages }).verify({ accountId: 'a', sessionId: 's', text: 'hello', sentAt: 104_000, watermark: { keys: [], createTime: 100, localId: 1 } })).resolves.toEqual({ success: false, error: 'verification_read_failed' })
  })

  it('stops verification pagination after a first-page match', async () => {
    const getMessages = vi.fn(async () => ({ success: true, messages: [{ messageKey: 'new', localId: 2, isSend: 1, createTime: 104, parsedContent: 'hello' }], hasMore: true }))
    await expect(new WcdbOutboundVerifier({ getMessages }).verify({ accountId: 'a', sessionId: 's', text: 'hello', sentAt: 104_000, watermark: { keys: [], createTime: 100, localId: 1 } })).resolves.toEqual({ success: true, verifiedMessageKey: 'new' })
    expect(getMessages).toHaveBeenCalledTimes(1)
  })
})
