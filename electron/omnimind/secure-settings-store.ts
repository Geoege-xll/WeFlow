import type { ManagedScope, OmniMindSettings, OmniMindSettingsInput } from '../../shared/omnimind/contracts'
import {
  OMNIMIND_SETTINGS_DEFAULTS,
  normalizeOmniMindBaseUrl,
  parseLegacyOmniMindPersistedSettingsV2,
  parseLegacyOmniMindPersistedSettingsV3,
  parseOmniMindTimings,
  parsePersistedOmniMindSettings,
  parseSettingsPayload
} from '../../shared/omnimind/settings-domain'
import { classifyOmniMindConversation } from '../../shared/omnimind/conversation-domain'

interface SafeStoragePort {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface StoreDependencies {
  safeStorage: SafeStoragePort
  read: (key: string) => Promise<string | undefined>
  writeAtomic: (key: string, value: string) => Promise<void>
  remove?: (key: string) => Promise<void>
}

const SETTINGS_KEY = 'settings'
const LEGACY_API_KEY = 'api-key'
interface StoredBundleV4 {
  schemaVersion: 4
  pythonBaseUrl: string
  managedScope: ManagedScope
  autoSend: boolean
  batchWindowMs: number
  encryptedApiKey?: string
  migrationNotice?: 'scope_confirmation_required'
}

const defaults = (): StoredBundleV4 => ({
  schemaVersion: 4,
  pythonBaseUrl: OMNIMIND_SETTINGS_DEFAULTS.pythonBaseUrl,
  // 默认范围保持 fail closed；不能直接复用冻结数组，否则后续代码可能误把共享默认值当可变草稿。
  managedScope: { mode: 'selected', conversations: [] },
  autoSend: OMNIMIND_SETTINGS_DEFAULTS.autoSend,
  batchWindowMs: OMNIMIND_SETTINGS_DEFAULTS.batchWindowMs,
  migrationNotice: 'scope_confirmation_required'
})

export class SecureOmniMindSettingsStore {
  constructor(private readonly dependencies: StoreDependencies) {}

  async save(input: OmniMindSettingsInput): Promise<void> {
    // 即使调用者来自受信主进程，也必须复用 IPC 的完整领域解析，避免测试或未来内部调用
    // 绕过范围、官方账号策略与时序边界，写入 renderer 无法正确解释的半有效设置。
    const validated = parseSettingsPayload(input)
    const current = await this.readBundle()
    let encryptedApiKey = current.encryptedApiKey
    if (!encryptedApiKey && current.fromLegacy) encryptedApiKey = await this.dependencies.read(LEGACY_API_KEY)
    if (validated.apiKeyDraft !== undefined) {
      if (!this.dependencies.safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable')
      try { encryptedApiKey = this.dependencies.safeStorage.encryptString(validated.apiKeyDraft).toString('base64') } catch { throw new Error('secure_storage_encrypt_failed') }
    }
    const bundle: StoredBundleV4 = {
      schemaVersion: 4,
      pythonBaseUrl: validated.pythonBaseUrl,
      managedScope: validated.managedScope,
      autoSend: validated.autoSend,
      batchWindowMs: validated.batchWindowMs,
      ...(encryptedApiKey ? { encryptedApiKey } : {}),
      ...(validated.managedScope.mode === 'selected' && validated.managedScope.conversations.length === 0
        ? { migrationNotice: 'scope_confirmation_required' as const }
        : {})
    }
    await this.dependencies.writeAtomic(SETTINGS_KEY, JSON.stringify(bundle))
  }

  /**
   * 清除凭据是独立安全命令：它不重新解释 renderer 传入的设置，也不会借普通 save 修改范围、
   * 时序或策略。先通过受信存储解析当前 bundle，再只剥离密文并保留迁移提示等其余字段。
   */
  async clearApiKey(): Promise<void> {
    const { encryptedApiKey: _encryptedApiKey, fromLegacy: _fromLegacy, ...current } = await this.readBundle()
    await this.dependencies.writeAtomic(SETTINGS_KEY, JSON.stringify(current))
    // V4 bundle 已先变为不引用凭据的原子状态；随后清理旧版独立密文文件，避免逻辑清除后仍残留历史密文。
    await this.dependencies.remove?.(LEGACY_API_KEY)
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

  private async readBundle(): Promise<StoredBundleV4 & { fromLegacy?: boolean }> {
    const raw = await this.dependencies.read(SETTINGS_KEY)
    if (!raw) return { ...defaults(), fromLegacy: true }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error('settings_corrupt') }
    // JSON 根必须是普通对象。数组、null 等值如果直接读取 schemaVersion 会抛出非领域错误，
    // 更不能被当作“未带版本号的 v1”继续迁移。
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) throw new Error('settings_corrupt')
    const value = parsed as Record<string, unknown>
    if (value.schemaVersion === 4) return this.parseV4(value)
    if (value.schemaVersion === 3) return this.migrateV3(value)
    if (value.schemaVersion === 2) return this.migrateV2(value)
    // 仓库历史中的 v1 是“无 schemaVersion + scope 字段”的未版本化结构；任何显式未知版本
    // 都可能属于未来客户端。禁止把它降级套入旧迁移器后覆盖成 v4。
    if (value.schemaVersion !== undefined) throw new Error('settings_corrupt')
    return this.migrateV1(value)
  }

