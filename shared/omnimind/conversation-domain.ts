/**
 * 自动托管只使用规范化后的 sessionId 作为身份，不使用展示名做授权判断。
 * 这里集中大小写无关的身份、会话分类和托管范围解析，避免联系人选择器与
 * 主进程消息入口分别猜测“群聊/官方账号”而逐渐产生不同规则。
 */
export const OMNIMIND_CONVERSATION_KINDS = ['private', 'group', 'official', 'other'] as const
export type OmniMindConversationKind = typeof OMNIMIND_CONVERSATION_KINDS[number]

export interface ManagedConversation {
  sessionId: string
  displayName: string
}

export type ManagedScope =
  | { mode: 'selected'; conversations: ManagedConversation[] }
  | { mode: 'all'; confirmedAt: number }

type ConversationTypeHint = OmniMindConversationKind | 'friend' | 'former_friend' | 'blocked' | number | undefined

const strictRecord = (value: unknown, allowedKeys: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} payload`)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) throw new Error(`Invalid ${label} payload`)
  return record
}

/** 规范化用于持久化和运行时比较的 sessionId；空白身份永远不能进入托管合同。 */
export const normalizeManagedSessionId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid managed conversation payload')
  return value.trim()
}

/**
 * identityKey 仅用于去重与匹配。保留原 sessionId 大小写用于调用现有 WCDB/聊天接口，
 * 但授权比较统一使用 locale-insensitive 的小写键。
 */
export const managedSessionIdentity = (value: unknown): string => normalizeManagedSessionId(value).toLocaleLowerCase()

/**
 * 联系人元数据优先；当只有最近会话时，微信稳定 ID 规则仍可识别群聊和官方账号，
 * 其余普通、非占位 sessionId 按私聊处理，从而使 sessions-only 私聊可以托管。
 */
export const classifyOmniMindConversation = (sessionIdValue: unknown, typeHint?: ConversationTypeHint): OmniMindConversationKind => {
  let sessionId: string
  try { sessionId = managedSessionIdentity(sessionIdValue) } catch { return 'other' }

  if (sessionId.includes('placeholder_foldgroup')) return 'other'
  if (typeHint === 'group' || sessionId.endsWith('@chatroom')) return 'group'
  if (typeHint === 'official' || sessionId.startsWith('gh_')) return 'official'
  if (typeHint === 'other' || typeHint === 'former_friend' || typeHint === 'blocked') return 'other'
  if (typeHint === 'friend' || typeHint === 'private') return 'private'

  // ChatSession.type 是 WCDB 数值，跨版本没有稳定、受控的联系人语义；只把 ID 规则作为真值。
  // 对未命中系统占位、群聊和官方账号规则的真实最近会话，按 sessions-only 私聊开放选择。
  return 'private'
}

/**
 * 自动托管只对私聊和群聊开放。官方账号不再是一项用户设置，而是跨候选、保存、
 * 消息接入与发送授权共享的永久安全边界；“其他”会话同样没有明确回复目标语义。
 */
export const isHostableConversationKind = (kind: OmniMindConversationKind): boolean =>
  kind === 'private' || kind === 'group'

export const parseManagedScope = (value: unknown, options: { allowEmptySelected?: boolean } = {}): ManagedScope => {
  const record = strictRecord(value, ['mode', 'conversations', 'confirmedAt'], 'managed scope')
  if (record.mode === 'all') {
    if (record.conversations !== undefined || typeof record.confirmedAt !== 'number' || !Number.isFinite(record.confirmedAt) || record.confirmedAt <= 0) throw new Error('Invalid managed scope payload')
    return { mode: 'all', confirmedAt: record.confirmedAt }
  }
  if (record.mode !== 'selected' || record.confirmedAt !== undefined || !Array.isArray(record.conversations) || (!options.allowEmptySelected && record.conversations.length === 0)) throw new Error('Invalid managed scope payload')

  const conversations: ManagedConversation[] = []
  const seen = new Set<string>()
  for (const item of record.conversations) {
    const conversation = strictRecord(item, ['sessionId', 'displayName'], 'managed conversation')
    const sessionId = normalizeManagedSessionId(conversation.sessionId)
    const identity = managedSessionIdentity(sessionId)
    if (seen.has(identity)) continue
    seen.add(identity)
    conversations.push({
      sessionId,
      displayName: typeof conversation.displayName === 'string' ? conversation.displayName.trim() : ''
    })
  }
  return { mode: 'selected', conversations }
}

export const isManagedSession = (scope: ManagedScope, sessionId: string): boolean => {
  let identity: string
  try { identity = managedSessionIdentity(sessionId) } catch { return false }
  return scope.mode === 'all' || scope.conversations.some((conversation) => managedSessionIdentity(conversation.sessionId) === identity)
}

/**
 * 设置 diff 关心授权集合而非展示顺序、名称快照或 all 模式的确认时间。
 * 这避免联系人重命名或列表排序变化把正在运行的托管误判为关键策略变更。
 */
export const areManagedScopesEquivalent = (left: ManagedScope, right: ManagedScope): boolean => {
  if (left.mode !== right.mode) return false
  // confirmedAt 的具体时间不是策略差异，但“尚未确认”(0) 与有效 all 授权并不等价。
  if (left.mode === 'all' && right.mode === 'all') return left.confirmedAt > 0 && right.confirmedAt > 0
  if (left.mode !== 'selected' || right.mode !== 'selected' || left.conversations.length !== right.conversations.length) return false
  const rightIds = new Set(right.conversations.map((item) => managedSessionIdentity(item.sessionId)))
  return left.conversations.every((item) => rightIds.has(managedSessionIdentity(item.sessionId)))
}
