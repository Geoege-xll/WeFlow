import { normalizeOmniMindBaseUrl, parseOmniMindTimings, type ManagedScope, type OmniMindSettings, type OmniMindSettingsInput } from '../../shared/omnimind/contracts'

interface SafeStoragePort {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface StoreDependencies {
  safeStorage: SafeStoragePort
  read: (key: string) => Promise<string | undefined>
  writeAtomic: (key: string, value: string) => Promise<void>
}

const SETTINGS_KEY = 'settings'
const LEGACY_API_KEY = 'api-key'
const DEFAULT_SCOPE: ManagedScope = { mode: 'selected', conversations: [] }

interface StoredBundleV2 {
  schemaVersion: 2
  pythonBaseUrl: string
  managedScope: ManagedScope
  autoSend: boolean
  ignoreOfficial: boolean
  batchWindowMs: number
  requestTimeoutMs: number
  encryptedApiKey?: string
  migrationNotice?: 'scope_confirmation_required'
}

const defaults = (): StoredBundleV2 => ({
  schemaVersion: 2,
  pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
  managedScope: DEFAULT_SCOPE,
  autoSend: true,
  ignoreOfficial: true,
  batchWindowMs: 2000,
  requestTimeoutMs: 15000,
  migrationNotice: 'scope_confirmation_required'
})

export class SecureOmniMindSettingsStore {
  constructor(private readonly dependencies: StoreDependencies) {}

  async save(input: OmniMindSettingsInput): Promise<void> {
    const current = await this.readBundle()
    let encryptedApiKey = current.encryptedApiKey
    if (!encryptedApiKey && current.fromLegacy) encryptedApiKey = await this.dependencies.read(LEGACY_API_KEY)
    if (input.apiKeyDraft !== undefined) {
      if (!this.dependencies.safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable')
      try { encryptedApiKey = this.dependencies.safeStorage.encryptString(input.apiKeyDraft).toString('base64') } catch { throw new Error('secure_storage_encrypt_failed') }
    }
    if (input.clearApiKey) encryptedApiKey = undefined
    const bundle: StoredBundleV2 = {
      schemaVersion: 2,
      pythonBaseUrl: normalizeOmniMindBaseUrl(input.pythonBaseUrl),
      managedScope: input.managedScope,
      autoSend: input.autoSend,
      ignoreOfficial: input.ignoreOfficial,
      batchWindowMs: input.batchWindowMs,
      requestTimeoutMs: input.requestTimeoutMs,
      ...(encryptedApiKey ? { encryptedApiKey } : {})
    }
    await this.dependencies.writeAtomic(SETTINGS_KEY, JSON.stringify(bundle))
  }

  async getRendererSettings(): Promise<OmniMindSettings> {
    const { encryptedApiKey, fromLegacy, ...settings } = await this.readBundle()
    const legacyEncrypted = fromLegacy && !encryptedApiKey ? await this.dependencies.read(LEGACY_API_KEY) : undefined
    return { ...settings, hasApiKey: Boolean(encryptedApiKey || legacyEncrypted) }
  }

  async getApiKey(): Promise<string | undefined> {
    const bundle = await this.readBundle()
    const encrypted = bundle.encryptedApiKey || (bundle.fromLegacy ? await this.dependencies.read(LEGACY_API_KEY) : undefined)
    if (!encrypted) return undefined
    if (!this.dependencies.safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable')
    try { return this.dependencies.safeStorage.decryptString(Buffer.from(encrypted, 'base64')) } catch { throw new Error('secure_storage_decrypt_failed') }
  }

  private async readBundle(): Promise<StoredBundleV2 & { fromLegacy?: boolean }> {
    const raw = await this.dependencies.read(SETTINGS_KEY)
    if (!raw) return { ...defaults(), fromLegacy: true }
    let value: Record<string, unknown>
    try { value = JSON.parse(raw) as Record<string, unknown> } catch { throw new Error('settings_corrupt') }
    if (value.schemaVersion === 2) return this.parseV2(value)
    return this.migrateV1(value)
  }

  private parseV2(value: Record<string, unknown>): StoredBundleV2 {
    const scope = value.managedScope as ManagedScope
    const selectedValid = scope?.mode === 'selected' && Array.isArray(scope.conversations) && scope.conversations.every((item) => item && typeof item.sessionId === 'string' && typeof item.displayName === 'string')
    const allValid = scope?.mode === 'all' && typeof scope.confirmedAt === 'number' && Number.isFinite(scope.confirmedAt) && scope.confirmedAt > 0
    if (typeof value.pythonBaseUrl !== 'string' || (!selectedValid && !allValid) || typeof value.autoSend !== 'boolean' || typeof value.ignoreOfficial !== 'boolean') throw new Error('settings_corrupt')
    if (!Number.isInteger(value.batchWindowMs) || Number(value.batchWindowMs) < 500 || Number(value.batchWindowMs) > 10000) throw new Error('settings_corrupt')
    if (!Number.isInteger(value.requestTimeoutMs) || Number(value.requestTimeoutMs) < 1000 || Number(value.requestTimeoutMs) > 120000) throw new Error('settings_corrupt')
    return {
      schemaVersion: 2, pythonBaseUrl: normalizeOmniMindBaseUrl(value.pythonBaseUrl), managedScope: scope,
      autoSend: value.autoSend, ignoreOfficial: value.ignoreOfficial,
      batchWindowMs: Number(value.batchWindowMs), requestTimeoutMs: Number(value.requestTimeoutMs),
      ...(typeof value.encryptedApiKey === 'string' ? { encryptedApiKey: value.encryptedApiKey } : {}),
      ...(value.migrationNotice === 'scope_confirmation_required' ? { migrationNotice: value.migrationNotice } : {})
    }
  }

  private async migrateV1(value: Record<string, unknown>): Promise<StoredBundleV2 & { fromLegacy: true }> {
    if (typeof value.pythonBaseUrl !== 'string' || !Array.isArray(value.scope) || value.scope.some((item) => typeof item !== 'string')) throw new Error('settings_corrupt')
    let timings: ReturnType<typeof parseOmniMindTimings>
    try { timings = parseOmniMindTimings(value.batchWindowMs, value.requestTimeoutMs) } catch { throw new Error('settings_corrupt') }
    const conversations: Array<{ sessionId: string; displayName: string }> = []
    const seen = new Set<string>()
    for (const rawId of value.scope as string[]) {
      const sessionId = rawId.trim()
      const identity = sessionId.toLocaleLowerCase()
      if (!sessionId || seen.has(identity)) continue
      seen.add(identity)
      conversations.push({ sessionId, displayName: '' })
    }
    const legacyEncrypted = typeof value.encryptedApiKey === 'string' ? value.encryptedApiKey : await this.dependencies.read(LEGACY_API_KEY)
    const migrated: StoredBundleV2 & { fromLegacy: true } = {
      schemaVersion: 2,
      pythonBaseUrl: normalizeOmniMindBaseUrl(value.pythonBaseUrl),
      managedScope: { mode: 'selected', conversations },
      autoSend: true,
      ignoreOfficial: true,
      ...timings,
      ...(legacyEncrypted ? { encryptedApiKey: legacyEncrypted } : {}),
      ...(conversations.length === 0 ? { migrationNotice: 'scope_confirmation_required' as const } : {}),
      fromLegacy: true
    }
    const { fromLegacy: _ignored, ...persisted } = migrated
    await this.dependencies.writeAtomic(SETTINGS_KEY, JSON.stringify(persisted))
    return migrated
  }
}
