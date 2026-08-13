export const OMNIMIND_RUNTIME_STATES = ['stopped', 'validating', 'starting', 'running', 'degraded', 'stopping', 'failed'] as const
export type OmniMindRuntimeState = typeof OMNIMIND_RUNTIME_STATES[number]

export const OMNIMIND_PERMISSION_KINDS = ['accessibility', 'automation'] as const
export type OmniMindPermissionKind = typeof OMNIMIND_PERMISSION_KINDS[number]
export const OMNIMIND_PERMISSION_STATES = ['not_requested', 'unknown', 'granted', 'denied', 'unsupported'] as const
export type OmniMindPermissionState = typeof OMNIMIND_PERMISSION_STATES[number]
export interface OmniMindPermissionSnapshot {
  accessibility: OmniMindPermissionState
  automation: OmniMindPermissionState
}
export interface OmniMindPermissionReturnEvent {
  kind: OmniMindPermissionKind
  snapshot: OmniMindPermissionSnapshot
}

export const OMNIMIND_TASK_STATES = ['queued', 'generating', 'waiting_to_send', 'awaiting_manual_send', 'sending', 'sent', 'delivery_unconfirmed', 'cancelled', 'generation_failed', 'send_failed'] as const
export type OmniMindTaskState = typeof OMNIMIND_TASK_STATES[number]

export const OMNIMIND_FAILURE_STAGES = ['generation', 'authorization', 'verification_baseline', 'automation', 'verification_postsend', 'cleanup', 'runtime_logging'] as const
export type OmniMindFailureStage = typeof OMNIMIND_FAILURE_STAGES[number]

export interface OmniMindSendResult {
  success: boolean
  error?: string
  stage?: OmniMindFailureStage
}

export interface ManagedConversation { sessionId: string; displayName: string }
export type ManagedScope =
  | { mode: 'selected'; conversations: ManagedConversation[] }
  | { mode: 'all'; confirmedAt: number }

export interface OmniMindSettings {
  schemaVersion: 2
  pythonBaseUrl: string
  managedScope: ManagedScope
  autoSend: boolean
  ignoreOfficial: boolean
  hasApiKey: boolean
  batchWindowMs: number
  requestTimeoutMs: number
  migrationNotice?: 'scope_confirmation_required'
}

export interface OmniMindSettingsInput {
  schemaVersion: 2
  pythonBaseUrl: string
  managedScope: ManagedScope
  autoSend: boolean
  ignoreOfficial: boolean
  apiKeyDraft?: string
  clearApiKey?: boolean
  batchWindowMs: number
  requestTimeoutMs: number
}

export const isCriticalSettingsChange = (previous: OmniMindSettings, draft: OmniMindSettingsInput): boolean =>
  previous.pythonBaseUrl !== draft.pythonBaseUrl ||
  Boolean(draft.apiKeyDraft?.trim()) || Boolean(draft.clearApiKey) ||
  JSON.stringify(previous.managedScope) !== JSON.stringify(draft.managedScope) ||
  previous.ignoreOfficial !== draft.ignoreOfficial

export const normalizeOmniMindBaseUrl = (value: string): string => {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('invalid_base_url') }
  if (url.username || url.password || url.search || url.hash) throw new Error('invalid_base_url')
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())
  if (!((url.protocol === 'http:' && loopback) || url.protocol === 'https:')) throw new Error('invalid_base_url')
  if (!url.hostname || (url.port && (!/^\d+$/.test(url.port) || Number(url.port) > 65535))) throw new Error('invalid_base_url')
  const marker = '/api/v1/open'
  const markerIndex = url.pathname.toLowerCase().indexOf(marker)
  url.pathname = markerIndex >= 0 ? url.pathname.slice(0, markerIndex) + marker : url.pathname.replace(/\/+$/, '') + marker
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export const isLocalOmniMindEndpoint = (value: string): boolean => {
  try { return normalizeOmniMindBaseUrl(value).startsWith('http://') } catch { return false }
}