  private parseV4(value: Record<string, unknown>): StoredBundleV4 {
    const allowedKeys = new Set(['schemaVersion', 'pythonBaseUrl', 'managedScope', 'autoSend', 'batchWindowMs', 'encryptedApiKey', 'migrationNotice'])
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('settings_corrupt')
    if (value.encryptedApiKey !== undefined && typeof value.encryptedApiKey !== 'string') throw new Error('settings_corrupt')
    if (value.migrationNotice !== undefined && value.migrationNotice !== 'scope_confirmation_required') throw new Error('settings_corrupt')
    try {
      const core = parsePersistedOmniMindSettings({
        schemaVersion: value.schemaVersion,
        pythonBaseUrl: value.pythonBaseUrl,
        managedScope: value.managedScope,
        autoSend: value.autoSend,
        batchWindowMs: value.batchWindowMs
      }, { allowEmptySelected: value.migrationNotice === 'scope_confirmation_required' })
      return {
        ...core,
        ...(typeof value.encryptedApiKey === 'string' ? { encryptedApiKey: value.encryptedApiKey } : {}),
        ...(value.migrationNotice === 'scope_confirmation_required' ? { migrationNotice: value.migrationNotice } : {})
      }
    } catch { throw new Error('settings_corrupt') }
  }

  /**
   * v3 -> v4 只做一次原子投影：严格验证旧 requestTimeoutMs 后丢弃，
   * 其余连接、密文、范围、策略、聚合窗口和迁移提示全部无损保留。
   * writeAtomic 失败时直接向上抛出，调用方不会观察到内存中的半迁移状态。
   */
  private async migrateV3(value: Record<string, unknown>): Promise<StoredBundleV4> {
    const allowedKeys = new Set(['schemaVersion', 'pythonBaseUrl', 'managedScope', 'autoSend', 'batchWindowMs', 'requestTimeoutMs', 'encryptedApiKey', 'migrationNotice'])
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('settings_corrupt')
    if (value.encryptedApiKey !== undefined && typeof value.encryptedApiKey !== 'string') throw new Error('settings_corrupt')
    if (value.migrationNotice !== undefined && value.migrationNotice !== 'scope_confirmation_required') throw new Error('settings_corrupt')
    let legacy: ReturnType<typeof parseLegacyOmniMindPersistedSettingsV3>
    try {
      legacy = parseLegacyOmniMindPersistedSettingsV3({
        schemaVersion: value.schemaVersion,
        pythonBaseUrl: value.pythonBaseUrl,
        managedScope: value.managedScope,
        autoSend: value.autoSend,
        batchWindowMs: value.batchWindowMs,
        requestTimeoutMs: value.requestTimeoutMs
      }, { allowEmptySelected: value.migrationNotice === 'scope_confirmation_required' })
    } catch { throw new Error('settings_corrupt') }
    const migrated: StoredBundleV4 = {
      schemaVersion: 4,
      pythonBaseUrl: legacy.pythonBaseUrl,
      managedScope: legacy.managedScope,
      autoSend: legacy.autoSend,
      batchWindowMs: legacy.batchWindowMs,
      ...(typeof value.encryptedApiKey === 'string' ? { encryptedApiKey: value.encryptedApiKey } : {}),
      ...(value.migrationNotice === 'scope_confirmation_required' ? { migrationNotice: value.migrationNotice } : {})
    }
    await this.dependencies.writeAtomic(SETTINGS_KEY, JSON.stringify(migrated))
    return migrated
  }

