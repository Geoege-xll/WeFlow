import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { normalizeOmniMindBaseUrl, type OmniMindSettings, type OmniMindSettingsInput } from '../../../shared/omnimind/contracts'
import {
  getOmniMindEndpointProtocol,
  OMNIMIND_SETTING_RANGES,
  OMNIMIND_SETTINGS_DEFAULTS,
  type OmniMindSettingsValidationCode
} from '../../../shared/omnimind/settings-domain'
import { OmniMindManagedScopePicker } from './OmniMindManagedScopePicker'
import { OmniMindPermissionCenter } from './OmniMindPermissionCenter'
import { OMNIMIND_SETTINGS_TABS, omniMindZhCN, type OmniMindSettingsTabId } from './locale'
import { useOmniMindPermissions, type OmniMindPermissionsModel } from './useOmniMindPermissions'
import { useOmniMindSettingsDraft } from './useOmniMindSettingsDraft'
import type { OmniMindPermissionKind } from '../../../shared/omnimind/contracts'

export type OmniMindSettingsTab = OmniMindSettingsTabId

export function OmniMindHostingSettingsModal({ settings, running, onSave, onClose, onSaved, initialTab, activeTab, embedded = false, onDirtyChange, initialPermissionKind, permissionModel }: { settings: OmniMindSettings; running: boolean; onSave: (input: OmniMindSettingsInput) => Promise<void>; onClose: () => void; onSaved?: (critical: boolean) => void; initialTab?: OmniMindSettingsTab; activeTab?: OmniMindSettingsTab; embedded?: boolean; onDirtyChange?: (dirty: boolean) => void; initialPermissionKind?: OmniMindPermissionKind; permissionModel?: OmniMindPermissionsModel }) {
  const settingsDraft = useOmniMindSettingsDraft(settings)
  const { draft, hasApiKey, differences, dirty, criticalDirty, validationIssues, revision, patch, buildSaveTransaction, markSaved, markKeyCleared, setKnownOfficialSessionIds } = settingsDraft
  const [tab, setTab] = useState<OmniMindSettingsTab>(activeTab ?? initialTab ?? (settings.migrationNotice ? 'scope' : 'connection'))
  const [showKey, setShowKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; kind?: string; latencyMs?: number; protocol?: 'HTTP' | 'HTTPS' }>()
  const [error, setError] = useState<string>()
  const [endpointError, setEndpointError] = useState<string>()
  const [validationErrors, setValidationErrors] = useState<Array<{ id: string; message: string }>>([])
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const settingsDialogRef = useRef<HTMLElement>(null)
  const discardDialogRef = useRef<HTMLElement>(null)
  const discardContinueRef = useRef<HTMLButtonElement>(null)
  const discardTriggerRef = useRef<HTMLElement | null>(null)
  const endpointRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const connectionTestGenerationRef = useRef(0)
  const { pythonBaseUrl: endpoint, managedScope, autoSend, apiKeyDraft, batchWindowMs } = draft
  const batchWindowSeconds = batchWindowMs / 1000
  const batchRange = OMNIMIND_SETTING_RANGES.batchWindowMs
  const defaultBatchWindowSeconds = OMNIMIND_SETTINGS_DEFAULTS.batchWindowMs / 1000
  /**
   * 连接测试结果只属于发起时的端点与 Key。输入发生变化时同步推进 generation，
   * 不能只依赖渲染后的 effect，否则一个已经 resolve 的旧 Promise 可能抢先回写成功状态。
   */
  const invalidateConnectionTest = (): void => {
    connectionTestGenerationRef.current += 1
    setTesting(false)
    setTestResult(undefined)
  }
  const setEndpoint = (value: string): void => { invalidateConnectionTest(); patch({ pythonBaseUrl: value }) }
  const setManagedScope = (value: typeof managedScope): void => patch({ managedScope: value })
  const setAutoSend = (value: boolean): void => patch({ autoSend: value })
  const setApiKeyDraft = (value: string): void => { invalidateConnectionTest(); patch({ apiKeyDraft: value }) }
  const setBatchWindowSeconds = (value: number): void => patch({ batchWindowMs: value * 1000 })
  const criticalChanges = [differences.pythonBaseUrl && omniMindZhCN.settings.criticalChanges.endpoint, differences.apiKey && omniMindZhCN.settings.criticalChanges.key, differences.managedScope && omniMindZhCN.settings.criticalChanges.scope].filter(Boolean).join('、')
  const clearKeyStatus = (): void => setKeyStatus(undefined)
  useEffect(() => {
    // React.StrictMode 会执行 setup → cleanup → setup；每次 setup 必须恢复 mounted，
    // 否则第二次真实挂载中的异步保存、测试连接和清 Key 都会被永久当成已卸载。
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      connectionTestGenerationRef.current += 1
    }
  }, [])
  useEffect(() => { if (activeTab) setTab(activeTab) }, [activeTab])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!embedded && !initialPermissionKind) document.getElementById(`omnimind-tab-${tab}`)?.focus()
  // 初始标签只在首次挂载时用于落焦；之后的标签切换由用户或统一控制中心显式驱动。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, initialPermissionKind])
  useEffect(() => {
    if (embedded) return
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
  }, [embedded])
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
    if (embedded) return
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
  // dirty 必须进入依赖：否则首次挂载时闭包会永久记住“无改动”，Esc 将绕过危险确认。
  }, [discardConfirmationOpen, dirty, embedded])
  const save = async (): Promise<void> => {
    const validationCopy: Record<OmniMindSettingsValidationCode, { id: string; message: string }> = {
      invalid_endpoint: { id: 'omnimind-endpoint', message: omniMindZhCN.settings.endpointInvalid },
      empty_scope: { id: 'omnimind-tab-scope', message: omniMindZhCN.settings.migrationNotice },
      unconfirmed_all_scope: { id: 'omnimind-tab-scope', message: omniMindZhCN.settings.allConfirm },
      official_scope_conflict: { id: 'omnimind-tab-scope', message: omniMindZhCN.settings.confirmRemoveOfficial },
      invalid_timing: { id: 'omnimind-tab-response', message: omniMindZhCN.settings.timingInvalid }
    }
    const errors = validationIssues.map((issue) => validationCopy[issue.code])
    validateEndpoint()
    setValidationErrors(errors)
    if (errors.length) { const first = errors[0]; setTab(first.id.includes('scope') ? 'scope' : first.id.includes('response') ? 'response' : 'connection'); if (first.id === 'omnimind-endpoint') endpointRef.current?.focus(); else window.setTimeout(() => document.getElementById(first.id)?.focus()); return }
    if (running && criticalDirty && !window.confirm(`${omniMindZhCN.settings.criticalWarning}\n${criticalChanges}`)) return
    setSaving(true); setError(undefined)
    try {
      const transaction = buildSaveTransaction()
      const savedKeyDraft = Boolean(transaction.input.apiKeyDraft)
      const saveWasCritical = running && criticalDirty
      await onSave(transaction.input)
      if (!mountedRef.current) return
      const completion = markSaved(transaction)
      // Key 是否清空与其他字段是否仍 dirty 分开处理：只要 Key 未在事务后重输，
      // 已提交明文就必须从 DOM 清除并关闭显示；其他后续编辑仍完整保留。
      if (!completion.retainedApiKeyDraft) {
        setShowKey(false)
        if (savedKeyDraft) setKeyStatus(omniMindZhCN.settings.keySaved)
      }
      // 首页宿主的 onSaved 会关闭弹窗，因此只有字段级合并后确实 clean 才能调用。
      if (completion.cleanAfterSave) onSaved?.(saveWasCritical)
    } catch { if (mountedRef.current) setError(omniMindZhCN.settings.saveFailed) } finally { if (mountedRef.current) setSaving(false) }
  }
  const testConnection = async (): Promise<void> => {
    if (!validateEndpoint()) return
    const generation = ++connectionTestGenerationRef.current
    const testedEndpoint = normalizeOmniMindBaseUrl(endpoint)
    const protocol = getOmniMindEndpointProtocol(testedEndpoint)
    setTesting(true); setTestResult(undefined)
    try {
      const result = await window.electronAPI.omniMind.testConnection({ pythonBaseUrl: testedEndpoint, ...(apiKeyDraft ? { apiKeyDraft } : {}) })
      if (mountedRef.current && generation === connectionTestGenerationRef.current) setTestResult({ ...result, protocol })
    } catch {
      if (mountedRef.current && generation === connectionTestGenerationRef.current) setTestResult({ success: false, kind: 'network' })
    } finally {
      if (mountedRef.current && generation === connectionTestGenerationRef.current) setTesting(false)
    }
  }
  const clearSavedKey = async (): Promise<void> => {
    if (!window.confirm(omniMindZhCN.settings.clearKeyConfirm)) return
    setSaving(true); setError(undefined)
    const clearRevision = revision
    try { await window.electronAPI.omniMind.clearApiKey(); if (mountedRef.current) { const clearedLatestRevision = markKeyCleared(clearRevision); invalidateConnectionTest(); if (clearedLatestRevision) { setShowKey(false); setKeyStatus(omniMindZhCN.settings.keyCleared) } } }
    catch { if (mountedRef.current) setError(omniMindZhCN.taskCommandFailed) } finally { if (mountedRef.current) setSaving(false) }
  }
  const onTabKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const tabs = OMNIMIND_SETTINGS_TABS.map(({ id }) => id)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + tabs.length) % tabs.length : -1
    if (next >= 0) { event.preventDefault(); setTab(tabs[next]); document.getElementById(`omnimind-tab-${tabs[next]}`)?.focus() }
  }
  const settingsShell = <>
    <section id={embedded ? undefined : 'hosting-settings-dialog'} ref={settingsDialogRef} className={`omnimind-settings-modal ${embedded ? 'is-embedded' : ''}`} role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby={embedded ? undefined : 'omnimind-settings-title'} aria-hidden={discardConfirmationOpen || undefined} inert={discardConfirmationOpen || undefined}>
      <header><div className="omnimind-settings-heading"><h2 id="omnimind-settings-title">{omniMindZhCN.hosting.settings}</h2><p>{omniMindZhCN.settings.subtitle}</p>{settings.migrationNotice && <p className="omnimind-warning">{omniMindZhCN.settings.migrationNotice}</p>}</div><button ref={closeButtonRef} type="button" className="app-dialog-close-btn omnimind-settings-close-btn" aria-label={omniMindZhCN.actions.close} onClick={requestClose}><X size={18} aria-hidden="true" /></button></header>
      <div className="omnimind-settings-layout">
        <nav role="tablist" aria-orientation="vertical">{OMNIMIND_SETTINGS_TABS.map(({ id, label }, index) => <button id={`omnimind-tab-${id}`} key={id} role="tab" aria-controls={`omnimind-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => onTabKeyDown(event, index)}>{label}</button>)}</nav>
        <div className="omnimind-settings-panels">
        <div id="omnimind-panel-connection" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-connection" hidden={tab !== 'connection'}>
          {tab === 'connection' && (
            <div className="omnimind-connection-container">
              <div className="endpoint-card">
                <div className="endpoint-card-head">
                  <div className="endpoint-head-info">
                    <div className="endpoint-title">🌐 服务连接与凭据 (Connection & Auth)</div>
                    <p className="endpoint-desc">配置用于 AI 意图推理与回复生成的 API 端点地址及访问凭据：</p>
                  </div>
                  <div className="endpoint-head-actions">
                    <div id="key-status" className={`key-status-badge ${hasApiKey ? 'is-configured' : ''}`} data-state={hasApiKey ? 'configured' : 'missing'}>
                      <span className="key-status-dot" aria-hidden="true" />
                      <strong>{hasApiKey ? omniMindZhCN.settings.keyConfigured : omniMindZhCN.settings.keyMissing}</strong>
                      <span className="key-status-help">({hasApiKey ? omniMindZhCN.settings.keyConfiguredHelp : omniMindZhCN.settings.keyMissingHelp})</span>
                    </div>
                    {hasApiKey && (
                      <button
                        id="clear-key"
                        className="btn danger-card clear-key-btn"
                        type="button"
                        disabled={saving}
                        onClick={() => void clearSavedKey()}
                      >
                        {omniMindZhCN.actions.clearKey}
                      </button>
                    )}
                  </div>
                </div>

                <div className="endpoint-fields">
                  {/* Field 1: Base URL */}
                  <div className="endpoint-field-group">
                    <label htmlFor="omnimind-endpoint">
                      {omniMindZhCN.settings.endpoint}
                    </label>
                    <div className="endpoint-input-row">
                      <input
                        id="omnimind-endpoint"
                        ref={endpointRef}
                        type="text"
                        className="endpoint-input"
                        aria-invalid={Boolean(endpointError)}
                        value={endpoint}
                        onChange={(event) => { setEndpoint(event.target.value); clearKeyStatus() }}
                        onBlur={validateEndpoint}
                      />
                      <button
                        id="test-connection-btn"
                        className="btn primary-card shrink-btn"
                        type="button"
                        disabled={testing}
                        aria-busy={testing}
                        onClick={() => void testConnection()}
                      >
                        {testing ? omniMindZhCN.actions.testing : '⚡ 测试连接'}
                      </button>
                    </div>
                    <small role={endpointError ? 'alert' : undefined}>{endpointError || omniMindZhCN.settings.endpointHelp}</small>
                  </div>

                  {/* Field 2: API Key */}
                  <div className="endpoint-field-group">
                    <label htmlFor="omnimind-api-key">
                      {omniMindZhCN.settings.apiKey}
                    </label>
                    <div className="key-input-group">
                      <input
                        id="omnimind-api-key"
                        type={showKey ? 'text' : 'password'}
                        autoComplete="off"
                        placeholder={hasApiKey ? '已保存凭据；输入新 Key 可替换，原内容不会回显' : '输入新 Key；保存后生效且不会回显明文'}
                        value={apiKeyDraft}
                        onChange={(event) => { setApiKeyDraft(event.target.value); clearKeyStatus() }}
                      />
                      <button id="toggle-key-vis" className="btn shrink-btn" type="button" aria-pressed={showKey} onClick={() => setShowKey(!showKey)}>
                        {showKey ? omniMindZhCN.settings.hideDraft : omniMindZhCN.settings.showDraft}
                      </button>
                    </div>
                    <small>{omniMindZhCN.settings.apiKeyHelp}</small>
                  </div>
                </div>

                {testResult && (
                  <div id="connection-test-result" className={`connection-test-box ${testResult.success ? '' : 'failed'}`}>
                    <span>
                      {testResult.success
                        ? `🟢 端点连接正常${testResult.latencyMs === undefined ? '' : ` · 响应延迟 ${testResult.latencyMs}ms`}`
                        : `🔴 ${omniMindZhCN.settings.connectionErrors[testResult.kind as keyof typeof omniMindZhCN.settings.connectionErrors] || omniMindZhCN.settings.connectionFailed}`}
                    </span>
                    {testResult.success && <small>协议: {testResult.protocol} · Open Channel API v1 兼容</small>}
                  </div>
                )}

                {keyStatus && <p className="omnimind-key-result" role="status">{keyStatus}</p>}
              </div>
            </div>
          )}
        </div>
        <div id="omnimind-panel-scope" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-scope" hidden={tab !== 'scope'}>
          {tab === 'scope' && <OmniMindManagedScopePicker
            value={managedScope}
            onOfficialSelectionChange={setKnownOfficialSessionIds}
            onChange={(next) => { setManagedScope(next); clearKeyStatus() }}
          />}
        </div>
        <div id="omnimind-panel-response" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-response" hidden={tab !== 'response'}>
          {tab === 'response' && (
            <div className="omnimind-response-container">
              {/* 回复方式与等待时序共享一次保存事务；这里只重组展示，不改变任何领域字段、范围或运行时语义。 */}
              <div className="reply-mode-grid">
                <button
                  id="reply-mode-auto"
                  className={`reply-mode-card ${autoSend ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    setAutoSend(true)
                    clearKeyStatus()
                  }}
                >
                  <div className="reply-mode-head">
                    <span className="reply-mode-title">⚡ 全自动接管发送 (Auto-Send)</span>
                    <span className="reply-mode-badge">全自动模式</span>
                  </div>
                  <p className="reply-mode-desc">AI 完成消息分析和回复生成后，按当前托管范围进入现有发送校验流程并自动发送。</p>
                </button>

                <button
                  id="reply-mode-review"
                  className={`reply-mode-card ${!autoSend ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    setAutoSend(false)
                    clearKeyStatus()
                  }}
                >
                  <div className="reply-mode-head">
                    <span className="reply-mode-title">📝 人工审阅模式 (Manual Review)</span>
                    <span className="reply-mode-badge">审阅模式</span>
                  </div>
                  <p className="reply-mode-desc">AI 生成回复后进入待确认列表，只有你明确确认后才进入发送流程。</p>
                </button>
              </div>

              <div className="omnimind-timing-container">
              <div className="timing-section">
                <div className="timing-head-title">
                  <span>消息批处理聚合窗口 (batchWindowMs)</span>
                  <span id="batch-window-badge" className="scope-card-badge">
                    当前: {batchWindowSeconds.toFixed(1)}s
                  </span>
                </div>
                <p className="timing-desc">
                  当用户在短时间内连续发送多条消息时，在设置的窗口时间内静默等待并自动合并为一个完整上下文提交给模型。
                </p>

                <div className="slider-row">
                  <input
                    id="batch-window-range"
                    type="range"
                    min={batchRange.min}
                    max={batchRange.max}
                    step={batchRange.step}
                    value={batchWindowMs}
                    onChange={(event) => {
                      setBatchWindowSeconds(Number(event.target.value) / 1000)
                      clearKeyStatus()
                    }}
                    className="custom-range"
                    aria-label="批处理窗口毫秒数"
                  />
                  <div className="number-fine-tune">
                    <input
                      id="omnimind-batch-window"
                      type="number"
                      min={batchRange.min / 1000}
                      max={batchRange.max / 1000}
                      step={batchRange.step / 1000}
                      value={batchWindowSeconds}
                      onChange={(event) => {
                        setBatchWindowSeconds(Number(event.target.value))
                        clearKeyStatus()
                      }}
                      className="timing-number-input"
                      aria-label="消息批处理窗口（秒）"
                    />
                    <span className="unit-text">
                      秒 (<span id="batch-window-ms-text">{batchWindowMs}</span> ms)
                    </span>
                  </div>
                </div>

                <div className="preset-bubbles" role="toolbar" aria-label="批处理预设快捷气泡按钮">
                  <button
                    id="preset-batch-fast"
                    className={`preset-bubble-btn ${batchWindowMs === batchRange.min ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      setBatchWindowSeconds(batchRange.min / 1000)
                      clearKeyStatus()
                    }}
                  >
                    🚀 极速 {batchRange.min / 1000}s
                  </button>
                  <button
                    id="preset-batch-human"
                    className={`preset-bubble-btn ${batchWindowMs === OMNIMIND_SETTINGS_DEFAULTS.batchWindowMs ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      setBatchWindowSeconds(defaultBatchWindowSeconds)
                      clearKeyStatus()
                    }}
                  >
                    💬 默认 {defaultBatchWindowSeconds.toFixed(1)}s
                  </button>
                  <button
                    id="preset-batch-safe"
                    className={`preset-bubble-btn ${batchWindowSeconds === 5.0 ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      setBatchWindowSeconds(5.0)
                      clearKeyStatus()
                    }}
                  >
                    🐢 稳健 5.0s
                  </button>
                </div>

                <div className="batch-principle-card">
                  <div className="principle-title">💡 连续消息聚合原理 (Continuous Aggregation)</div>
                  <div className="principle-flow">
                    <div className="principle-step">
                      <strong>1. 连续消息传入</strong>
                      <small>"在吗？" + "方案收到了吗"</small>
                    </div>
                    <span className="principle-arrow">➔</span>
                    <div className="principle-step" style={{ borderColor: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 8%, var(--card-bg))' }}>
                      <strong>2. 静默聚合窗口 (<span id="diagram-window-val">{batchWindowSeconds.toFixed(1)}s</span>)</strong>
                      <small>倒计时等待后续连发</small>
                    </div>
                    <span className="principle-arrow">➔</span>
                    <div className="principle-step">
                      <strong>3. 合并提交 AI 模型</strong>
                      <small>打包生成完整答复</small>
                    </div>
                  </div>
                </div>
              </div>

              </div>
            </div>
          )}
        </div>
        <div id="omnimind-panel-permissions" className="omnimind-settings-panel" role="tabpanel" aria-labelledby="omnimind-tab-permissions" hidden={tab !== 'permissions'}>
          {tab === 'permissions' && (permissionModel
            ? <OmniMindPermissionCenter model={permissionModel} focusKind={initialPermissionKind} />
            : <UncontrolledPermissionCenter focusKind={initialPermissionKind} />)}
        </div>
        </div>
      </div>
      {running && criticalDirty && <p className="omnimind-warning">{omniMindZhCN.settings.criticalWarning} {criticalChanges}</p>}{validationErrors.length > 0 && <div role="alert"><strong>{omniMindZhCN.settings.errorSummary}</strong><ul>{validationErrors.map((item) => <li key={`${item.id}-${item.message}`}><a href={`#${item.id}`} onClick={() => setTab(item.id.includes('scope') ? 'scope' : item.id.includes('response') ? 'response' : 'connection')}>{item.message}</a></li>)}</ul></div>}{error && <p role="alert">{error}</p>}
      {!embedded && (
        <footer>
          <button className="secondary-btn" type="button" onClick={requestClose}>{omniMindZhCN.actions.cancel}</button>
          <button className="omnimind-primary-action primary-btn" type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? omniMindZhCN.actions.saving : running && criticalDirty ? omniMindZhCN.actions.confirmCritical : omniMindZhCN.actions.save}</button>
        </footer>
      )}
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
  </>
  if (embedded) return <div className="omnimind-settings-embedded">{settingsShell}</div>
  return createPortal(<div className="omnimind-modal-backdrop" onMouseDown={(event) => { if (!discardConfirmationOpen && event.target === event.currentTarget && !dirty) onClose() }}>{settingsShell}</div>, document.body)
}

function UncontrolledPermissionCenter({ focusKind }: { focusKind?: OmniMindPermissionKind }) {
  const model = useOmniMindPermissions()
  return <OmniMindPermissionCenter model={model} focusKind={focusKind} />
}
