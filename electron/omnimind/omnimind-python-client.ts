import { createHash } from 'crypto'
import {
  OMNIMIND_OPEN_CHAT_FAILURE_CODES,
  type NormalizedMessageEvent,
  type OmniMindOpenChatFailureCode
} from '../../shared/omnimind/contracts'
import { UNIFIED_AUTOMATIC_HOSTING_POLICY } from '../../shared/omnimind/automatic-hosting-policy.generated'
import type { GenerationResult } from './global-ai-queue'
import { OPEN_CHAT_CHANNEL_IDENTITY } from '../../shared/app-identity'

interface PythonClientDependencies {
  fetch?: typeof fetch
  authCheckTimeoutMs?: number
  chatTransportGuardMs?: number
}

interface ChatInput {
  baseUrl: string
  apiKey: string
  accountId: string
  sessionId: string
  sessionName: string
  sessionType?: NormalizedMessageEvent['sessionType']
  messages: NormalizedMessageEvent[]
  clientVersion?: string
  clientRequestId?: string
}

interface OpenChatActor {
  ref: string
  role: 'customer'
  external_id?: string
  identity_namespace?: 'wechat_user'
  display_name?: string
  profile_observed_at?: string
}

interface OpenChatRequest {
  source: {
    application: typeof OPEN_CHAT_CHANNEL_IDENTITY.application
    channel: typeof OPEN_CHAT_CHANNEL_IDENTITY.channel
    instance_id: string
    client_version?: string
  }
  conversation: {
    external_id: string
    type: 'direct' | 'group' | 'other'
    display_name?: string
  }
  actors: OpenChatActor[]
  messages: Array<{
    external_id: string
    actor_ref: string
    occurred_at: string
    content: Array<{ type: 'text'; text: string }>
  }>
  context: { surface: 'automatic_hosting' }
  response: { mode: 'sync'; formats: ['text'] }
  extensions: Record<string, never>
}

const AUTH_CHECK_TIMEOUT_MS = 15_000
const OPEN_CHAT_CONTRACT_VERSION = '2026-08-15'
/**
 * 这不是模型“思考时间”，也不是用户设置。Python Open Channel 拥有 300 秒服务端生成预算，
 * OmniMindWeChat 只在更晚的 330 秒切断永久挂死的 HTTP 连接，给服务端取消、序列化与网络收尾预留 30 秒。
 * 该值只允许通过构造依赖注入缩短测试时间，不能进入 Renderer DTO、IPC 或安全持久设置。
 */
export const CHAT_TRANSPORT_GUARD_MS =
  UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.transportGuardMs

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const MAX_MESSAGES = UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.maxMessagesPerBatch
const MAX_ACTORS = UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.maxActorsPerBatch
const MAX_TEXT_CHARS_PER_PART = UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.maxTextCharsPerPart
const MAX_CONTENT_PARTS = UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.maxContentPartsPerMessage
const MIN_EXTENSIONS_BYTES = UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.minExtensionsBytes
const MIN_EXTENSION_DEPTH = UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.minExtensionDepth
const MIN_IDEMPOTENCY_KEY_LENGTH = UNIFIED_AUTOMATIC_HOSTING_POLICY.openChat.minIdempotencyKeyLength
const MAX_ERROR_ENVELOPE_CHARS = 32_768

const FAILURE_HTTP_STATUS: Readonly<Record<OmniMindOpenChatFailureCode, number>> = {
  execution_result_unknown: 503,
  credential_revoked: 401,
  retry_exhausted: 503,
  invalid_persisted_request: 422,
  duplicate_external_message: 409,
  generation_timeout: 504,
  service_unavailable: 503
}

const ERROR_ENVELOPE_KEYS = ['code', 'message', 'data', 'timestamp', 'trace_id'] as const
const ERROR_DATA_KEYS = [
  'operation_id', 'status', 'canonical_session_id', 'canonical_conversation_id', 'lead_id', 'customer_id',
  'accepted_message_ids', 'reply', 'intent', 'handoff', 'profile_revision', 'error_code'
] as const
const ERROR_HANDOFF_KEYS = ['required', 'status', 'reason'] as const

