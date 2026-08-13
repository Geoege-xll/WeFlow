import { useEffect, useMemo, useState } from 'react'
import type { ManagedScope } from '../../../shared/omnimind/contracts'
import type { ChatSession, ContactInfo } from '../../types/models'
import { filterManagedContacts, mergeManagedContacts } from './managedScopeViewModel'
import { omniMindZhCN } from './locale'

export function OmniMindManagedScopePicker({ value, ignoreOfficial, onChange }: { value: ManagedScope; ignoreOfficial: boolean; onChange: (value: ManagedScope) => void }) {
  const [contacts, setContacts] = useState<ContactInfo[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(true)
  const [showLoading, setShowLoading] = useState(false)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'friend' | 'group' | 'official'>('all')
  const [selectedDraft, setSelectedDraft] = useState(value.mode === 'selected' ? value.conversations : [])
  const [allConfirmed, setAllConfirmed] = useState(value.mode === 'all')
  const load = async (): Promise<void> => {
    setLoading(true); setShowLoading(false); setError(false)
    try {
      const [contactResult, sessionResult] = await Promise.all([window.electronAPI.chat.getContacts({ lite: true }), window.electronAPI.chat.getSessions()])
      if (!contactResult.success || !sessionResult.success) throw new Error('contacts_failed')
      setContacts(contactResult.contacts ?? []); setSessions(sessionResult.sessions ?? [])
    } catch { setError(true) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!loading) { setShowLoading(false); return }
    const timer = window.setTimeout(() => setShowLoading(true), 300)
    return () => window.clearTimeout(timer)
  }, [loading])
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query), 200); return () => window.clearTimeout(timer) }, [query])
  const rows = useMemo(() => mergeManagedContacts(contacts, sessions, selectedDraft), [contacts, sessions, selectedDraft])
  const visible = useMemo(() => filterManagedContacts(rows, debouncedQuery, filter), [rows, debouncedQuery, filter])
  const rendered = visible.slice(0, 40)
  const selectedOfficial = rows.filter((row) => row.type === 'official' && selectedDraft.some((item) => item.sessionId.toLocaleLowerCase() === row.username.toLocaleLowerCase()))
  const selected = new Set(selectedDraft.map((item) => item.sessionId.toLocaleLowerCase()))
  const updateSelected = (next: typeof selectedDraft): void => { setSelectedDraft(next); if (value.mode === 'selected') onChange({ mode: 'selected', conversations: next }) }
  const toggle = (username: string, displayName: string): void => {
    const identity = username.toLocaleLowerCase()
    updateSelected(selected.has(identity) ? selectedDraft.filter((item) => item.sessionId.toLocaleLowerCase() !== identity) : [...selectedDraft, { sessionId: username, displayName }])
  }
  const chooseMode = (mode: 'selected' | 'all'): void => {
    if (mode === 'selected') onChange({ mode: 'selected', conversations: selectedDraft })
    else { setAllConfirmed(false); onChange({ mode: 'all', confirmedAt: 0 }) }
  }
  const selectResults = (): void => {
    const selectable = visible.filter((row) => !row.unavailable && !(ignoreOfficial && row.type === 'official'))
    if (selectable.length > 20 && !window.confirm(`${omniMindZhCN.actions.selectResults} ${selectable.length}`)) return
    const next = [...selectedDraft]
    for (const row of selectable) if (!next.some((item) => item.sessionId.toLocaleLowerCase() === row.username.toLocaleLowerCase())) next.push({ sessionId: row.username, displayName: row.displayName })
    updateSelected(next)
  }
  const selectAllHostable = (): void => {
    const selectable = rows.filter((row) => !row.unavailable && !(ignoreOfficial && row.type === 'official'))
    if (!window.confirm(`${omniMindZhCN.actions.selectAll} ${selectable.length}`)) return
    updateSelected(selectable.map((row) => ({ sessionId: row.username, displayName: row.displayName })))
  }
  return <div className="omnimind-scope-picker">
    <div className="omnimind-mode-options">
      <label><input type="radio" checked={value.mode === 'selected'} onChange={() => chooseMode('selected')} />{omniMindZhCN.settings.selected}</label>
      <label><input type="radio" checked={value.mode === 'all'} onChange={() => chooseMode('all')} />{omniMindZhCN.settings.all}</label>
    </div>
    {value.mode === 'all' ? <div className="omnimind-risk-card"><p>{omniMindZhCN.settings.allRisk}</p><p>{error ? omniMindZhCN.settings.coverageUnknown : `${omniMindZhCN.settings.coverage} ${rows.filter((row) => !row.unavailable && !(ignoreOfficial && row.type === 'official')).length}`}</p>{error && <p role="alert">{omniMindZhCN.settings.contactsError}<button type="button" onClick={() => void load()}>{omniMindZhCN.actions.refresh}</button></p>}<label><input type="checkbox" checked={allConfirmed} onChange={(event) => { setAllConfirmed(event.target.checked); onChange({ mode: 'all', confirmedAt: event.target.checked ? Date.now() : 0 }) }} />{omniMindZhCN.settings.allConfirm}</label></div> : <>
      <input aria-label={omniMindZhCN.settings.search} placeholder={omniMindZhCN.settings.search} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="omnimind-scope-filters">{(['all', 'friend', 'group', 'official'] as const).map((kind) => <button key={kind} type="button" aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{kind === 'all' ? omniMindZhCN.settings.filterAll : kind === 'friend' ? omniMindZhCN.settings.filterFriend : kind === 'group' ? omniMindZhCN.settings.filterGroup : omniMindZhCN.settings.filterOfficial}</button>)}</div>
      <div className="omnimind-picker-summary"><span>{omniMindZhCN.settings.selectedCount} {selectedDraft.length}</span><button type="button" onClick={selectResults}>{omniMindZhCN.actions.selectResults} {visible.length}</button><button type="button" onClick={selectAllHostable}>{omniMindZhCN.actions.selectAll} {rows.length}</button><button type="button" onClick={() => updateSelected([])}>{omniMindZhCN.actions.clear}</button></div>
      {ignoreOfficial && selectedOfficial.length > 0 && <div role="alert" className="omnimind-warning"><p>{omniMindZhCN.settings.removeFilteredOfficial} {selectedOfficial.map((row) => row.displayName).join('、')}</p><button type="button" onClick={() => updateSelected(selectedDraft.filter((item) => !selectedOfficial.some((row) => row.username.toLocaleLowerCase() === item.sessionId.toLocaleLowerCase())))}>{omniMindZhCN.settings.confirmRemoveOfficial}</button></div>}
      {showLoading && <p aria-live="polite">{omniMindZhCN.settings.contactsLoading}</p>}
      {error && <p role="alert">{omniMindZhCN.settings.contactsError}<button type="button" onClick={() => void load()}>{omniMindZhCN.actions.refresh}</button></p>}
      {!loading && !error && visible.length === 0 && <p>{query ? omniMindZhCN.settings.noResults : omniMindZhCN.settings.contactsEmpty}</p>}
      {visible.length > rendered.length && <p aria-live="polite">{omniMindZhCN.settings.boundedResults}</p>}
      <div className="omnimind-contact-list">{rendered.map((row) => {
        const disabled = ignoreOfficial && row.type === 'official'
        return <label key={row.username} className={disabled ? 'is-disabled' : undefined}>{row.avatarUrl && <img src={row.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}<input type="checkbox" checked={selected.has(row.username.toLocaleLowerCase())} disabled={disabled} onChange={() => toggle(row.username, row.displayName)} /><span><strong>{row.displayName}</strong><small><span>{row.unavailable ? omniMindZhCN.settings.unavailable : disabled ? omniMindZhCN.settings.officialFiltered : row.remark || row.alias || row.username}</span> · {omniMindZhCN.settings.contactTypes[row.type]} · {row.lastTimestamp ? `${omniMindZhCN.settings.recentSession} ${new Date(row.lastTimestamp * 1000).toLocaleDateString(omniMindZhCN.locale)}` : omniMindZhCN.settings.noRecentSession}</small></span></label>
      })}</div>
    </>}
  </div>
}