export const parseManagedScope = (value: unknown): ManagedScope => {
  const record = strictRecord(value, ['mode', 'conversations', 'confirmedAt'], 'managed scope')
  if (record.mode === 'all') {
    if (record.conversations !== undefined || typeof record.confirmedAt !== 'number' || !Number.isFinite(record.confirmedAt) || record.confirmedAt <= 0) throw new Error('Invalid managed scope payload')
    return { mode: 'all', confirmedAt: record.confirmedAt }
  }
  if (record.mode !== 'selected' || record.confirmedAt !== undefined || !Array.isArray(record.conversations) || record.conversations.length === 0) throw new Error('Invalid managed scope payload')
  const conversations: ManagedConversation[] = []
  const seen = new Set<string>()
  for (const item of record.conversations) {
    const conversation = strictRecord(item, ['sessionId', 'displayName'], 'managed conversation')
    const sessionId = requiredString(conversation, 'sessionId', 'managed conversation')
    const identity = sessionId.toLocaleLowerCase()
    if (seen.has(identity)) continue
    seen.add(identity)
    conversations.push({ sessionId, displayName: typeof conversation.displayName === 'string' ? conversation.displayName.trim() : '' })
  }
  return { mode: 'selected', conversations }
}

export const isManagedSession = (scope: ManagedScope, sessionId: string): boolean =>
  scope.mode === 'all' || scope.conversations.some((conversation) => conversation.sessionId.trim().toLocaleLowerCase() === sessionId.trim().toLocaleLowerCase())

export interface OmniMindTask {
  id: string
  accountId: string
  sessionId: string
  sessionName: string
  sessionType?: NormalizedMessageEvent['sessionType']
  messageKeys: string[]
  text: string
  status: OmniMindTaskState
  createdAt: number
  updatedAt: number
  replyText?: string
  generatedAt?: number
  newMessagesSinceGenerated?: number
  staleAcknowledged?: boolean
  failureStage?: OmniMindFailureStage
  reason?: string
  retryOf?: string
}

export interface OmniMindTaskSummary extends Pick<OmniMindTask, 'id' | 'sessionId' | 'sessionName' | 'status' | 'createdAt' | 'updatedAt' | 'failureStage' | 'reason' | 'retryOf'> {
  replyText?: string
  generatedAt?: number
  newMessagesSinceGenerated?: number
}

export interface OmniMindSnapshot {
  runtimeState: OmniMindRuntimeState
  current?: OmniMindTaskSummary
  waiting: OmniMindTaskSummary[]
  awaitingManualSend?: OmniMindTaskSummary[]
  recent: OmniMindTaskSummary[]
  error?: string
}

export interface NormalizedMessageEvent {
  accountId: string
  sessionId: string
  messageKey: string
  direction: 'inbound' | 'outbound'
  text: string
  timestamp: number
  sessionType: 'private' | 'group' | 'official' | 'other'
  messageType: number
  contentType: 'text' | 'image' | 'voice' | 'video' | 'emoji' | 'location' | 'contact' | 'file' | 'link' | 'other'
  sessionName?: string
}

type RecordValue = Record<string, unknown>