const isStrictObject = (value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value as Record<string, unknown>).every((key) => allowedKeys.includes(key))
}

/**
 * 从非 2xx 响应中只提取双方冻结合同里的稳定失败码。
 *
 * 解析器同时验证 Content-Type、体积、顶层/数据/接管字段白名单、HTTP 状态与 code 的一致性。
 * 任一条件不满足就丢弃整个正文；尤其不读取 message/detail 作为错误原因，避免把服务端内部
 * 异常、客户消息、画像或 extensions 传播到主进程状态和后续日志。
 */
const parseSafeOpenChatFailure = async (response: Response): Promise<OmniMindOpenChatFailureCode | undefined> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) return undefined
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ERROR_ENVELOPE_CHARS) return undefined

  let text: string
  try { text = await response.text() } catch { return undefined }
  if (!text || text.length > MAX_ERROR_ENVELOPE_CHARS) return undefined

  let payload: unknown
  try { payload = JSON.parse(text) } catch { return undefined }
  if (!isStrictObject(payload, ERROR_ENVELOPE_KEYS)) return undefined
  if (payload.code !== response.status || typeof payload.message !== 'string') return undefined
  if (typeof payload.trace_id !== 'string' || !payload.trace_id.trim()) return undefined
  if (!(typeof payload.timestamp === 'string' || typeof payload.timestamp === 'number')) return undefined
  if (!isStrictObject(payload.data, ERROR_DATA_KEYS)) return undefined

  const data = payload.data
  if (typeof data.operation_id !== 'string' || !data.operation_id.trim() || data.status !== 'failed') return undefined
  if (typeof data.error_code !== 'string' || !OMNIMIND_OPEN_CHAT_FAILURE_CODES.includes(data.error_code as OmniMindOpenChatFailureCode)) return undefined
  const errorCode = data.error_code as OmniMindOpenChatFailureCode
  if (FAILURE_HTTP_STATUS[errorCode] !== response.status) return undefined
  if (!isStrictObject(data.handoff, ERROR_HANDOFF_KEYS)) return undefined
  if (data.handoff.required !== true || data.handoff.status !== 'recommended' || data.handoff.reason !== errorCode) return undefined
  return errorCode
}

const classifySafeOpenChatFailure = (status: number, errorCode?: OmniMindOpenChatFailureCode): Exclude<GenerationResult['kind'], 'reply'> => {
  if (errorCode === 'execution_result_unknown') return 'execution_result_unknown'
  if (errorCode === 'credential_revoked') return 'auth'
  if (errorCode === 'retry_exhausted') return 'retry_exhausted'
  if (errorCode === 'invalid_persisted_request') return 'invalid_persisted_request'
  // 只有通过完整失败信封校验的 service_unavailable 才是持久 tombstone；普通 5xx
  // 仍落到 network 并保留传输层重试能力，不能仅凭 HTTP 503 混淆两种语义。
  if (errorCode === 'service_unavailable') return 'service_unavailable'
  if (errorCode === 'duplicate_external_message' || status === 409) return 'conflict'
  if (errorCode === 'generation_timeout' || status === 408 || status === 504) return 'timeout'
  if (status === 401 || status === 403) return 'auth'
  return 'network'
}

/** 将微信秒级时间戳稳定转换为带 Z 时区的 ISO8601；无效值固定落到 epoch，禁止用当前时间污染幂等指纹。 */
const toOccurredAt = (timestamp: number): string => {
  const seconds = Number.isFinite(timestamp) ? Math.max(0, Math.trunc(timestamp)) : 0
  return new Date(seconds * 1000).toISOString()
}

const conversationType = (sessionType?: NormalizedMessageEvent['sessionType']): OpenChatRequest['conversation']['type'] => {
  if (sessionType === 'private') return 'direct'
  if (sessionType === 'group') return 'group'
  return 'other'
}

/** 按服务端能力预算切分长文本；不 trim、不改写字符，保证每个可见字符只出现一次。 */
const splitTextContent = (text: string): Array<{ type: 'text'; text: string }> => {
  const parts: Array<{ type: 'text'; text: string }> = []
  // Array.from 按 Unicode code point 切分，避免刚好在 8000 边界把 emoji 代理对劈开。
  const characters = Array.from(text)
  for (let offset = 0; offset < characters.length; offset += MAX_TEXT_CHARS_PER_PART) {
    parts.push({ type: 'text', text: characters.slice(offset, offset + MAX_TEXT_CHARS_PER_PART).join('') })
  }
  return parts
}

