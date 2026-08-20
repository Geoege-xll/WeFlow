import { useEffect, useMemo, useRef, useState } from 'react'
import type { ManagedScope } from '../../../shared/omnimind/contracts'
import { isHostableConversationKind, managedSessionIdentity } from '../../../shared/omnimind/conversation-domain'
import type { ChatSession, ContactInfo } from '../../types/models'
import { filterManagedContacts, ManagedConversationCatalog } from './managedScopeViewModel'
import { omniMindZhCN } from './locale'

export function OmniMindManagedScopePicker({
  value,
  onOfficialSelectionChange,
  onChange
}: {
  value: ManagedScope
  onOfficialSelectionChange?: (sessionIds: ReadonlySet<string>) => void
  onChange: (value: ManagedScope) => void
}) {
  const [contacts, setContacts] = useState<ContactInfo[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(true)
  const [showLoading, setShowLoading] = useState(false)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'private' | 'group' | 'official' | 'selected'>('all')
  const [selectedDraft, setSelectedDraft] = useState(value.mode === 'selected' ? value.conversations : [])
  const [allConfirmed, setAllConfirmed] = useState(value.mode === 'all')
  const masterCheckboxRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    setLoading(true); setShowLoading(false); setError(false)
    try {
      const [contactResult, sessionResult] = await Promise.all([
        window.electronAPI.chat.getContacts({ lite: true }),
        window.electronAPI.chat.getSessions()
      ])
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
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  const catalog = useMemo(() => ManagedConversationCatalog.create(contacts, sessions, selectedDraft), [contacts, sessions, selectedDraft])
  const rows = catalog.rows
  const selected = useMemo(() => new Set(selectedDraft.map((item) => managedSessionIdentity(item.sessionId))), [selectedDraft])

  useEffect(() => { onOfficialSelectionChange?.(catalog.officialSessionIds) }, [catalog, onOfficialSelectionChange])

  const visible = useMemo(() => {
    if (filter === 'selected') {
      const needle = debouncedQuery.trim().toLocaleLowerCase()
      return rows.filter((row) => selected.has(managedSessionIdentity(row.sessionId)) && (!needle || [row.displayName, row.remark, row.alias, row.sessionId].some((v) => v?.toLocaleLowerCase().includes(needle))))
    }
    return filterManagedContacts(rows, debouncedQuery, filter)
  }, [rows, debouncedQuery, filter, selected])

  const hostableRows = useMemo(() => catalog.hostable(), [catalog])
  const hostableVisible = useMemo(() => visible.filter((row) => !row.unavailable && isHostableConversationKind(row.kind)), [visible])
  const selectedInCurrentView = useMemo(() => hostableVisible.filter((row) => selected.has(managedSessionIdentity(row.sessionId))), [hostableVisible, selected])

  const isAllInCurrentViewSelected = hostableVisible.length > 0 && selectedInCurrentView.length === hostableVisible.length
  const isSomeInCurrentViewSelected = selectedInCurrentView.length > 0 && !isAllInCurrentViewSelected

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isSomeInCurrentViewSelected
    }
  }, [isSomeInCurrentViewSelected])

  const rendered = visible.slice(0, 40)
  const selectedOfficial = rows.filter((row) => row.kind === 'official' && selected.has(managedSessionIdentity(row.sessionId)))

  const updateSelected = (next: typeof selectedDraft): void => {
    setSelectedDraft(next)
    if (value.mode === 'selected') onChange({ mode: 'selected', conversations: next })
  }

  const toggle = (sessionId: string, displayName: string, unavailable: boolean): void => {
    const identity = managedSessionIdentity(sessionId)
    if (!selected.has(identity) && unavailable) return
    updateSelected(selected.has(identity) ? selectedDraft.filter((item) => managedSessionIdentity(item.sessionId) !== identity) : [...selectedDraft, { sessionId, displayName }])
  }

  const chooseMode = (mode: 'selected' | 'all'): void => {
    if (mode === 'selected') onChange({ mode: 'selected', conversations: selectedDraft })
    else { setAllConfirmed(false); onChange({ mode: 'all', confirmedAt: 0 }) }
  }

  const toggleSelectAllInCurrentView = (): void => {
    if (isAllInCurrentViewSelected) {
      const currentIds = new Set(hostableVisible.map((row) => managedSessionIdentity(row.sessionId)))
      updateSelected(selectedDraft.filter((item) => !currentIds.has(managedSessionIdentity(item.sessionId))))
    } else {
      const next = [...selectedDraft]
      for (const row of hostableVisible) {
        if (!next.some((item) => managedSessionIdentity(item.sessionId) === managedSessionIdentity(row.sessionId))) {
          next.push({ sessionId: row.sessionId, displayName: row.displayName })
        }
      }
      updateSelected(next)
    }
  }

  const deselectCurrentView = (): void => {
    const currentIds = new Set(hostableVisible.map((row) => managedSessionIdentity(row.sessionId)))
    updateSelected(selectedDraft.filter((item) => !currentIds.has(managedSessionIdentity(item.sessionId))))
  }

  const selectAllHostable = (): void => {
    updateSelected(hostableRows.map((row) => ({ sessionId: row.sessionId, displayName: row.displayName })))
  }

  return (
    <div className="omnimind-scope-picker">
      <div className="scope-mode-tabs" role="tablist" aria-label="托管模式选择">
        <button
          id="scope-mode-full"
          type="button"
          role="tab"
          aria-selected={value.mode === 'all'}
          className={`scope-tab-btn ${value.mode === 'all' ? 'active' : ''}`}
          onClick={() => chooseMode('all')}
        >
          <span className="scope-tab-title">🌐 全量托管 (所有联系人与群聊)</span>
          <label style={{ display: 'none' }}>
            <input
              type="radio"
              checked={value.mode === 'all'}
              onChange={() => chooseMode('all')}
              aria-label={omniMindZhCN.settings.all}
            />
            {omniMindZhCN.settings.all}
          </label>
        </button>

        <button
          id="scope-mode-custom"
          type="button"
          role="tab"
          aria-selected={value.mode === 'selected'}
          className={`scope-tab-btn ${value.mode === 'selected' ? 'active' : ''}`}
          onClick={() => chooseMode('selected')}
        >
          <span className="scope-tab-title">🎯 精选白名单托管</span>
          <span id="scope-selected-count-badge" className="scope-tab-badge">
            已选 {selectedDraft.length} 个
          </span>
          <label style={{ display: 'none' }}>
            <input
              type="radio"
              checked={value.mode === 'selected'}
              onChange={() => chooseMode('selected')}
              aria-label={omniMindZhCN.settings.selected}
            />
            {omniMindZhCN.settings.selected}
          </label>
        </button>
      </div>

      <div className="scope-notice-banner">
        <span className="scope-notice-text">
          💡 <strong>{omniMindZhCN.settings.scopeNoticeTitle}</strong>：{omniMindZhCN.settings.scopeNoticeOfficialExcluded}
        </span>
      </div>

      {value.mode === 'all' ? (
        <div className="omnimind-risk-card">
          <p>{omniMindZhCN.settings.allRisk}</p>
          <p>{error ? omniMindZhCN.settings.coverageUnknown : `${omniMindZhCN.settings.coverage} ${hostableRows.length}`}</p>
          {error && (
            <p role="alert">
              {omniMindZhCN.settings.contactsError}
              <button type="button" onClick={() => void load()}>{omniMindZhCN.actions.refresh}</button>
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={allConfirmed}
              onChange={(event) => {
                setAllConfirmed(event.target.checked)
                onChange({ mode: 'all', confirmedAt: event.target.checked ? Date.now() : 0 })
              }}
            />
            {omniMindZhCN.settings.allConfirm}
          </label>
        </div>
      ) : (
        <div id="scope-whitelist-container" className="whitelist-section">
          <div className="whitelist-controls">
            <input
              id="scope-contact-search"
              className="scope-search-input"
              type="search"
              aria-label={omniMindZhCN.settings.search}
              placeholder="🔍 搜索联系人或群聊..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="scope-capsules" role="toolbar" aria-label="白名单快速筛选">
              <button
                id="scope-filter-all"
                type="button"
                className={`scope-capsule-btn ${filter === 'all' ? 'active' : ''}`}
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                {omniMindZhCN.settings.filterAll}
              </button>
              <button
                id="scope-filter-direct"
                type="button"
                className={`scope-capsule-btn ${filter === 'private' ? 'active' : ''}`}
                aria-pressed={filter === 'private'}
                onClick={() => setFilter('private')}
              >
                {omniMindZhCN.settings.filterFriend}
              </button>
              <button
                id="scope-filter-group"
                type="button"
                className={`scope-capsule-btn ${filter === 'group' ? 'active' : ''}`}
                aria-pressed={filter === 'group'}
                onClick={() => setFilter('group')}
              >
                {omniMindZhCN.settings.filterGroup}
              </button>
              <button
                id="scope-filter-selected"
                type="button"
                className={`scope-capsule-btn ${filter === 'selected' ? 'active' : ''}`}
                aria-pressed={filter === 'selected'}
                onClick={() => setFilter('selected')}
              >
                已选中 (<span id="scope-capsule-count">{selectedDraft.length}</span>)
              </button>
            </div>
          </div>

          <div className="omnimind-picker-summary">
            <div className="summary-left">
              <label className="scope-master-checkbox-label">
                <input
                  ref={masterCheckboxRef}
                  type="checkbox"
                  className="scope-checkbox"
                  checked={isAllInCurrentViewSelected}
                  onChange={toggleSelectAllInCurrentView}
                  aria-label={isAllInCurrentViewSelected ? '取消全选当前列表' : '全选当前列表'}
                />
                <span className="master-checkbox-text">
                  {isAllInCurrentViewSelected ? '取消全选当前' : '全选当前'} ({hostableVisible.length})
                </span>
              </label>
              <span className="summary-divider">·</span>
              <span className="summary-count">
                已选 <strong>{selectedDraft.length}</strong> / {hostableRows.length} 项
              </span>
            </div>
            <div className="summary-actions">
              {isAllInCurrentViewSelected ? (
                <button type="button" className="btn-summary-action btn-danger-text" onClick={deselectCurrentView}>
                  {hostableVisible.length < hostableRows.length ? `取消全选当前 (${hostableVisible.length})` : '取消全选'}
                </button>
              ) : hostableVisible.length < hostableRows.length ? (
                <>
                  <button type="button" className="btn-summary-action btn-highlight" onClick={toggleSelectAllInCurrentView}>
                    全选当前 ({hostableVisible.length})
                  </button>
                  <button type="button" className="btn-summary-action" aria-label="全选全部可托管联系人" onClick={selectAllHostable}>
                    全选全部 ({hostableRows.length})
                  </button>
                </>
              ) : (
                <button type="button" className="btn-summary-action btn-highlight" aria-label="全选全部可托管联系人" onClick={toggleSelectAllInCurrentView}>
                  全选全部可托管联系人 ({hostableRows.length})
                </button>
              )}
              {selectedDraft.length > 0 && (
                <button type="button" className="btn-summary-action btn-danger-text" onClick={() => updateSelected([])}>
                  清空已选 ({selectedDraft.length})
                </button>
              )}
            </div>
          </div>

          {selectedOfficial.length > 0 && (
            <div role="alert" className="omnimind-warning">
              <p>{omniMindZhCN.settings.removeFilteredOfficial} {selectedOfficial.map((row) => row.displayName).join('、')}</p>
              <button type="button" onClick={() => updateSelected(selectedDraft.filter((item) => !selectedOfficial.some((row) => managedSessionIdentity(row.sessionId) === managedSessionIdentity(item.sessionId))))}>{omniMindZhCN.settings.confirmRemoveOfficial}</button>
            </div>
          )}

          {showLoading && <p aria-live="polite">{omniMindZhCN.settings.contactsLoading}</p>}
          {error && (
            <p role="alert">
              {omniMindZhCN.settings.contactsError}
              <button type="button" onClick={() => void load()}>{omniMindZhCN.actions.refresh}</button>
            </p>
          )}
          {!loading && !error && visible.length === 0 && (
            <p>{query ? omniMindZhCN.settings.noResults : omniMindZhCN.settings.contactsEmpty}</p>
          )}

          <div id="scope-contact-list" className="omnimind-contact-list scope-contact-list" role="group" aria-label="白名单联系人与群聊列表">
            {rendered.map((row) => {
              const isChecked = selected.has(managedSessionIdentity(row.sessionId))
              const disabled = row.kind === 'official' || (Boolean(row.unavailable) && !isChecked)
              return (
                <label key={managedSessionIdentity(row.sessionId)} className={`scope-contact-item ${disabled ? 'is-disabled' : ''}`}>
                  <div className="scope-contact-info">
                    {row.avatarUrl ? (
                      <img src={row.avatarUrl} alt="" className="scope-contact-avatar" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className={`scope-contact-avatar ${row.kind === 'private' ? 'jade' : ''}`}>
                        {row.displayName.slice(0, 1)}
                      </span>
                    )}
                    <div className="scope-contact-text">
                      <span className="scope-contact-name">{row.displayName}</span>
                      <span className="scope-contact-meta">
                        <span>
                          {row.unavailable
                            ? omniMindZhCN.settings.unavailable
                            : disabled
                            ? omniMindZhCN.settings.officialFiltered
                            : row.remark || row.alias || row.sessionId}
                        </span>{' '}
                        · {omniMindZhCN.settings.contactTypes[row.kind]}
                        {row.lastTimestamp
                          ? ` · ${omniMindZhCN.settings.recentSession} ${new Date(row.lastTimestamp * 1000).toLocaleDateString(omniMindZhCN.locale)}`
                          : ''}
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="scope-checkbox"
                    checked={isChecked}
                    disabled={disabled}
                    onChange={() => toggle(row.sessionId, row.displayName, Boolean(row.unavailable))}
                    aria-label={`托管 ${row.displayName}`}
                  />
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
