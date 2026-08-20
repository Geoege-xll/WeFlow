import {
  areManagedScopesEquivalent,
  classifyOmniMindConversation,
  parseManagedScope,
  type ManagedScope
} from './conversation-domain'
import type { OmniMindSettings, OmniMindSettingsInput } from './contracts'
import { UNIFIED_AUTOMATIC_HOSTING_POLICY } from './automatic-hosting-policy.generated'

/**
 * 设置领域是 Renderer、IPC 与安全存储共同使用的单一真值。
 * UI 可以用秒展示，但持久化和运行时一律使用毫秒，所有边界只在这里定义。
 */
export const OMNIMIND_SETTINGS_DEFAULTS = Object.freeze({
  pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
  managedScope: Object.freeze({ mode: 'selected' as const, conversations: Object.freeze([]) }),
  autoSend: UNIFIED_AUTOMATIC_HOSTING_POLICY.autoSend,
  batchWindowMs: UNIFIED_AUTOMATIC_HOSTING_POLICY.batchWindowMs.default
})

export const OMNIMIND_SETTING_RANGES = Object.freeze({
  batchWindowMs: Object.freeze({
    min: UNIFIED_AUTOMATIC_HOSTING_POLICY.batchWindowMs.min,
    max: UNIFIED_AUTOMATIC_HOSTING_POLICY.batchWindowMs.max,
    step: UNIFIED_AUTOMATIC_HOSTING_POLICY.batchWindowMs.step
  })
})

export type OmniMindSettingsField = 'pythonBaseUrl' | 'managedScope' | 'autoSend' | 'apiKey' | 'batchWindowMs'
export type OmniMindSettingsValidationCode = 'invalid_endpoint' | 'empty_scope' | 'unconfirmed_all_scope' | 'official_scope_conflict' | 'invalid_timing'

export interface OmniMindSettingsValidationIssue {
  code: OmniMindSettingsValidationCode
  field: OmniMindSettingsField
}

export interface OmniMindSettingsDiff {
  pythonBaseUrl: boolean
  managedScope: boolean
  autoSend: boolean
  apiKey: boolean
  batchWindowMs: boolean
  dirty: boolean
  critical: boolean
}

export interface OmniMindSettingsDraft {
  pythonBaseUrl: string
  managedScope: ManagedScope
  autoSend: boolean
  apiKeyDraft: string
  batchWindowMs: number
}

export interface OmniMindPersistedSettingsCore {
  schemaVersion: 4
  pythonBaseUrl: string
  managedScope: ManagedScope
  autoSend: boolean
  batchWindowMs: number
}

/** v3 只用于一次性迁移；旧的用户超时会被严格验证后丢弃。 */
export interface LegacyOmniMindPersistedSettingsV3 extends Omit<OmniMindPersistedSettingsCore, 'schemaVersion'> {
  schemaVersion: 3
  requestTimeoutMs: number
}

/** v2 只用于安全存储的一次性迁移读取；旧策略和超时都不会进入 v4 领域模型。 */
export interface LegacyOmniMindPersistedSettingsV2 extends Omit<OmniMindPersistedSettingsCore, 'schemaVersion'> {
  schemaVersion: 2
  ignoreOfficial: boolean
  requestTimeoutMs: number
}