/**
 * 在 Electron main 内构造公开 Open Chat 信封。
 *
 * 最重要的安全边界有两个：第一，原始 messageKey 可能编码本地 DB 路径/表名，只允许其
 * SHA-256 摘要出网；第二，群聊 room sessionId 永远不能被当成客户，缺少 senderUsername
 * 时必须创建无 external_id 的匿名 actor，让服务端保留消息并安全转人工。
 */
const buildOpenChatRequest = (input: ChatInput): { body: OpenChatRequest; idempotencyKey: string } => {
  const actorByIdentity = new Map<string, OpenChatActor>()
  const actorRefByMessage = new Map<NormalizedMessageEvent, string>()
  let actorSequence = 0

  for (const message of input.messages) {
    const candidateExternalId = message.senderExternalId?.trim()
    const normalizedCandidate = candidateExternalId?.toLocaleLowerCase()
    const normalizedConversationId = input.sessionId.trim().toLocaleLowerCase()
    // DTO 构造是第二道独立信任边界：即使某个非 MessagePush 调用方绕过规范化层，
    // group actor 只要等于当前 room 或自身是任意 @chatroom 标识，仍必须降级为匿名。
    const provenGroupSender = candidateExternalId
      && normalizedCandidate !== normalizedConversationId
      && !normalizedCandidate?.endsWith('@chatroom')
      ? candidateExternalId
      : undefined
    const provenExternalId = input.sessionType === 'private'
      ? (candidateExternalId || input.sessionId.trim())
      : input.sessionType === 'group'
        ? provenGroupSender
        : candidateExternalId
    // 同一批群聊消息可能来自多名客户；用来源身份去重并给每个 actor 稳定编号。
    // 无法证明发送者的消息统一落到匿名槽位，但不会伪造 room -> customer 绑定。
    const actorIdentity = provenExternalId ? `wechat_user\u001f${provenExternalId}` : 'anonymous'
    let actor = actorByIdentity.get(actorIdentity)
    if (!actor) {
      const ref = `customer_${++actorSequence}`
      actor = {
        ref,
        role: 'customer',
        ...(provenExternalId ? { external_id: provenExternalId, identity_namespace: 'wechat_user' as const } : {})
      }
      actorByIdentity.set(actorIdentity, actor)
    }
    const displayName = message.senderDisplayName?.trim()
    if (displayName && provenExternalId) actor.display_name = displayName
    actor.profile_observed_at = toOccurredAt(message.timestamp)
    actorRefByMessage.set(message, actor.ref)
  }

  const publicMessages = input.messages.map((message) => ({
    // 保留 sha256: 前缀便于服务端和审计人员识别其为脱敏标识，而非微信/数据库原始主键。
    external_id: `sha256:${sha256(message.messageKey)}`,
    actor_ref: actorRefByMessage.get(message)!,
    occurred_at: toOccurredAt(message.timestamp),
    content: splitTextContent(message.text)
  }))
  const body: OpenChatRequest = {
    source: {
      application: OPEN_CHAT_CHANNEL_IDENTITY.application,
      channel: OPEN_CHAT_CHANNEL_IDENTITY.channel,
      instance_id: input.accountId,
      ...(input.clientVersion?.trim() ? { client_version: input.clientVersion.trim() } : {})
    },
    conversation: {
      external_id: input.sessionId,
      type: conversationType(input.sessionType),
      ...(input.sessionName.trim() ? { display_name: input.sessionName.trim() } : {})
    },
    actors: Array.from(actorByIdentity.values()),
    messages: publicMessages,
    context: { surface: 'automatic_hosting' },
    response: { mode: 'sync', formats: ['text'] },
    extensions: {}
  }
  // 幂等键不依赖 queue task UUID；相同来源、会话和有序消息摘要永远得到同一 key，
  // 因此 202 对账或安全重放只能命中原操作，绝不会重复追加客户消息或模型调用。
  const fingerprint = JSON.stringify({
    source: [OPEN_CHAT_CHANNEL_IDENTITY.application, OPEN_CHAT_CHANNEL_IDENTITY.channel, input.accountId],
    conversation: input.sessionId,
    message_ids: publicMessages.map((message) => message.external_id)
  })
  return { body, idempotencyKey: `${OPEN_CHAT_CHANNEL_IDENTITY.idempotencyPrefix}:${sha256(fingerprint)}` }
}

