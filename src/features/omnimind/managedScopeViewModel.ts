import {
  classifyOmniMindConversation,
  isHostableConversationKind,
  managedSessionIdentity,
  normalizeManagedSessionId,
  type ManagedConversation,
  type OmniMindConversationKind
} from '../../../shared/omnimind/conversation-domain'
import type { ChatSession, ContactInfo } from '../../types/models'

export interface ManagedContactRow {
  sessionId: string
  displayName: string
  remark?: string
  alias?: string
  avatarUrl?: string
  kind: OmniMindConversationKind
  lastTimestamp?: number
  unavailable?: boolean
  source: 'contact' | 'session' | 'saved'
}

/**
 * Renderer 统一候选目录：联系人提供更可信的名称、类型和头像，最近会话补齐 contacts
 * 表尚未收录的真实会话；最后再补回已保存但当前无法解析的授权项。
 */
export class ManagedConversationCatalog {
  readonly rows: ManagedContactRow[]
  readonly officialSessionIds: ReadonlySet<string>

  private constructor(rows: ManagedContactRow[]) {
    this.rows = rows
    this.officialSessionIds = new Set(rows.filter((row) => row.kind === 'official').map((row) => managedSessionIdentity(row.sessionId)))
  }

  static create(contacts: ContactInfo[], sessions: ChatSession[], selected: ManagedConversation[]): ManagedConversationCatalog {
    const contactById = new Map<string, ContactInfo>()
    const sessionById = new Map<string, ChatSession>()
    for (const contact of contacts) {
      try {
        const identity = managedSessionIdentity(contact.username)
        if (!contactById.has(identity)) contactById.set(identity, contact)
      } catch { /* 空白或损坏联系人不能进入自动托管候选。 */ }
    }
    for (const session of sessions) {
      try {
        const identity = managedSessionIdentity(session.username)
        if (!sessionById.has(identity)) sessionById.set(identity, session)
      } catch { /* 空白或损坏最近会话不能进入自动托管候选。 */ }
    }

    const rows: ManagedContactRow[] = []
    const identities = new Set([...contactById.keys(), ...sessionById.keys()])
    for (const identity of identities) {
      const contact = contactById.get(identity)
      const session = sessionById.get(identity)
      const sessionId = normalizeManagedSessionId(contact?.username || session?.username)
      const kind = classifyOmniMindConversation(sessionId, contact?.type)
      rows.push({
        sessionId,
        // 联系人资料优先；仅缺失字段由最近会话补齐，展示名最后回退稳定 ID。
        displayName: contact?.displayName || session?.displayName || sessionId,
        remark: contact?.remark,
        alias: contact?.alias || session?.alias,
        avatarUrl: contact?.avatarUrl || session?.avatarUrl,
        kind,
        lastTimestamp: session?.lastTimestamp,
        unavailable: kind === 'other',
        source: contact ? 'contact' : 'session'
      })
    }

    const known = new Set(rows.map((row) => managedSessionIdentity(row.sessionId)))
    for (const conversation of selected) {
      let identity: string
      try { identity = managedSessionIdentity(conversation.sessionId) } catch { continue }
      if (known.has(identity)) continue
      known.add(identity)
      const sessionId = normalizeManagedSessionId(conversation.sessionId)
      rows.push({
        sessionId,
        displayName: conversation.displayName || sessionId,
        kind: classifyOmniMindConversation(sessionId),
        // 已保存但当前未出现在联系人或会话数据中的项必须保留，且只能取消、不能重新授权。
        unavailable: true,
        source: 'saved'
      })
    }

    rows.sort((left, right) => {
      const leftHostable = !left.unavailable && isHostableConversationKind(left.kind)
      const rightHostable = !right.unavailable && isHostableConversationKind(right.kind)
      if (leftHostable !== rightHostable) return leftHostable ? -1 : 1
      return (right.lastTimestamp ?? 0) - (left.lastTimestamp ?? 0) || left.displayName.localeCompare(right.displayName)
    })
    return new ManagedConversationCatalog(rows)
  }

  hostable(): ManagedContactRow[] {
    return this.rows.filter((row) => !row.unavailable && isHostableConversationKind(row.kind))
  }
}

/** 保留纯函数入口，组件和单元测试不需要依赖 Catalog 的内部索引实现。 */
export const mergeManagedContacts = (contacts: ContactInfo[], sessions: ChatSession[], selected: ManagedConversation[]): ManagedContactRow[] =>
  ManagedConversationCatalog.create(contacts, sessions, selected).rows

export const filterManagedContacts = (rows: ManagedContactRow[], query: string, kind: 'all' | OmniMindConversationKind): ManagedContactRow[] => {
  const needle = query.trim().toLocaleLowerCase()
  return rows.filter((row) => (kind === 'all' || row.kind === kind) && (!needle || [row.displayName, row.remark, row.alias, row.sessionId].some((value) => value?.toLocaleLowerCase().includes(needle))))
}