  /**
   * v2 的 ignoreOfficial 无论 true/false 都只代表已经废止的可配置策略，绝不投影进 v4。
   * 迁移先严格验证全部旧字段，再过滤稳定 ID 可识别的官方账号，最后一次原子写回；
   * writeAtomic 失败时 Promise 直接失败，调用者不会观察到内存中的半迁移设置。
   */
  private async migrateV2(value: Record<string, unknown>): Promise<StoredBundleV4> {
    const allowedKeys = new Set(['schemaVersion', 'pythonBaseUrl', 'managedScope', 'autoSend', 'ignoreOfficial', 'batchWindowMs', 'requestTimeoutMs', 'encryptedApiKey', 'migrationNotice'])
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('settings_corrupt')
    if (value.encryptedApiKey !== undefined && typeof value.encryptedApiKey !== 'string') throw new Error('settings_corrupt')
    if (value.migrationNotice !== undefined && value.migrationNotice !== 'scope_confirmation_required') throw new Error('settings_corrupt')
    let legacy: ReturnType<typeof parseLegacyOmniMindPersistedSettingsV2>
    try {
      legacy = parseLegacyOmniMindPersistedSettingsV2({
        schemaVersion: value.schemaVersion,
        pythonBaseUrl: value.pythonBaseUrl,
        managedScope: value.managedScope,
        autoSend: value.autoSend,
        ignoreOfficial: value.ignoreOfficial,
        batchWindowMs: value.batchWindowMs,
        requestTimeoutMs: value.requestTimeoutMs
      }, { allowEmptySelected: value.migrationNotice === 'scope_confirmation_required' })
    } catch { throw new Error('settings_corrupt') }
    const managedScope: ManagedScope = legacy.managedScope.mode === 'all'
      ? legacy.managedScope
      : {
          mode: 'selected',
          conversations: legacy.managedScope.conversations.filter((item) => classifyOmniMindConversation(item.sessionId) !== 'official')
        }
    const migrated: StoredBundleV4 = {
      schemaVersion: 4,
      pythonBaseUrl: legacy.pythonBaseUrl,
      managedScope,
      autoSend: legacy.autoSend,
      batchWindowMs: legacy.batchWindowMs,
      ...(typeof value.encryptedApiKey === 'string' ? { encryptedApiKey: value.encryptedApiKey } : {}),
      ...((value.migrationNotice === 'scope_confirmation_required' || (managedScope.mode === 'selected' && managedScope.conversations.length === 0))
        ? { migrationNotice: 'scope_confirmation_required' as const }
        : {})
    }
    await this.dependencies.writeAtomic(SETTINGS_KEY, JSON.stringify(migrated))
    return migrated
  }

  private async migrateV1(value: Record<string, unknown>): Promise<StoredBundleV4 & { fromLegacy: true }> {
    /**
     * 历史提交 c22cf3c 的 v1 合同没有 schemaVersion，只包含连接端点、字符串 scope，
     * 可选的 ignore 策略、时序和内嵌密文。autoSend 当时由迁移逻辑固定为 true，并非持久字段。
     * 因此这里只允许历史真实字段；未知键或未来字段必须失败，避免静默丢凭据或覆盖未来格式。
     */
    const allowedKeys = new Set(['pythonBaseUrl', 'scope', 'officialAccountPolicy', 'batchWindowMs', 'requestTimeoutMs', 'encryptedApiKey'])
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('settings_corrupt')
    if (typeof value.pythonBaseUrl !== 'string' || !value.pythonBaseUrl.trim() || !Array.isArray(value.scope) || value.scope.some((item) => typeof item !== 'string')) throw new Error('settings_corrupt')
    if (value.officialAccountPolicy !== undefined && value.officialAccountPolicy !== 'ignore') throw new Error('settings_corrupt')
    if (value.encryptedApiKey !== undefined && typeof value.encryptedApiKey !== 'string') throw new Error('settings_corrupt')
    let timings: ReturnType<typeof parseOmniMindTimings>
    try {
      timings = parseOmniMindTimings(value.batchWindowMs)
      // v1 的旧超时值仍必须是历史合法整数；只在迁移成功后才丢弃。
      const legacyTimeout = value.requestTimeoutMs ?? 15_000
      if (!Number.isInteger(legacyTimeout) || Number(legacyTimeout) < 1_000 || Number(legacyTimeout) > 120_000) throw new Error('invalid_legacy_timeout')
    } catch { throw new Error('settings_corrupt') }
    let pythonBaseUrl: string
    try { pythonBaseUrl = normalizeOmniMindBaseUrl(value.pythonBaseUrl) } catch { throw new Error('settings_corrupt') }
    const conversations: Array<{ sessionId: string; displayName: string }> = []
    const seen = new Set<string>()
    for (const rawId of value.scope as string[]) {
      const sessionId = rawId.trim()
      const identity = sessionId.toLocaleLowerCase()
      if (!sessionId || seen.has(identity)) continue
      seen.add(identity)
      // v1 没有联系人类型元数据，只过滤稳定 gh_ 身份；其他无法识别的历史项继续可见，
      // Renderer catalog 与运行时 sessionType 仍会在后续边界 fail closed。
      if (classifyOmniMindConversation(sessionId) !== 'official') conversations.push({ sessionId, displayName: '' })
    }
    const legacyEncrypted = typeof value.encryptedApiKey === 'string' ? value.encryptedApiKey : await this.dependencies.read(LEGACY_API_KEY)
    const migrated: StoredBundleV4 & { fromLegacy: true } = {
      schemaVersion: 4,
      pythonBaseUrl,
      managedScope: { mode: 'selected', conversations },
      autoSend: true,
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