const isStringArrayIncluding = (value: unknown, required: readonly string[]): boolean =>
  Array.isArray(value) && required.every((item) => value.includes(item))

/** 只接受足以运行当前 OmniMindWeChat 适配器的明确能力，避免旧服务被误判为“连接成功”。 */
const isCompatibleAuthData = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  const capabilities = data.capabilities && typeof data.capabilities === 'object' && !Array.isArray(data.capabilities)
    ? data.capabilities as Record<string, unknown>
    : undefined
  const limits = data.limits && typeof data.limits === 'object' && !Array.isArray(data.limits)
    ? data.limits as Record<string, unknown>
    : undefined
  return data.authenticated === true
    && data.contract_version === OPEN_CHAT_CONTRACT_VERSION
    && Boolean(capabilities)
    && isStringArrayIncluding(capabilities?.response_modes, ['sync'])
    && isStringArrayIncluding(capabilities?.content_types, ['text'])
    && isStringArrayIncluding(capabilities?.conversation_types, ['direct', 'group', 'other'])
    && capabilities?.idempotent_replay === true
    && Boolean(limits)
    // 这些下限必须覆盖客户端真实会发送的批次，而不只是“大于零”；否则连接测试通过后，
    // 高频 50 条批次或 8 段长文本仍会在运行期被服务端拒绝。
    && Number(limits?.max_actors) >= MAX_ACTORS
    && Number(limits?.max_messages) >= MAX_MESSAGES
    && Number(limits?.max_content_parts_per_message) >= MAX_CONTENT_PARTS
    && Number(limits?.max_text_chars_per_part) >= MAX_TEXT_CHARS_PER_PART
    && Number(limits?.max_extensions_bytes) >= MIN_EXTENSIONS_BYTES
    && Number(limits?.max_extension_depth) >= MIN_EXTENSION_DEPTH
    && Number(limits?.idempotency_key_max_length) >= MIN_IDEMPOTENCY_KEY_LENGTH
}

export class OmniMindPythonClient {
  private readonly fetchImpl: typeof fetch
  private readonly authCheckTimeoutMs: number
  private readonly chatTransportGuardMs: number

  constructor(dependencies: PythonClientDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? fetch
    this.authCheckTimeoutMs = dependencies.authCheckTimeoutMs ?? AUTH_CHECK_TIMEOUT_MS
    this.chatTransportGuardMs = dependencies.chatTransportGuardMs ?? CHAT_TRANSPORT_GUARD_MS
  }

  async check(baseUrl: string, apiKey: string): Promise<{ success: boolean; kind?: string }> {
    const result = await this.request(`${baseUrl.replace(/\/$/, '')}/auth/check`, { method: 'GET', headers: this.headers(apiKey) }, this.authCheckTimeoutMs)
    if (!result.ok) return { success: false, kind: result.kind }
    const contentType = result.response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json')) return { success: false, kind: 'incompatible' }
    try {
      const payload = await result.response.json() as Record<string, unknown>
      return payload.code === 200
        && typeof payload.message === 'string'
        && Number.isFinite(payload.timestamp)
        && typeof payload.trace_id === 'string'
        && payload.trace_id.length > 0
        && isCompatibleAuthData(payload.data)
        ? { success: true }
        : { success: false, kind: 'incompatible' }
    } catch { return { success: false, kind: 'incompatible' } }
  }

