import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SecureOmniMindSettingsStore } from '../../electron/omnimind/secure-settings-store'
import { buildOsascriptArguments, MacOsWeChatTextAdapter, WcdbOutboundVerifier } from '../../electron/omnimind/macos-wechat-text-adapter'

const createFileBackedSettingsStore = async (raw: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'omnimind-wechat-omnimind-settings-store-'))
  const target = join(directory, 'settings.json')
  await writeFile(target, raw, { encoding: 'utf8', mode: 0o600 })
  const writeAtomic = vi.fn(async (key: string, value: string) => {
    const destination = join(directory, `${key}.json`)
    const temporary = join(directory, `.${key}.tmp`)
    await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
  })
  const store = new SecureOmniMindSettingsStore({
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
    read: async (key) => {
      try { return await readFile(join(directory, `${key}.json`), 'utf8') } catch { return undefined }
    },
    writeAtomic
  })
  return { store, target, writeAtomic, dispose: () => rm(directory, { recursive: true, force: true }) }
}

describe('secure settings and macOS sender', () => {
  it('migrates nonempty v1 scope directly to selected v4 and fails closed for empty scope', async () => {
    const storage = new Map<string, string>([['settings', JSON.stringify({ pythonBaseUrl: 'http://localhost:8000', scope: [' Alice ', 'alice'], officialAccountPolicy: 'ignore' })]])
    const createStore = () => new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => storage.get(key), writeAtomic: async (key, value) => { storage.set(key, value) }, remove: async (key) => { storage.delete(key) }
    })
    await expect(createStore().getRendererSettings()).resolves.toMatchObject({
      schemaVersion: 4, managedScope: { mode: 'selected', conversations: [{ sessionId: 'Alice', displayName: '' }] }, autoSend: true
    })
    storage.set('settings', JSON.stringify({ pythonBaseUrl: 'http://localhost:8000', scope: [] }))
    await expect(createStore().getRendererSettings()).resolves.toMatchObject({
      managedScope: { mode: 'selected', conversations: [] }, migrationNotice: 'scope_confirmation_required'
    })
  })

  it('does not persist a half-migrated v1 bundle when legacy timing data is invalid', async () => {
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

  it('migrates the exact historical unversioned v1 file to v4 without losing its encrypted key', async () => {
    const encryptedApiKey = Buffer.from('v1-file-secret').toString('base64')
    const raw = JSON.stringify({
      pythonBaseUrl: 'http://localhost:8000',
      scope: ['gh_service', 'friend'],
      officialAccountPolicy: 'ignore',
      batchWindowMs: 2500,
      requestTimeoutMs: 30000,
      encryptedApiKey
    })
    const fixture = await createFileBackedSettingsStore(raw)
    try {
      await expect(fixture.store.getRendererSettings()).resolves.toMatchObject({
        schemaVersion: 4,
        pythonBaseUrl: 'http://localhost:8000/api/v1/open',
        managedScope: { mode: 'selected', conversations: [{ sessionId: 'friend', displayName: '' }] },
        autoSend: true,
        hasApiKey: true,
        batchWindowMs: 2500
      })
      await expect(fixture.store.getApiKey()).resolves.toBe('v1-file-secret')
      expect(fixture.writeAtomic).toHaveBeenCalledTimes(1)
      const persisted = JSON.parse(await readFile(fixture.target, 'utf8'))
      expect(persisted).toMatchObject({ schemaVersion: 4, encryptedApiKey })
      expect(persisted).not.toHaveProperty('requestTimeoutMs')
      expect(persisted).not.toHaveProperty('officialAccountPolicy')
      expect(persisted.managedScope.conversations).toEqual([{ sessionId: 'friend', displayName: '' }])
    } finally {
      await fixture.dispose()
    }
  })

  it('atomically migrates v3 to v4, drops only the old timeout and preserves every supported field', async () => {
    const encryptedApiKey = Buffer.from('v3-secret').toString('base64')
    const legacy = JSON.stringify({
      schemaVersion: 3,
      pythonBaseUrl: 'https://api.example.com/api/v1/open',
      managedScope: { mode: 'selected', conversations: [] },
      autoSend: false,
      batchWindowMs: 2500,
      requestTimeoutMs: 60_000,
      encryptedApiKey,
      migrationNotice: 'scope_confirmation_required'
    })
    const storage = new Map<string, string>([['settings', legacy]])
    const writeAtomic = vi.fn(async (key: string, value: string) => { storage.set(key, value) })
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => storage.get(key),
      writeAtomic
    })

    await expect(store.getRendererSettings()).resolves.toEqual({
      schemaVersion: 4,
      pythonBaseUrl: 'https://api.example.com/api/v1/open',
      managedScope: { mode: 'selected', conversations: [] },
      autoSend: false,
      hasApiKey: true,
      batchWindowMs: 2500,
      migrationNotice: 'scope_confirmation_required'
    })
    expect(writeAtomic).toHaveBeenCalledTimes(1)
    const persisted = JSON.parse(storage.get('settings') || '{}')
    expect(persisted).toEqual({
      schemaVersion: 4,
      pythonBaseUrl: 'https://api.example.com/api/v1/open',
      managedScope: { mode: 'selected', conversations: [] },
      autoSend: false,
      batchWindowMs: 2500,
      encryptedApiKey,
      migrationNotice: 'scope_confirmation_required'
    })
  })

  it('keeps the original v3 file untouched when the v3-to-v4 atomic write fails', async () => {
    const legacy = JSON.stringify({
      schemaVersion: 3,
      pythonBaseUrl: 'http://localhost:8000/api/v1/open',
      managedScope: { mode: 'selected', conversations: [{ sessionId: 'friend', displayName: 'Friend' }] },
      autoSend: true,
      batchWindowMs: 2000,
      requestTimeoutMs: 15_000
    })
    const storage = new Map<string, string>([['settings', legacy]])
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => storage.get(key),
      writeAtomic: vi.fn(async () => { throw new Error('disk_full') })
    })

    await expect(store.getRendererSettings()).rejects.toThrow('disk_full')
    expect(storage.get('settings')).toBe(legacy)
  })

  it.each([
    ['future schema', { schemaVersion: 999, pythonBaseUrl: 'http://localhost:8000', scope: ['friend'] }],
    ['unknown field', { pythonBaseUrl: 'http://localhost:8000', scope: ['friend'], futureCredential: 'must-not-drop' }],
    ['numeric encrypted key', { pythonBaseUrl: 'http://localhost:8000', scope: ['friend'], encryptedApiKey: 42 }],
    ['object encrypted key', { pythonBaseUrl: 'http://localhost:8000', scope: ['friend'], encryptedApiKey: { ciphertext: 'x' } }],
    ['invalid official policy', { pythonBaseUrl: 'http://localhost:8000', scope: ['friend'], officialAccountPolicy: 'include' }],
    ['array root', []],
    ['null root', null]
  ])('rejects invalid v1-shaped %s before any atomic write and preserves the source file', async (_case, payload) => {
    const raw = JSON.stringify(payload)
    const fixture = await createFileBackedSettingsStore(raw)
    try {
      await expect(fixture.store.getRendererSettings()).rejects.toThrow('settings_corrupt')
      expect(fixture.writeAtomic).not.toHaveBeenCalled()
      expect(await readFile(fixture.target, 'utf8')).toBe(raw)
    } finally {
      await fixture.dispose()
    }
  })

  it('replaces, keeps and explicitly clears the key in the atomic v4 bundle', async () => {
    const storage = new Map<string, string>()
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`encrypted:${value}`), decryptString: (value) => value.toString().replace('encrypted:', '') },
      read: async (key) => storage.get(key), writeAtomic: async (key, value) => { storage.set(key, value) }, remove: async (key) => { storage.delete(key) }
    })
    const input = { schemaVersion: 4 as const, pythonBaseUrl: 'https://api.example.com/api/v1/open', managedScope: { mode: 'all' as const, confirmedAt: 1 }, autoSend: false, batchWindowMs: 2000 }
    await store.save({ ...input, apiKeyDraft: 'secret' })
    await store.save(input)
    expect(await store.getApiKey()).toBe('secret')
    const beforeClear = JSON.parse(storage.get('settings') || '{}')
    await store.clearApiKey()
    expect(await store.getApiKey()).toBeUndefined()
    expect((await store.getRendererSettings()).hasApiKey).toBe(false)
    const afterClear = JSON.parse(storage.get('settings') || '{}')
    const { encryptedApiKey: _encryptedApiKey, ...preservedSettings } = beforeClear
    expect(afterClear).toEqual(preservedSettings)
  })

  it('atomically migrates v2 true/false policies to v4 and removes policy, timeout and stable official sessions', async () => {
    for (const ignoreOfficial of [true, false]) {
      const legacy = {
        schemaVersion: 2,
        pythonBaseUrl: 'https://api.example.com',
        managedScope: { mode: 'selected', conversations: [
          { sessionId: 'gh_service', displayName: '服务号' },
          { sessionId: 'friend', displayName: '客户' },
          { sessionId: 'legacy-unknown', displayName: '历史未知项' }
        ] },
        autoSend: false,
        ignoreOfficial,
        batchWindowMs: 2500,
        requestTimeoutMs: 30000,
        encryptedApiKey: Buffer.from('secret').toString('base64')
      }
      const storage = new Map<string, string>([['settings', JSON.stringify(legacy)]])
      const writeAtomic = vi.fn(async (key: string, value: string) => { storage.set(key, value) })
      const store = new SecureOmniMindSettingsStore({
        safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
        read: async (key) => storage.get(key),
        writeAtomic
      })

      await expect(store.getRendererSettings()).resolves.toMatchObject({
        schemaVersion: 4,
        pythonBaseUrl: 'https://api.example.com/api/v1/open',
        managedScope: { mode: 'selected', conversations: [
          { sessionId: 'friend', displayName: '客户' },
          { sessionId: 'legacy-unknown', displayName: '历史未知项' }
        ] },
        autoSend: false,
        hasApiKey: true,
        batchWindowMs: 2500
      })
      expect(writeAtomic).toHaveBeenCalledTimes(1)
      const migrated = JSON.parse(storage.get('settings') || '{}')
      expect(migrated.schemaVersion).toBe(4)
      expect(migrated).not.toHaveProperty('ignoreOfficial')
      expect(migrated).not.toHaveProperty('requestTimeoutMs')
      expect(migrated.encryptedApiKey).toBe(legacy.encryptedApiKey)
    }
  })

  it('does not expose a half-migrated v4 state when the atomic v2 write fails', async () => {
    const legacy = JSON.stringify({
      schemaVersion: 2,
      pythonBaseUrl: 'http://localhost:8000',
      managedScope: { mode: 'selected', conversations: [{ sessionId: 'friend', displayName: 'Friend' }] },
      autoSend: true,
      ignoreOfficial: false,
      batchWindowMs: 2000,
      requestTimeoutMs: 15000
    })
    const storage = new Map<string, string>([['settings', legacy]])
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => storage.get(key),
      writeAtomic: vi.fn(async () => { throw new Error('disk_full') })
    })

    await expect(store.getRendererSettings()).rejects.toThrow('disk_full')
    expect(storage.get('settings')).toBe(legacy)
  })

  it('reads a real v2 settings file and atomically replaces it with a complete v4 bundle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'omnimind-wechat-omnimind-v2-migration-'))
    const target = join(directory, 'settings.json')
    const legacy = {
      schemaVersion: 2,
      pythonBaseUrl: 'http://localhost:8000',
      managedScope: { mode: 'selected', conversations: [
        { sessionId: 'gh_service', displayName: '服务号' },
        { sessionId: 'friend', displayName: '客户' }
      ] },
      autoSend: false,
      ignoreOfficial: false,
      batchWindowMs: 2500,
      requestTimeoutMs: 30000,
      encryptedApiKey: Buffer.from('real-file-secret').toString('base64'),
      migrationNotice: 'scope_confirmation_required'
    }
    await writeFile(target, JSON.stringify(legacy), { encoding: 'utf8', mode: 0o600 })
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => {
        try { return await readFile(join(directory, `${key}.json`), 'utf8') } catch { return undefined }
      },
      // 与主进程生产适配器保持同一业务边界：完整临时文件落盘后才 rename 替换目标，
      // 因此断言读取到 v4 也同时证明迁移不是只修改内存中的 mock Map。
      writeAtomic: async (key, value) => {
        await mkdir(directory, { recursive: true })
        const destination = join(directory, `${key}.json`)
        const temporary = join(directory, `.${key}.tmp`)
        await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, destination)
      }
    })

    try {
      await expect(store.getRendererSettings()).resolves.toMatchObject({
        schemaVersion: 4,
        managedScope: { mode: 'selected', conversations: [{ sessionId: 'friend', displayName: '客户' }] },
        autoSend: false,
        hasApiKey: true,
        migrationNotice: 'scope_confirmation_required'
      })
      await expect(store.getApiKey()).resolves.toBe('real-file-secret')
      const persisted = JSON.parse(await readFile(target, 'utf8'))
      expect(persisted).toMatchObject({ schemaVersion: 4, encryptedApiKey: legacy.encryptedApiKey, migrationNotice: 'scope_confirmation_required' })
      expect(persisted).not.toHaveProperty('ignoreOfficial')
      expect(persisted).not.toHaveProperty('requestTimeoutMs')
      expect(persisted.managedScope.conversations).toEqual([{ sessionId: 'friend', displayName: '客户' }])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps the dedicated key-clear command available for a migrated empty scope', async () => {
    const storage = new Map<string, string>([
      ['settings', JSON.stringify({ pythonBaseUrl: 'http://localhost:8000', scope: [], batchWindowMs: 2000, requestTimeoutMs: 15000 })],
      ['api-key', Buffer.from('legacy-secret').toString('base64')]
    ])
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      read: async (key) => storage.get(key), writeAtomic: async (key, value) => { storage.set(key, value) }, remove: async (key) => { storage.delete(key) }
    })
    await expect(store.clearApiKey()).resolves.toBeUndefined()
    expect(await store.getRendererSettings()).toMatchObject({
      pythonBaseUrl: 'http://localhost:8000/api/v1/open',
      managedScope: { mode: 'selected', conversations: [] },
      autoSend: true,
      batchWindowMs: 2000,
      migrationNotice: 'scope_confirmation_required',
      hasApiKey: false
    })
    expect(JSON.parse(storage.get('settings') || '{}')).not.toHaveProperty('encryptedApiKey')
    expect(storage.has('api-key')).toBe(false)
  })
  it('fails closed when safe storage encryption is unavailable', async () => {
    const storage = new Map<string, string>()
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' },
      read: async (key) => storage.get(key),
      writeAtomic: async (key, value) => { storage.set(key, value) }
    })
    await expect(store.save({ schemaVersion: 4, pythonBaseUrl: 'http://127.0.0.1:8000', managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, apiKeyDraft: 'secret', batchWindowMs: 2000 })).rejects.toThrow('secure_storage_unavailable')
    expect([...storage.values()].join('')).not.toContain('secret')
  })

  it('renderer settings expose only hasApiKey', async () => {
    const storage = new Map<string, string>()
    const store = new SecureOmniMindSettingsStore({
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`encrypted:${value}`), decryptString: (value) => value.toString().replace('encrypted:', '') },
      read: async (key) => storage.get(key),
      writeAtomic: async (key, value) => { storage.set(key, value) }
    })
    await store.save({ schemaVersion: 4, pythonBaseUrl: 'http://127.0.0.1:8000', managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, apiKeyDraft: 'secret', batchWindowMs: 2000 })
    expect(await store.getRendererSettings()).toEqual({ schemaVersion: 4, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, hasApiKey: true, batchWindowMs: 2000 })
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
    await store.save({ schemaVersion: 4, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, apiKeyDraft: 'secret', batchWindowMs: 2000 })
    expect(writeAtomic).toHaveBeenCalledTimes(1)
    expect(storage.get('settings')).not.toContain('secret')
    storage.set('settings', '{broken')
    await expect(store.getRendererSettings()).rejects.toThrow('settings_corrupt')
    storage.set('settings', JSON.stringify({
      schemaVersion: 4,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected', conversations: [{ sessionId: 's', displayName: 'S' }] },
      autoSend: true,
      batchWindowMs: 2000,
      uncontractedModel: 'fake-model'
    }))
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