const strictRecord = (value: unknown, allowedKeys: readonly string[], label: string): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} payload`)
  const record = value as RecordValue
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) throw new Error(`Invalid ${label} payload`)
  return record
}

const requiredString = (record: RecordValue, key: string, label: string): string => {
  if (typeof record[key] !== 'string' || !String(record[key]).trim()) throw new Error(`Invalid ${label} payload`)
  return String(record[key]).trim()
}

export const makeStableMessageId = (accountId: string, sessionId: string, messageKey: string): string =>
  [accountId, sessionId, messageKey].map((value) => String(value || '').trim()).join('\u001f')

export const parseEnablePayload = (value: unknown): Record<string, never> => {
  strictRecord(value, [], 'enable')
  return {}
}

export const parsePermissionKindPayload = (value: unknown): { permission: OmniMindPermissionKind } => {
  const record = strictRecord(value, ['permission'], 'permission')
  if (typeof record.permission !== 'string' || !OMNIMIND_PERMISSION_KINDS.includes(record.permission as OmniMindPermissionKind)) throw new Error('Invalid permission payload')
  return { permission: record.permission as OmniMindPermissionKind }
}

export const parseCancelTaskPayload = (value: unknown): { taskId: string } => {
  const record = strictRecord(value, ['taskId'], 'cancel task')
  return { taskId: requiredString(record, 'taskId', 'cancel task') }
}

export const parseRetryTaskPayload = parseCancelTaskPayload

export const parseManualSendPayload = (value: unknown): { sessionId: string; text: string } => {
  const record = strictRecord(value, ['sessionId', 'text'], 'manual send')
  const sessionId = requiredString(record, 'sessionId', 'manual send')
  if (typeof record.text !== 'string' || !record.text.trim()) throw new Error('Invalid manual send payload')
  return { sessionId, text: record.text }
}

export const parseSettingsPayload = (value: unknown): OmniMindSettingsInput => {
  const record = strictRecord(value, ['schemaVersion', 'pythonBaseUrl', 'managedScope', 'autoSend', 'ignoreOfficial', 'apiKeyDraft', 'clearApiKey', 'batchWindowMs', 'requestTimeoutMs'], 'settings')
  if (record.schemaVersion !== 2 || typeof record.autoSend !== 'boolean' || typeof record.ignoreOfficial !== 'boolean') throw new Error('Invalid settings payload')
  const pythonBaseUrl = normalizeOmniMindBaseUrl(requiredString(record, 'pythonBaseUrl', 'settings'))
  const managedScope = parseManagedScope(record.managedScope)
  const { batchWindowMs, requestTimeoutMs } = parseOmniMindTimings(record.batchWindowMs, record.requestTimeoutMs)
  const result: OmniMindSettingsInput = {
    schemaVersion: 2, pythonBaseUrl, managedScope,
    autoSend: record.autoSend, ignoreOfficial: record.ignoreOfficial,
    batchWindowMs: Number(batchWindowMs),
    requestTimeoutMs: Number(requestTimeoutMs)
  }
  if (record.apiKeyDraft !== undefined) {
    if (typeof record.apiKeyDraft !== 'string' || !record.apiKeyDraft.trim()) throw new Error('Invalid settings payload')
    result.apiKeyDraft = record.apiKeyDraft
  }
  if (record.clearApiKey !== undefined) {
    if (typeof record.clearApiKey !== 'boolean') throw new Error('Invalid settings payload')
    result.clearApiKey = record.clearApiKey
  }
  if (result.apiKeyDraft && result.clearApiKey) throw new Error('Invalid settings payload')
  return result
}

export const parseOmniMindTimings = (batchValue: unknown = 2000, timeoutValue: unknown = 15000): { batchWindowMs: number; requestTimeoutMs: number } => {
  if (!Number.isInteger(batchValue) || Number(batchValue) < 500 || Number(batchValue) > 10000) throw new Error('Invalid settings payload')
  if (!Number.isInteger(timeoutValue) || Number(timeoutValue) < 1000 || Number(timeoutValue) > 120000) throw new Error('Invalid settings payload')
  return { batchWindowMs: Number(batchValue), requestTimeoutMs: Number(timeoutValue) }
}

export const parseTestConnectionPayload = (value: unknown): { pythonBaseUrl: string; apiKeyDraft?: string } => {
  const record = strictRecord(value, ['pythonBaseUrl', 'apiKeyDraft'], 'test connection')
  const result: { pythonBaseUrl: string; apiKeyDraft?: string } = { pythonBaseUrl: normalizeOmniMindBaseUrl(requiredString(record, 'pythonBaseUrl', 'test connection')) }
  if (record.apiKeyDraft !== undefined) result.apiKeyDraft = requiredString(record, 'apiKeyDraft', 'test connection')
  return result
}

export const parseTaskActionPayload = parseCancelTaskPayload