  async chat(input: ChatInput): Promise<GenerationResult> {
    // 旧扁平调用方必须显式失败，不能因读取 undefined 抛异常，也不能偷偷恢复兼容适配层。
    if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > MAX_MESSAGES) return { kind: 'malformed' }
    if (input.messages.some((message) => !message.text || Array.from(message.text).length > MAX_TEXT_CHARS_PER_PART * MAX_CONTENT_PARTS)) return { kind: 'malformed' }
    const { body, idempotencyKey } = buildOpenChatRequest(input)
    const response = await this.request(`${input.baseUrl.replace(/\/$/, '')}/chat`, {
      method: 'POST',
      headers: this.headers(input.apiKey, idempotencyKey, input.clientRequestId),
      body: JSON.stringify(body)
    }, this.chatTransportGuardMs)
    if (!response.ok) return { kind: response.kind, ...(response.error ? { error: response.error } : {}) }
    let payload: unknown
    try { payload = JSON.parse(await response.response.text()) } catch { return { kind: 'malformed' } }
    if (!payload || typeof payload !== 'object') return { kind: 'malformed' }
    const record = payload as Record<string, unknown>
    if (record.code !== response.response.status) return { kind: 'malformed' }
    const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? record.data as Record<string, unknown>
      : undefined
    if (!data || typeof data.operation_id !== 'string' || !data.operation_id) return { kind: 'malformed' }
    const status = typeof data.status === 'string' ? data.status.toLowerCase() : ''
    // 202 是服务端已接受且仍在处理的权威状态，不是损坏响应。队列若由用户显式对账，
    // 会使用完全相同的消息事实重新派生同一个 Idempotency-Key，而不会创建第二次模型操作。
    if (response.response.status === 202 && status === 'processing') return { kind: 'processing' }
    const handoff = data.handoff && typeof data.handoff === 'object' && !Array.isArray(data.handoff)
      ? data.handoff as Record<string, unknown>
      : undefined
    // Open Chat 将“建议坐席关注”和“必须停止自动发送”拆成两个维度：
    // - recommended + required=false：高意向提醒，AI 仍继续服务并发送本轮回复；
    // - required=true 或 taken_over：质量/安全边界或真人已接管，必须 fail closed。
    // 这里同时严格校验字段类型和状态枚举，避免损坏响应被误当成可发送文本。
    const handoffRequired = handoff?.required
    const handoffStatus = typeof handoff?.status === 'string'
      ? handoff.status.toLowerCase()
      : ''
    if (
      typeof handoffRequired !== 'boolean'
      || !['none', 'recommended', 'taken_over'].includes(handoffStatus)
    ) return { kind: 'malformed' }
    if (handoffRequired || handoffStatus === 'taken_over') return { kind: 'handoff' }
    if (response.response.status !== 200 || status !== 'completed') return { kind: 'malformed' }
    const reply = data.reply && typeof data.reply === 'object' && !Array.isArray(data.reply)
      ? data.reply as Record<string, unknown>
      : undefined
    if (reply?.format !== 'text' || typeof reply.content !== 'string') return { kind: 'malformed' }
    const text = reply.content.trim()
    return text ? { kind: 'reply', text } : { kind: 'empty' }
  }

  // 开放通道使用独立 API Key，并只在 chat 上附加幂等/链路头，避免把 omni_* 误当 JWT。
  private headers(apiKey: string, idempotencyKey?: string, clientRequestId?: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'X-Omni-Api-Key': apiKey,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(clientRequestId?.trim() ? { 'X-Client-Request-Id': clientRequestId.trim() } : {})
    }
  }

  private async request(url: string, init: RequestInit, timeoutMs: number): Promise<{ ok: true; response: Response } | { ok: false; kind: Exclude<GenerationResult['kind'], 'reply'>; error?: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal })
      if (!response.ok) {
        const errorCode = await parseSafeOpenChatFailure(response)
        const kind = classifySafeOpenChatFailure(response.status, errorCode)
        // 只允许已验证的公开失败码进入队列；普通 HTTPException detail、服务端 message 与
        // 未知响应正文全部丢弃。通用状态只返回本地 kind，不附加可被显示/记录的正文。
        return { ok: false, kind, ...(errorCode ? { error: errorCode } : {}) }
      }
      return { ok: true, response }
    } catch {
      // 不返回 fetch 原始 Error/name/message；网络库错误可能包含 URL、Header 或代理上下文。
      return { ok: false, kind: controller.signal.aborted ? 'timeout' : 'network' }
    } finally { clearTimeout(timer) }
  }
}
