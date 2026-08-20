import { useEffect, useRef } from 'react'
import { Accessibility, Workflow } from 'lucide-react'
import type { OmniMindPermissionKind, OmniMindPermissionState } from '../../../shared/omnimind/contracts'
import { omniMindZhCN } from './locale'
import type { OmniMindPermissionsModel } from './useOmniMindPermissions'

const permissionKinds: OmniMindPermissionKind[] = ['accessibility', 'automation']

export function OmniMindPermissionCenter({ model, focusKind }: {
  model: OmniMindPermissionsModel
  focusKind?: OmniMindPermissionKind
}) {
  const cardRefs = useRef<Record<OmniMindPermissionKind, HTMLElement | null>>({ accessibility: null, automation: null })
  const recheckRefs = useRef<Record<OmniMindPermissionKind, HTMLButtonElement | null>>({ accessibility: null, automation: null })

  useEffect(() => {
    if (!focusKind) return
    // 托管中心首次打开时，外层 Dialog 也会安排初始焦点。等同一帧的外层
    // 聚焦完成后再定位缺失权限卡，确保用户不会被带回“概览与队列”。
    const frame = window.requestAnimationFrame(() => cardRefs.current[focusKind]?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [focusKind])
  useEffect(() => { if (model.returnKind) recheckRefs.current[model.returnKind]?.focus() }, [model.returnKind])

  return (
    <div className="omnimind-permission-center">
      <div className="omnimind-panel-header">
        <h3 className="omnimind-panel-title">{omniMindZhCN.permissions.title}</h3>
        <p className="omnimind-panel-subtitle">{omniMindZhCN.permissions.intro} · {omniMindZhCN.permissions.safeCheck}</p>
      </div>

      <div className="perm-grid">
        {permissionKinds.map((kind) => (
          <PermissionCard
            key={kind}
            kind={kind}
            state={model.snapshot[kind]}
            loading={model.loading || model.busyKind === kind}
            cardRef={(node) => { cardRefs.current[kind] = node }}
            recheckRef={(node) => { recheckRefs.current[kind] = node }}
            onRequest={() => model.request(kind)}
            onOpenSettings={() => model.openSettings(kind)}
            onRecheck={() => model.recheck(kind)}
          />
        ))}

      </div>

      <div className="omnimind-panel-recheck-bar">
        <div className="recheck-info">
          <span className="recheck-title">🛡️ 权限状态实时复核</span>
          <p id="permission-copy" className="recheck-desc">点击“重新检查”可静默刷新全部 macOS 系统授权状态，不会自动启动托管。</p>
        </div>
        <button
          id="recheck-permission"
          className="btn secondary-btn"
          type="button"
          disabled={model.loading}
          onClick={() => {
            void model.recheck('accessibility')
            void model.recheck('automation')
          }}
        >
          重新检查全部权限
        </button>
      </div>

      <p className="omnimind-sr-only" role="status" aria-live="polite">{model.announcement}</p>
    </div>
  )
}

function PermissionCard({ kind, state, loading, cardRef, recheckRef, onRequest, onOpenSettings, onRecheck }: {
  kind: OmniMindPermissionKind
  state: OmniMindPermissionState
  loading: boolean
  cardRef: (node: HTMLElement | null) => void
  recheckRef: (node: HTMLButtonElement | null) => void
  onRequest: () => Promise<void>
  onOpenSettings: () => Promise<void>
  onRecheck: () => Promise<void>
}) {
  const copy = omniMindZhCN.permissions.cards[kind]
  const Icon = kind === 'accessibility' ? Accessibility : Workflow
  const canRequest = state === 'not_requested'
  const canRecover = state === 'unknown' || state === 'denied'
  const canRecheck = state !== 'unsupported' && !canRequest

  const isAccessibility = kind === 'accessibility'
  const cardId = isAccessibility ? 'perm-accessibility-card' : 'perm-keyboard-card'
  const badgeId = isAccessibility ? 'perm-accessibility-badge' : 'perm-keyboard-badge'
  const grantId = isAccessibility ? 'grant-accessibility' : 'grant-keyboard'
  const isGranted = state === 'granted'

  return (
    <section
      id={cardId}
      ref={cardRef}
      className={`omnimind-permission-card perm-card state-${state}`}
      role="region"
      aria-labelledby={`omnimind-permission-${kind}-title`}
      tabIndex={-1}
    >
      <div className="perm-card-head">
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <span className="perm-card-icon" aria-hidden="true"><Icon size={18} /></span>
          <div>
            <h4 id={`omnimind-permission-${kind}-title`} className="perm-card-title">{copy.title}</h4>
            <p className="perm-card-desc">{copy.purpose}</p>
            {copy.help[state] && <p className="perm-card-help" style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{copy.help[state]}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
          <span id={badgeId} className={`perm-badge ${isGranted ? 'granted' : 'denied'}`}>
            {isGranted ? '已授权 ✓' : '未授权 ✕'}
          </span>
          <strong className="perm-state-text" style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            {loading ? omniMindZhCN.permissions.loading : omniMindZhCN.permissions.states[state]}
          </strong>
        </div>
      </div>
      <div className="perm-card-foot omnimind-permission-actions">
        {canRequest && (
          <button id={grantId} className="btn primary-card" type="button" disabled={loading} onClick={() => void onRequest()}>
            {omniMindZhCN.permissions.actions.request}
          </button>
        )}
        {canRecover && (
          <button id={grantId} className="btn secondary-btn" type="button" data-permission-action="settings" disabled={loading} onClick={() => void onOpenSettings()}>
            {omniMindZhCN.permissions.actions.openSettings}
          </button>
        )}
        {canRecheck && (
          <button ref={recheckRef} className="btn secondary-btn" type="button" data-permission-action="recheck" disabled={loading} onClick={() => void onRecheck()}>
            {omniMindZhCN.permissions.actions.recheck}
          </button>
        )}
      </div>
    </section>
  )
}
