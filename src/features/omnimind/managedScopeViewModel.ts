import type { ChatSession, ContactInfo } from '../../types/models'

export interface ManagedContactRow {
  username: string
  displayName: string
  remark?: string
  alias?: string
  avatarUrl?: string
  type: ContactInfo['type']
  lastTimestamp?: number
  unavailable?: boolean
}

export const mergeManagedContacts = (contacts: ContactInfo[], sessions: ChatSession[], selected: Array<{ sessionId: string; displayName: string }>): ManagedContactRow[] => {
  const sessionById = new Map(sessions.map((session) => [session.username.toLocaleLowerCase(), session]))
  const rows: ManagedContactRow[] = contacts.map((contact) => {
    const session = sessionById.get(contact.username.toLocaleLowerCase())
    return { username: contact.username, displayName: contact.displayName || session?.displayName || contact.username, remark: contact.remark, alias: contact.alias || session?.alias, avatarUrl: contact.avatarUrl || session?.avatarUrl, type: contact.type, lastTimestamp: session?.lastTimestamp }
  })
  const known = new Set(rows.map((row) => row.username.toLocaleLowerCase()))
  for (const conversation of selected) if (!known.has(conversation.sessionId.toLocaleLowerCase())) rows.push({ username: conversation.sessionId, displayName: conversation.displayName || conversation.sessionId, type: 'other', unavailable: true })
  return rows.sort((left, right) => (right.lastTimestamp ?? 0) - (left.lastTimestamp ?? 0) || left.displayName.localeCompare(right.displayName))
}

export const filterManagedContacts = (rows: ManagedContactRow[], query: string, type: 'all' | 'friend' | 'group' | 'official'): ManagedContactRow[] => {
  const needle = query.trim().toLocaleLowerCase()
  return rows.filter((row) => (type === 'all' || row.type === type) && (!needle || [row.displayName, row.remark, row.alias, row.username].some((value) => value?.toLocaleLowerCase().includes(needle))))
}
