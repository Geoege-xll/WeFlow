// paused 是主进程持久快照中的正式运行态：它表示队列上下文仍在，但新的消息接入已被阻断。
// 不能在 renderer 侧用临时 boolean 模拟，否则刷新页面后会错误地把“暂停”当成“停止”。
export const OMNIMIND_RUNTIME_STATES = ['stopped', 'validating', 'starting', 'running', 'paused', 'degraded', 'stopping', 'failed'] as const
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

/**
 * Python Open Chat 允许 OmniMindWeChat 消费的公开失败码白名单。
 *
 * 这些值只描述可安全公开、且会直接影响队列重试策略的状态。服务端响应中的 message、
 * detail、异常栈或任意扩展字段都不进入客户端合同，避免把模型输入、画像或内部错误正文
 * 带入 Electron 状态快照。新增失败码必须先在两端合同中明确约定，不能在运行时透传。
 */
export const OMNIMIND_OPEN_CHAT_FAILURE_CODES = [
  'execution_result_unknown',
  'credential_revoked',
  'retry_exhausted',
  'invalid_persisted_request',
  'duplicate_external_message',
  'generation_timeout',
  'service_unavailable'
] as const
export type OmniMindOpenChatFailureCode = typeof OMNIMIND_OPEN_CHAT_FAILURE_CODES[number]

export interface OmniMindSendResult {
  success: boolean
  error?: string
  stage?: OmniMindFailureStage
}

/**
 * Open Recovery Delivery 只允许连接器消费这一组最小字段。
 *
 * routeReference/sessionReference 都是 OmniMind 服务端生成的内部 UUID；公开合同刻意不含
 * 微信 sessionId、渠道回执、异常正文或服务端错误详情。真正的本地微信路由只保存在
 * safeStorage 加密的主进程 journal 中，绝不穿过 preload/renderer 边界。
 */
export interface OpenRecoveryDeliveryItem {
  deliveryId: string
  fulfillmentId: string
  attemptNumber: number
  parentDeliveryId?: string
  sessionReference: string
  routeReference: string
  content: string
  status: 'queued'
}

export interface OpenRecoveryDeliveryStatus {
  deliveryId: string
  fulfillmentId: string
  attemptNumber: number
  parentDeliveryId?: string
  status: 'queued' | 'claimed' | 'acknowledged' | 'failed' | 'result_unknown'
  result: 'pending' | 'confirmed_sent' | 'not_sent' | 'result_unknown'
}

export interface OpenRecoveryDeliveryClaim {
  deliveryId: string
  leaseToken: string
  leaseExpiresAt: string
  fencingToken: number
}

export type { ManagedConversation, ManagedScope } from './conversation-domain'
export { isManagedSession, parseManagedScope } from './conversation-domain'
import type { ManagedScope } from './conversation-domain'

export interface OmniMindSettings {
  schemaVersion: 4
  pythonBaseUrl: string
  managedScope: ManagedScope
  autoSend: boolean
  hasApiKey: boolean
  batchWindowMs: number
  migrationNotice?: 'scope_confirmation_required'
}

export interface OmniMindSettingsInput {
  schemaVersion: 4
  pythonBaseUrl: string
  managedScope: ManagedScope
  autoSend: boolean
  apiKeyDraft?: string
  batchWindowMs: number
}

export {
  isCriticalSettingsChange,
  isLocalOmniMindEndpoint,
  normalizeOmniMindBaseUrl,
  parseOmniMindTimings,
  parseSettingsPayload,
  parseTestConnectionPayload
} from './settings-domain'

export interface OmniMindTask {
  id: string
  accountId: string
  sessionId: string
  sessionName: string
  sessionType?: NormalizedMessageEvent['sessionType']
  /**
   * 仅在 Electron main 的队列内部流转的原始入站事件。
   *
   * messageKey 可能包含本地数据库定位信息，因此绝不能进入 Renderer 快照、日志或网络请求；
   * Python client 必须先对它做 SHA-256，再构造公开协议中的 messages[].external_id。
   * 保留逐条事件而不是只保存拼接文本，是为了让群聊 sender、消息时间和幂等身份不在批处理中丢失。
   */
  inboundMessages: NormalizedMessageEvent[]
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
  /**
   * 入站消息的可证明发送者标识。私聊由联系人 sessionId 提供；群聊只能来自消息行的
   * senderUsername，缺失时必须保持 undefined，不能回退为 chatroom sessionId。
   */
  senderExternalId?: string
  /** 发送者展示名只用于 profile 外部观察事实；它不能替代 senderExternalId 建立客户身份。 */
  senderDisplayName?: string
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

export const parseTaskActionPayload = parseCancelTaskPayload
// 语义上与其他 task action 相同，但保留显式命名，避免 IPC 层误用宽泛或 renderer 可控的发送载荷。
export const parseConfirmDeliveryPayload = parseCancelTaskPayload
