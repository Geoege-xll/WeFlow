import { useEffect, useRef } from 'react'
import { Accessibility, Workflow } from 'lucide-react'
import type { OmniMindPermissionKind, OmniMindPermissionState } from '../../../shared/omnimind/contracts'
import { omniMindZhCN } from './locale'
import type { OmniMindPermissionsModel } from './useOmniMindPermissions'

const permissionKinds: OmniMindPermissionKind[] = ['accessibility', 'automation']

export function OmniMindPermissionCenter({ model, focusKind, jitKind, onJitComplete }: {
  model: OmniMindPermissionsModel
  focusKind?: OmniMindPermissionKind
  jitKind?: OmniMindPermissionKind
  onJitComplete?: () => void
}) {
  const cardRefs = useRef<Record<OmniMindPermissionKind, HTMLElement | null>>({ accessibility: null, automation: null })
  const recheckRefs = useRef<Record<OmniMindPermissionKind, HTMLButtonElement | null>>({ accessibility: null, automation: null })
  const jitContinueRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { if (!jitKind && focusKind) cardRefs.current[focusKind]?.focus() }, [focusKind, jitKind])
  useEffect(() => { if (jitKind) jitContinueRef.current?.focus() }, [jitKind])
  useEffect(() => { if (model.returnKind) recheckRefs.current[model.returnKind]?.focus() }, [model.returnKind])

  if (jitKind) {
    return <section id="omnimind-permission-jit" className="omnimind-permission-jit" role="region" aria-label={omniMindZhCN.permissions.jit.title}>
      <h3>{omniMindZhCN.permissions.jit.title}</h3>
      <p>{omniMindZhCN.permissions.jit.body}</p>
      <p>{omniMindZhCN.permissions.jit.systemOwned}</p>
      <button ref={jitContinueRef} className="omnimind-permission-primary" type="button" disabled={model.busyKind === jitKind} aria-busy={model.busyKind === jitKind} onClick={() => void model.request(jitKind).then(onJitComplete)}>{omniMindZhCN.permissions.actions.continue}</button>
      <p className="omnimind-sr-only" role="status" aria-live="polite">{model.announcement}</p>
    </section>
  }

  return <div className="omnimind-permission-center">
    <div className="omnimind-permission-intro">
      <h3>{omniMindZhCN.permissions.title}</h3>
      <p>{omniMindZhCN.permissions.intro}</p>
      <p>{omniMindZhCN.permissions.safeCheck}</p>
    </div>
    {permissionKinds.map((kind) => <PermissionCard
      key={kind}
      kind={kind}
      state={model.snapshot[kind]}
      loading={model.loading || model.busyKind === kind}
      cardRef={(node) => { cardRefs.current[kind] = node }}
      recheckRef={(node) => { recheckRefs.current[kind] = node }}
      onRequest={() => model.request(kind)}
      onOpenSettings={() => model.openSettings(kind)}
      onRecheck={() => model.recheck(kind)}
    />)}
    <p className="omnimind-sr-only" role="status" aria-live="polite">{model.announcement}</p>
  </div>
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
  return <section
    id={`omnimind-permission-${kind}`}
    ref={cardRef}
    className={`omnimind-permission-card state-${state}`}
    role="region"
    aria-labelledby={`omnimind-permission-${kind}-title`}
    tabIndex={-1}
  >
    <div className="omnimind-permission-head">
      <span className="omnimind-permission-icon" aria-hidden="true"><Icon size={20} /></span>
      <div><h4 id={`omnimind-permission-${kind}-title`}>{copy.title}</h4><p>{copy.purpose}</p></div>
      <strong>{loading ? omniMindZhCN.permissions.loading : omniMindZhCN.permissions.states[state]}</strong>
    </div>
    <div className="omnimind-permission-details">
      <p>{copy.help[state]}</p>
      <div className="omnimind-permission-actions">
        {canRequest && <button className="omnimind-permission-primary" type="button" disabled={loading} onClick={() => void onRequest()}>{omniMindZhCN.permissions.actions.continue}</button>}
        {canRecover && <button type="button" data-permission-action="settings" disabled={loading} onClick={() => void onOpenSettings()}>{omniMindZhCN.permissions.actions.openSettings}</button>}
        {canRecheck && <button ref={recheckRef} type="button" data-permission-action="recheck" disabled={loading} onClick={() => void onRecheck()}>{omniMindZhCN.permissions.actions.recheck}</button>}
      </div>
    </div>
  </section>
}
