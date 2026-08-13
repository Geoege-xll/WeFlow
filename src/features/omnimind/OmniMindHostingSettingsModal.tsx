import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isCriticalSettingsChange, normalizeOmniMindBaseUrl, type OmniMindSettings, type OmniMindSettingsInput } from '../../../shared/omnimind/contracts'
import { OmniMindManagedScopePicker } from './OmniMindManagedScopePicker'
import { OmniMindPermissionCenter } from './OmniMindPermissionCenter'
import { omniMindZhCN } from './locale'
import { useOmniMindPermissions, type OmniMindPermissionsModel } from './useOmniMindPermissions'
import type { OmniMindPermissionKind } from '../../../shared/omnimind/contracts'

type Tab = keyof typeof omniMindZhCN.settings.tabs

export function OmniMindHostingSettingsModal({ settings, running, onSave, onClose, onSaved, initialTab, initialPermissionKind, jitPermissionKind, permissionModel }: { settings: OmniMindSettings; running: boolean; onSave: (input: OmniMindSettingsInput) => Promise<void>; onClose: () => void; onSaved?: (critical: boolean) => void; initialTab?: Tab; initialPermissionKind?: OmniMindPermissionKind; jitPermissionKind?: OmniMindPermissionKind; permissionModel?: OmniMindPermissionsModel }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (settings.migrationNotice ? 'scope' : 'connection'))
  const [jitKind, setJitKind] = useState(jitPermissionKind)
  const [endpoint, setEndpoint] = useState(settings.pythonBaseUrl)
  const [managedScope, setManagedScope] = useState(settings.managedScope)
  const [officialExclusionConfirmed, setOfficialExclusionConfirmed] = useState(settings.ignoreOfficial)
  const [autoSend, setAutoSend] = useState(settings.autoSend)
  const [ignoreOfficial, setIgnoreOfficial] = useState(settings.ignoreOfficial)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(settings.hasApiKey)
  const [keyStatus, setKeyStatus] = useState<string>()
  const [batchWindowSeconds, setBatchWindowSeconds] = useState(settings.batchWindowMs / 1000)
  const [requestTimeoutSeconds, setRequestTimeoutSeconds] = useState(settings.requestTimeoutMs / 1000)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; kind?: string; latencyMs?: number }>()
  const [error, setError] = useState<string>()
  const [endpointError, setEndpointError] = useState<string>()
  const [validationErrors, setValidationErrors] = useState<Array<{ id: string; message: string }>>([])
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const settingsDialogRef = useRef<HTMLElement>(null)
  const discardDialogRef = useRef<HTMLElement>(null)
  const discardContinueRef = useRef<HTMLButtonElement>(null)
  const discardTriggerRef = useRef<HTMLElement | null>(null)
  const endpointRef = useRef<HTMLInputElement>(null)
  const normalizedEndpoint = useMemo(() => { try { return normalizeOmniMindBaseUrl(endpoint) } catch { return endpoint } }, [endpoint])
  const batchWindowMs = batchWindowSeconds * 1000
  const requestTimeoutMs = requestTimeoutSeconds * 1000
  const draft = useMemo<OmniMindSettingsInput>(() => ({ schemaVersion: 2, pythonBaseUrl: normalizedEndpoint, managedScope, autoSend, ignoreOfficial, batchWindowMs, requestTimeoutMs, ...(apiKeyDraft ? { apiKeyDraft } : {}) }), [normalizedEndpoint, managedScope, autoSend, ignoreOfficial, batchWindowMs, requestTimeoutMs, apiKeyDraft])
  const dirty = normalizedEndpoint !== settings.pythonBaseUrl || JSON.stringify(managedScope) !== JSON.stringify(settings.managedScope) || autoSend !== settings.autoSend || ignoreOfficial !== settings.ignoreOfficial || Boolean(apiKeyDraft) || batchWindowMs !== settings.batchWindowMs || requestTimeoutMs !== settings.requestTimeoutMs
  const criticalDirty = isCriticalSettingsChange(settings, draft)
  const criticalChanges = [normalizedEndpoint !== settings.pythonBaseUrl && omniMindZhCN.settings.criticalChanges.endpoint, Boolean(apiKeyDraft) && omniMindZhCN.settings.criticalChanges.key, JSON.stringify(managedScope) !== JSON.stringify(settings.managedScope) && omniMindZhCN.settings.criticalChanges.scope, ignoreOfficial !== settings.ignoreOfficial && omniMindZhCN.settings.criticalChanges.official].filter(Boolean).join('、')
  useEffect(() => {
    if (!initialPermissionKind) document.getElementById(`omnimind-tab-${tab}`)?.focus()
  // The initial tab is intentionally captured once; later tab changes are user driven.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPermissionKind])
  useEffect(() => {
    const applicationRoot = document.getElementById('root')
    if (!applicationRoot) return
    const previousAriaHidden = applicationRoot.getAttribute('aria-hidden')
    const previousInert = applicationRoot.inert
    applicationRoot.setAttribute('aria-hidden', 'true')
    applicationRoot.inert = true
    return () => {
      if (previousAriaHidden === null) applicationRoot.removeAttribute('aria-hidden')
      else applicationRoot.setAttribute('aria-hidden', previousAriaHidden)
      applicationRoot.inert = previousInert
    }
  }, [])
  useEffect(() => { setTestResult(undefined) }, [endpoint, apiKeyDraft])
  useEffect(() => { if (discardConfirmationOpen) discardContinueRef.current?.focus() }, [discardConfirmationOpen])
  const restoreDiscardTrigger = (): void => {
    const trigger = discardTriggerRef.current
    window.queueMicrotask(() => trigger?.focus())
  }
  const continueEditing = (): void => {
    setDiscardConfirmationOpen(false)
    restoreDiscardTrigger()
  }
  const requestClose = (): void => {
    if (!dirty) { onClose(); return }
    discardTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : closeButtonRef.current
    setDiscardConfirmationOpen(true)
  }
  const discardChanges = (): void => {
    setDiscardConfirmationOpen(false)
    onClose()
  }
  const validateEndpoint = (): boolean => {
    try { normalizeOmniMindBaseUrl(endpoint); setEndpointError(undefined); return true } catch { setEndpointError(omniMindZhCN.settings.endpointInvalid); return false }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (discardConfirmationOpen) continueEditing()
        else requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = discardConfirmationOpen ? discardDialogRef.current : settingsDialogRef.current
      const focusable = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), a[href], [tabindex]:not([tabindex="-1"])')) : []
      if (!focusable.length) return
      const first = focusable[0]; const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener)
  })
  const save = async (): Promise<void> => {
    const errors: Array<{ id: string; message: string }> = []
    if (!validateEndpoint()) errors.push({ id: 'omnimind-endpoint', message: omniMindZhCN.settings.endpointInvalid })
    if (managedScope.mode === 'selected' && managedScope.conversations.length === 0) errors.push({ id: 'omnimind-tab-scope', message: omniMindZhCN.settings.migrationNotice })
    if (managedScope.mode === 'selected' && managedScope.conversations.length > 0 && ignoreOfficial && !settings.ignoreOfficial && !officialExclusionConfirmed) errors.push({ id: 'omnimind-tab-scope', message: omniMindZhCN.settings.confirmRemoveOfficial })
    if (managedScope.mode === 'all' && managedScope.confirmedAt <= 0) errors.push({ id: 'omnimind-tab-scope', message: omniMindZhCN.settings.allConfirm })
    if (!Number.isFinite(batchWindowMs) || batchWindowMs < 500 || batchWindowMs > 10000 || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 120000) errors.push({ id: 'omnimind-tab-timing', message: omniMindZhCN.settings.timingInvalid })
    setValidationErrors(errors)
    if (errors.length) { const first = errors[0]; setTab(first.id.includes('scope') ? 'scope' : first.id.includes('timing') ? 'timing' : 'connection'); if (first.id === 'omnimind-endpoint') endpointRef.current?.focus(); else window.setTimeout(() => document.getElementById(first.id)?.focus()); return }
    if (running && criticalDirty && !window.confirm(`${omniMindZhCN.settings.criticalWarning}\n${criticalChanges}`)) return
    setSaving(true); setError(undefined)
    try { await onSave({ ...draft, pythonBaseUrl: normalizeOmniMindBaseUrl(endpoint) }); onSaved?.(running && criticalDirty); onClose() } catch { setError(omniMindZhCN.settings.saveFailed) } finally { setSaving(false) }
  }
  const testConnection = async (): Promise<void> => {
    if (!validateEndpoint()) return
    setTesting(true); setTestResult(undefined)
    try { setTestResult(await window.electronAPI.omniMind.testConnection({ pythonBaseUrl: normalizeOmniMindBaseUrl(endpoint), ...(apiKeyDraft ? { apiKeyDraft } : {}) })) } catch { setTestResult({ success: false, kind: 'network' }) } finally { setTesting(false) }
  }
  const clearSavedKey = async (): Promise<void> => {
    if (!window.confirm(omniMindZhCN.settings.clearKeyConfirm)) return
    setSaving(true); setError(undefined)
    try { await window.electronAPI.omniMind.clearApiKey(); setHasApiKey(false); setApiKeyDraft(''); setKeyStatus(omniMindZhCN.settings.keyCleared) }
    catch { setError(omniMindZhCN.taskCommandFailed) } finally { setSaving(false) }
  }
  const onTabKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const tabs = Object.keys(omniMindZhCN.settings.tabs) as Tab[]
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + tabs.length) % tabs.length : -1
    if (next >= 0) { event.preventDefault(); setTab(tabs[next]); document.getElementById(`omnimind-tab-${tabs[next]}`)?.focus() }
  }
  return createPortal(<div className="omnimind-modal-backdrop" onMouseDown={(event) => { if (!discardConfirmationOpen && event.target === event.currentTarget) requestClose() }}>
    <section ref={settingsDialogRef} className="omnimind-settings-modal" role="dialog" aria-modal="true" aria-labelledby="omnimind-settings-title" aria-hidden={discardConfirmationOpen || undefined} inert={discardConfirmationOpen || undefined}>
      <header><div><h2 id="omnimind-settings-title">{omniMindZhCN.hosting.settings}</h2>{settings.migrationNotice && <p className="omnimind-warning">{omniMindZhCN.settings.migrationNotice}</p>}</div><button ref={closeButtonRef} type="button" aria-label={omniMindZhCN.actions.close} onClick={requestClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
      <div className="omnimind-settings-layout">
        <nav role="tablist" aria-orientation="vertical">{(Object.keys(omniMindZhCN.settings.tabs) as Tab[]).map((key, index) => <button id={`omnimind-tab-${key}`} key={key} role="tab" aria-controls={`omnimind-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={(event) => onTabKeyDown(event, index)}>{omniMindZhCN.settings.tabs[key]}</button>)}</nav>
        <div className="omnimind-settings-panels">
        <div id="omnimind-panel-connection" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-connection" hidden={tab !== 'connection'}>
          {tab === 'connection' && <div className="omnimind-form-section">
            <label htmlFor="omnimind-endpoint">{omniMindZhCN.settings.endpoint}</label><input id="omnimind-endpoint" ref={endpointRef} aria-invalid={Boolean(endpointError)} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} onBlur={validateEndpoint} /><small role={endpointError ? 'alert' : undefined}>{endpointError || omniMindZhCN.settings.endpointHelp}</small>
            <div className="omnimind-key-status">{hasApiKey ? omniMindZhCN.settings.keyConfigured : omniMindZhCN.settings.keyMissing}</div>
            <label htmlFor="omnimind-api-key">{omniMindZhCN.settings.apiKey}</label><div className="omnimind-inline-field"><input id="omnimind-api-key" type={showKey ? 'text' : 'password'} autoComplete="off" value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} /><button type="button" aria-pressed={showKey} onClick={() => setShowKey(!showKey)}>{showKey ? omniMindZhCN.settings.hideDraft : omniMindZhCN.settings.showDraft}</button></div><small>{omniMindZhCN.settings.apiKeyHelp}</small>
            {hasApiKey && <button className="omnimind-danger" type="button" onClick={() => void clearSavedKey()}>{omniMindZhCN.actions.clearKey}</button>}{keyStatus && <p role="status">{keyStatus}</p>}
            <button type="button" disabled={testing} aria-busy={testing} onClick={() => void testConnection()}>{testing ? omniMindZhCN.actions.testing : omniMindZhCN.actions.test}</button>
            {testResult && <p role={testResult.success ? 'status' : 'alert'}>{testResult.success ? `${omniMindZhCN.settings.connectionSuccess}${testResult.latencyMs === undefined ? '' : ` · ${testResult.latencyMs} ms`}` : omniMindZhCN.settings.connectionErrors[testResult.kind as keyof typeof omniMindZhCN.settings.connectionErrors] || omniMindZhCN.settings.connectionFailed}</p>}
          </div>}
        </div>
        <div id="omnimind-panel-scope" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-scope" hidden={tab !== 'scope'}>
          {tab === 'scope' && <OmniMindManagedScopePicker value={managedScope} ignoreOfficial={ignoreOfficial} onChange={(next) => { if (managedScope.mode === 'selected' && next.mode === 'selected' && next.conversations.length < managedScope.conversations.length) setOfficialExclusionConfirmed(true); setManagedScope(next) }} />}
        </div>
        <div id="omnimind-panel-strategy" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-strategy" hidden={tab !== 'strategy'}>
          {tab === 'strategy' && <div className="omnimind-form-section"><label><input role="switch" type="checkbox" checked={autoSend} onChange={(event) => setAutoSend(event.target.checked)} />{autoSend ? omniMindZhCN.settings.autoSend : omniMindZhCN.settings.manualReview}</label><label><input role="switch" type="checkbox" checked={ignoreOfficial} onChange={(event) => setIgnoreOfficial(event.target.checked)} />{omniMindZhCN.settings.ignoreOfficial}</label></div>}
        </div>
        <div id="omnimind-panel-timing" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-timing" hidden={tab !== 'timing'}>
          {tab === 'timing' && <div className="omnimind-form-section"><label htmlFor="omnimind-batch-window">{omniMindZhCN.settings.batchWindow}</label><input id="omnimind-batch-window" type="number" min={0.5} max={10} step={0.5} value={batchWindowSeconds} onChange={(event) => setBatchWindowSeconds(Number(event.target.value))} /><label htmlFor="omnimind-request-timeout">{omniMindZhCN.settings.requestTimeout}</label><input id="omnimind-request-timeout" type="number" min={1} max={120} step={1} value={requestTimeoutSeconds} onChange={(event) => setRequestTimeoutSeconds(Number(event.target.value))} /></div>}
        </div>
        <div id="omnimind-panel-permissions" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-permissions" hidden={tab !== 'permissions'}>
          {tab === 'permissions' && (permissionModel
            ? <OmniMindPermissionCenter model={permissionModel} focusKind={initialPermissionKind} jitKind={jitKind} onJitComplete={() => setJitKind(undefined)} />
            : <UncontrolledPermissionCenter focusKind={initialPermissionKind} jitKind={jitKind} onJitComplete={() => setJitKind(undefined)} />)}
        </div>
        </div>
      </div>
      {running && criticalDirty && <p className="omnimind-warning">{omniMindZhCN.settings.criticalWarning} {criticalChanges}</p>}{validationErrors.length > 0 && <div role="alert"><strong>{omniMindZhCN.settings.errorSummary}</strong><ul>{validationErrors.map((item) => <li key={`${item.id}-${item.message}`}><a href={`#${item.id}`} onClick={() => setTab(item.id.includes('scope') ? 'scope' : item.id.includes('timing') ? 'timing' : 'connection')}>{item.message}</a></li>)}</ul></div>}{error && <p role="alert">{error}</p>}
      {tab !== 'permissions' && <footer><button type="button" onClick={requestClose}>{omniMindZhCN.actions.cancel}</button><button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? omniMindZhCN.actions.saving : running && criticalDirty ? omniMindZhCN.actions.confirmCritical : omniMindZhCN.actions.save}</button></footer>}
    </section>
    {discardConfirmationOpen && <div className="omnimind-discard-backdrop">
      <section ref={discardDialogRef} className="omnimind-discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby="omnimind-discard-title" aria-describedby="omnimind-discard-description">
        <h2 id="omnimind-discard-title">{omniMindZhCN.settings.discardTitle}</h2>
        <p id="omnimind-discard-description">{omniMindZhCN.settings.discardConfirm}</p>
        <div className="omnimind-discard-actions">
          <button ref={discardContinueRef} type="button" onClick={continueEditing}>{omniMindZhCN.actions.continueEditing}</button>
          <button className="omnimind-danger" type="button" onClick={discardChanges}>{omniMindZhCN.actions.discardChanges}</button>
        </div>
      </section>
    </div>}
  </div>, document.body)
}

function UncontrolledPermissionCenter({ focusKind, jitKind, onJitComplete }: { focusKind?: OmniMindPermissionKind; jitKind?: OmniMindPermissionKind; onJitComplete: () => void }) {
  const model = useOmniMindPermissions()
  return <OmniMindPermissionCenter model={model} focusKind={focusKind} jitKind={jitKind} onJitComplete={onJitComplete} />
}