const strictRecord = (value: unknown, allowedKeys: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} payload`)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) throw new Error(`Invalid ${label} payload`)
  return record
}

const requiredString = (record: Record<string, unknown>, key: string, label: string): string => {
  if (typeof record[key] !== 'string' || !String(record[key]).trim()) throw new Error(`Invalid ${label} payload`)
  return String(record[key]).trim()
}

export const normalizeOmniMindBaseUrl = (value: string): string => {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('invalid_base_url') }
  if (url.username || url.password || url.search || url.hash) throw new Error('invalid_base_url')
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())
  if (!((url.protocol === 'http:' && loopback) || url.protocol === 'https:')) throw new Error('invalid_base_url')
  if (!url.hostname || (url.port && (!/^\d+$/.test(url.port) || Number(url.port) > 65_535))) throw new Error('invalid_base_url')
  const marker = '/api/v1/open'
  const markerIndex = url.pathname.toLowerCase().indexOf(marker)
  url.pathname = markerIndex >= 0 ? url.pathname.slice(0, markerIndex) + marker : url.pathname.replace(/\/+$/, '') + marker
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export const isLocalOmniMindEndpoint = (value: string): boolean => {
  try { return new URL(normalizeOmniMindBaseUrl(value)).protocol === 'http:' } catch { return false }
}

/** 连接结果展示只能从已经通过规范化的 URL 派生协议，不能固定声称 HTTPS。 */
export const getOmniMindEndpointProtocol = (value: string): 'HTTP' | 'HTTPS' =>
  new URL(normalizeOmniMindBaseUrl(value)).protocol === 'https:' ? 'HTTPS' : 'HTTP'

export const parseOmniMindTimings = (
  batchValue: unknown = OMNIMIND_SETTINGS_DEFAULTS.batchWindowMs
): { batchWindowMs: number } => {
  const batchRange = OMNIMIND_SETTING_RANGES.batchWindowMs
  if (!Number.isInteger(batchValue) || Number(batchValue) < batchRange.min || Number(batchValue) > batchRange.max) throw new Error('Invalid settings payload')
  return { batchWindowMs: Number(batchValue) }
}

/**
 * 旧 schema 中的 requestTimeoutMs 只能在迁移边界被读取。先验证它是历史允许的整数范围，
 * 再由 Store 丢弃；不得把它重新投影到 Renderer、IPC 或当前持久化合同。
 */
const parseLegacyRequestTimeout = (value: unknown): number => {
  if (!Number.isInteger(value) || Number(value) < 1_000 || Number(value) > 120_000) throw new Error('Invalid settings payload')
  return Number(value)
}

/** 主进程安全存储与 Renderer IPC 都复用此核心解析，不再维护两套范围和时序边界。 */
export const parsePersistedOmniMindSettings = (value: unknown, options: { allowEmptySelected?: boolean } = {}): OmniMindPersistedSettingsCore => {
  const record = strictRecord(value, ['schemaVersion', 'pythonBaseUrl', 'managedScope', 'autoSend', 'batchWindowMs'], 'settings')
  if (record.schemaVersion !== 4 || typeof record.autoSend !== 'boolean') throw new Error('Invalid settings payload')
  const managedScope = parseManagedScope(record.managedScope, { allowEmptySelected: options.allowEmptySelected })
  const timings = parseOmniMindTimings(record.batchWindowMs)
  return {
    schemaVersion: 4,
    pythonBaseUrl: normalizeOmniMindBaseUrl(requiredString(record, 'pythonBaseUrl', 'settings')),
    managedScope,
    autoSend: record.autoSend,
    ...timings
  }
}

/** v3 保持严格字段集，避免未知未来字段在升级时被静默丢失。 */
export const parseLegacyOmniMindPersistedSettingsV3 = (value: unknown, options: { allowEmptySelected?: boolean } = {}): LegacyOmniMindPersistedSettingsV3 => {
  const record = strictRecord(value, ['schemaVersion', 'pythonBaseUrl', 'managedScope', 'autoSend', 'batchWindowMs', 'requestTimeoutMs'], 'settings')
  if (record.schemaVersion !== 3 || typeof record.autoSend !== 'boolean') throw new Error('Invalid settings payload')
  return {
    schemaVersion: 3,
    pythonBaseUrl: normalizeOmniMindBaseUrl(requiredString(record, 'pythonBaseUrl', 'settings')),
    managedScope: parseManagedScope(record.managedScope, { allowEmptySelected: options.allowEmptySelected }),
    autoSend: record.autoSend,
    ...parseOmniMindTimings(record.batchWindowMs),
    requestTimeoutMs: parseLegacyRequestTimeout(record.requestTimeoutMs)
  }
}

/**
 * v2 解析保持严格，确保损坏或夹带未知字段的数据不会被“迁移”成表面合法的 v3。
 * ignoreOfficial 仅被验证为旧格式的一部分，返回后由 Store 丢弃并原子写入 v3。
 */
export const parseLegacyOmniMindPersistedSettingsV2 = (value: unknown, options: { allowEmptySelected?: boolean } = {}): LegacyOmniMindPersistedSettingsV2 => {
  const record = strictRecord(value, ['schemaVersion', 'pythonBaseUrl', 'managedScope', 'autoSend', 'ignoreOfficial', 'batchWindowMs', 'requestTimeoutMs'], 'settings')
  if (record.schemaVersion !== 2 || typeof record.autoSend !== 'boolean' || typeof record.ignoreOfficial !== 'boolean') throw new Error('Invalid settings payload')
  return {
    schemaVersion: 2,
    pythonBaseUrl: normalizeOmniMindBaseUrl(requiredString(record, 'pythonBaseUrl', 'settings')),
    managedScope: parseManagedScope(record.managedScope, { allowEmptySelected: options.allowEmptySelected }),
    autoSend: record.autoSend,
    ignoreOfficial: record.ignoreOfficial,
    ...parseOmniMindTimings(record.batchWindowMs),
    requestTimeoutMs: parseLegacyRequestTimeout(record.requestTimeoutMs)
  }
}

export const parseSettingsPayload = (value: unknown): OmniMindSettingsInput => {
  // clearApiKey 是独立 IPC 命令，不属于可持久设置。普通保存出现该字段必须按未知字段拒绝，
  // 防止 renderer 借清除凭据旁路范围或官方账号校验。
  const record = strictRecord(value, ['schemaVersion', 'pythonBaseUrl', 'managedScope', 'autoSend', 'apiKeyDraft', 'batchWindowMs'], 'settings')
  const core = parsePersistedOmniMindSettings({
    schemaVersion: record.schemaVersion,
    pythonBaseUrl: record.pythonBaseUrl,
    managedScope: record.managedScope,
    autoSend: record.autoSend,
    batchWindowMs: record.batchWindowMs
  })
  const result: OmniMindSettingsInput = { ...core }
  if (record.apiKeyDraft !== undefined) {
    if (typeof record.apiKeyDraft !== 'string' || !record.apiKeyDraft.trim()) throw new Error('Invalid settings payload')
    result.apiKeyDraft = record.apiKeyDraft
  }
  // 能从稳定 sessionId 识别出的官方账号必须在 IPC 保存边界 fail closed；
  // 联系人元数据识别出的官方账号由 Renderer catalog 在保存前补充拦截。
  if (result.managedScope.mode === 'selected' && result.managedScope.conversations.some((item) => classifyOmniMindConversation(item.sessionId) === 'official')) throw new Error('Invalid settings payload')
  return result
}

export const createOmniMindSettingsDraft = (settings: OmniMindSettings): OmniMindSettingsDraft => ({
  pythonBaseUrl: settings.pythonBaseUrl,
  managedScope: settings.managedScope,
  autoSend: settings.autoSend,
  apiKeyDraft: '',
  batchWindowMs: settings.batchWindowMs
})

export const toOmniMindSettingsInput = (draft: OmniMindSettingsDraft): OmniMindSettingsInput => ({
  schemaVersion: 4,
  pythonBaseUrl: normalizeOmniMindBaseUrl(draft.pythonBaseUrl),
  managedScope: parseManagedScope(draft.managedScope),
  autoSend: draft.autoSend,
  batchWindowMs: draft.batchWindowMs,
  ...(draft.apiKeyDraft ? { apiKeyDraft: draft.apiKeyDraft } : {})
})

export const diffOmniMindSettings = (previous: OmniMindSettings, draft: OmniMindSettingsDraft | OmniMindSettingsInput): OmniMindSettingsDiff => {
  let normalizedDraftEndpoint = draft.pythonBaseUrl
  try { normalizedDraftEndpoint = normalizeOmniMindBaseUrl(draft.pythonBaseUrl) } catch { /* 无效草稿仍应标记为 dirty，由 validation 给出具体原因。 */ }
  const differences = {
    pythonBaseUrl: previous.pythonBaseUrl !== normalizedDraftEndpoint,
    managedScope: !areManagedScopesEquivalent(previous.managedScope, draft.managedScope),
    autoSend: previous.autoSend !== draft.autoSend,
    apiKey: Boolean(draft.apiKeyDraft?.trim()),
    batchWindowMs: previous.batchWindowMs !== draft.batchWindowMs
  }
  const dirty = Object.values(differences).some(Boolean)
  const critical = differences.pythonBaseUrl || differences.managedScope || differences.apiKey
  return { ...differences, dirty, critical }
}

export const isCriticalSettingsChange = (previous: OmniMindSettings, draft: OmniMindSettingsInput): boolean =>
  diffOmniMindSettings(previous, draft).critical

export const validateOmniMindSettingsDraft = (
  draft: OmniMindSettingsDraft,
  knownOfficialSessionIds: ReadonlySet<string> = new Set(),
): OmniMindSettingsValidationIssue[] => {
  const issues: OmniMindSettingsValidationIssue[] = []
  try { normalizeOmniMindBaseUrl(draft.pythonBaseUrl) } catch { issues.push({ code: 'invalid_endpoint', field: 'pythonBaseUrl' }) }
  if (draft.managedScope.mode === 'selected' && draft.managedScope.conversations.length === 0) issues.push({ code: 'empty_scope', field: 'managedScope' })
  if (draft.managedScope.mode === 'all' && draft.managedScope.confirmedAt <= 0) issues.push({ code: 'unconfirmed_all_scope', field: 'managedScope' })
  if (draft.managedScope.mode === 'selected') {
    const knownOfficial = new Set([...knownOfficialSessionIds].map((id) => id.trim().toLocaleLowerCase()))
    const hasOfficial = draft.managedScope.conversations.some((item) => classifyOmniMindConversation(item.sessionId) === 'official' || knownOfficial.has(item.sessionId.trim().toLocaleLowerCase()))
    if (hasOfficial) issues.push({ code: 'official_scope_conflict', field: 'managedScope' })
  }
  try { parseOmniMindTimings(draft.batchWindowMs) } catch { issues.push({ code: 'invalid_timing', field: 'batchWindowMs' }) }
  return issues
}

export const parseTestConnectionPayload = (value: unknown): { pythonBaseUrl: string; apiKeyDraft?: string } => {
  const record = strictRecord(value, ['pythonBaseUrl', 'apiKeyDraft'], 'test connection')
  const result: { pythonBaseUrl: string; apiKeyDraft?: string } = { pythonBaseUrl: normalizeOmniMindBaseUrl(requiredString(record, 'pythonBaseUrl', 'test connection')) }
  if (record.apiKeyDraft !== undefined) result.apiKeyDraft = requiredString(record, 'apiKeyDraft', 'test connection')
  return result
}
