import { useEffect, useMemo, useRef, useState } from 'react'
import { getOmniMindRuntimePresentation, OmniMindHostingHeader } from './OmniMindHostingHeader'
import { OmniMindHostingSettingsModal } from './OmniMindHostingSettingsModal'
import { buildQueueViewModel } from './OmniMindQueueViewModel'
import { OmniMindQueueTaskItem } from './OmniMindQueueTaskItem'
import { omniMindZhCN } from './locale'
import { useOmniMind } from './useOmniMind'
import { focusCurrentConversation, OMNIMIND_OPEN_SETTINGS_EVENT, type OmniMindOpenSettingsDetail } from './recoveryActions'
import { useOmniMindPermissions } from './useOmniMindPermissions'
import type { OmniMindPermissionKind } from '../../../shared/omnimind/contracts'
import './omnimind.scss'

export function OmniMindQueuePanel({
  currentSessionId,
  onNavigate = () => undefined,
  onClose,
  onOpenActiveModal,
  isOverlay = false,
  hidden = false
}: {
  currentSessionId?: string;
  onNavigate?: (path: string) => void;
  onClose?: () => void;
  onOpenActiveModal?: () => void;
  isOverlay?: boolean;
  hidden?: boolean;
}) {
  const api = useOmniMind()
  const permissions = useOmniMindPermissions()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTarget, setSettingsTarget] = useState<{ permissionKind?: OmniMindPermissionKind; jit?: boolean }>({})
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [pendingConversationId, setPendingConversationId] = useState<string>()
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsOpenerRef = useRef<HTMLElement | null>(null)
  const closeSettings = (): void => {
    const opener = settingsOpenerRef.current
    settingsOpenerRef.current = null
    setSettingsOpen(false)
    queueMicrotask(() => (opener?.isConnected ? opener : settingsButtonRef.current)?.focus())
  }
  const focusConversation = (): void => { setAnnouncement(focusCurrentConversation() ? omniMindZhCN.recovery.conversationFocused : omniMindZhCN.recovery.conversationUnavailable) }
  const inspectConversation = (sessionId: string): void => {
    if (sessionId !== currentSessionId) {
      setAnnouncement('')
      setPendingConversationId(sessionId)
      onNavigate(`/chat?sessionId=${encodeURIComponent(sessionId)}`)
      return
    }
    focusConversation()
  }
  const openSettings = (opener?: HTMLElement, permissionKind?: OmniMindPermissionKind, jit = false): void => {
    settingsOpenerRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setSettingsTarget({ permissionKind, jit })
    setSettingsOpen(true)
    setAnnouncement(omniMindZhCN.recovery.settingsOpened)
  }
  useEffect(() => {
    const onOpenSettings = (event: Event): void => {
      const detail = (event as CustomEvent<OmniMindOpenSettingsDetail>).detail
      openSettings(detail?.opener, detail?.permissionKind)
    }
    window.addEventListener(OMNIMIND_OPEN_SETTINGS_EVENT, onOpenSettings)
    return () => window.removeEventListener(OMNIMIND_OPEN_SETTINGS_EVENT, onOpenSettings)
  }, [])
  useEffect(() => {
    if (!pendingConversationId || currentSessionId !== pendingConversationId) return
    const timer = window.setTimeout(() => {
      focusConversation()
      setPendingConversationId(undefined)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [currentSessionId, pendingConversationId])
  useEffect(() => { if (!api.loading) { setShowSkeleton(false); return }; const timer = setTimeout(() => setShowSkeleton(true), 300); return () => clearTimeout(timer) }, [api.loading])
  useEffect(() => {
    if (api.snapshot.runtimeState !== 'failed') return
    if (api.snapshot.error === 'accessibility_permission_denied') openSettings(undefined, 'accessibility')
    else if (api.snapshot.error === 'automation_permission_denied') openSettings(undefined, 'automation')
  }, [api.snapshot.runtimeState, api.snapshot.error])
  const view = useMemo(() => buildQueueViewModel(api.snapshot), [api.snapshot])
  const currentCount = view.current ? 1 : 0
  const runtime = getOmniMindRuntimePresentation(view.runtimeState)
  const visibleTasks = [view.current, ...view.awaiting, ...view.waiting, ...view.recent].filter(Boolean)
  const queueClassName = [
    'omnimind-queue-panel',
    (isOverlay || onClose) && 'overlay-panel omnimind-queue-overlay',
    `runtime-${view.runtimeState}`,
    api.loading && 'is-loading',
    api.error && 'has-error',
    !permissions.ready && 'permission-blocked',
    visibleTasks.some((task) => task?.status === 'delivery_unconfirmed') && 'has-unconfirmed'
  ].filter(Boolean).join(' ')
  const recoveryProps = { onInspectConversation: inspectConversation, onOpenHostingSettings: openSettings }
  const firstMissingPermission: OmniMindPermissionKind = permissions.snapshot.accessibility === 'granted' ? 'automation' : 'accessibility'
  const enable = async (): Promise<void> => {
    if (!permissions.ready) {
      openSettings(settingsButtonRef.current ?? undefined, firstMissingPermission, true)
      return
    }
    await api.enable()
    onOpenActiveModal?.()
  }
  return <aside id="omnimind-ai-queue" className={queueClassName} aria-label={omniMindZhCN.title} tabIndex={-1} hidden={hidden}>
    <OmniMindHostingHeader state={view.runtimeState} loading={api.loading} permissionReady={permissions.ready} permissionExplanationOpen={settingsOpen && Boolean(settingsTarget.jit)} permissionRequestBusy={Boolean(permissions.busyKind)} onEnable={enable} onDisable={api.disable} onSettings={() => openSettings(settingsButtonRef.current ?? undefined)} onOpenActiveModal={onOpenActiveModal} onClose={onClose} settingsButtonRef={settingsButtonRef} />
    <div className="omnimind-queue-metrics" aria-label={omniMindZhCN.queueLabel}>
      <div aria-label={`${omniMindZhCN.metrics.current} ${currentCount}`}><strong>{currentCount}</strong><span>{omniMindZhCN.metrics.current}</span></div>
      <div aria-label={`${omniMindZhCN.metrics.waiting} ${view.waiting.length}`}><strong>{view.waiting.length}</strong><span>{omniMindZhCN.metrics.waiting}</span></div>
      <div aria-label={`${omniMindZhCN.metrics.awaiting} ${view.awaiting.length}`}><strong>{view.awaiting.length}</strong><span>{omniMindZhCN.metrics.awaiting}</span></div>
    </div>
    {api.error && <div className="omnimind-state-card omnimind-queue-alert state-error" role="alert">{omniMindZhCN.error}<button type="button" onClick={() => void api.reload()}>{omniMindZhCN.actions.retry}</button></div>}
    {!api.loading && view.runtimeState === 'degraded' && <div className="omnimind-state-card omnimind-runtime-notice warning state-degraded" role="status"><span>{omniMindZhCN.runtime.degradedReason}</span><button type="button" onClick={(event) => openSettings(event.currentTarget)}>{omniMindZhCN.runtime.reviewSettings}</button></div>}
    {!api.loading && view.runtimeState === 'failed' && <div className="omnimind-state-card omnimind-runtime-notice failed state-failed" role="alert"><span>{omniMindZhCN.runtime.failedReason}</span><button type="button" onClick={(event) => openSettings(event.currentTarget)}>{omniMindZhCN.runtime.reviewSettings}</button></div>}
    {!api.loading && runtime.active && !permissions.ready && <div className="omnimind-state-card omnimind-runtime-notice warning state-permission" role="status"><span>{omniMindZhCN.permissions.safePause}</span><button type="button" onClick={(event) => openSettings(event.currentTarget, firstMissingPermission)}>{omniMindZhCN.permissions.actions.recover}</button></div>}
    <div className="omnimind-task-scroll" aria-live="polite">
      {api.loading && showSkeleton && <div className="omnimind-state-card omnimind-skeleton state-loading" role="status">{omniMindZhCN.loading}</div>}
      {!api.loading && view.current && <section className="omnimind-queue-section current"><h3>{omniMindZhCN.groups.current} · 1</h3><OmniMindQueueTaskItem key={view.current.id} task={view.current} onCancel={api.cancelTask} onRetry={api.retryTask} onSend={api.sendGeneratedReply} onAbandon={api.abandonGeneratedReply} {...recoveryProps} /></section>}
      {!api.loading && view.awaiting.length > 0 && <section className="omnimind-queue-section awaiting"><h3>{omniMindZhCN.groups.awaiting} · {view.awaiting.length}</h3>{view.awaiting.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} onCancel={api.cancelTask} onRetry={api.retryTask} onSend={api.sendGeneratedReply} onAbandon={api.abandonGeneratedReply} {...recoveryProps} />)}</section>}
      {!api.loading && view.waiting.length > 0 && <section className="omnimind-queue-section waiting"><h3>{omniMindZhCN.groups.waiting} · {view.waiting.length}</h3>{view.waiting.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} onCancel={api.cancelTask} onRetry={api.retryTask} onSend={api.sendGeneratedReply} onAbandon={api.abandonGeneratedReply} {...recoveryProps} />)}</section>}
      {!api.loading && view.recent.length > 0 && <section className="omnimind-queue-section recent"><h3>{omniMindZhCN.groups.recent} · {view.recent.length}</h3>{view.recent.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} onCancel={api.cancelTask} onRetry={api.retryTask} onSend={api.sendGeneratedReply} onAbandon={api.abandonGeneratedReply} {...recoveryProps} />)}</section>}
      {!api.loading && !view.current && view.waiting.length === 0 && view.awaiting.length === 0 && runtime.emptyText && <div className="omnimind-state-card omnimind-empty state-empty">{runtime.emptyText}</div>}
    </div>
    <p className="omnimind-sr-only" aria-live="polite">{announcement}</p>
    {settingsOpen && api.settings && <OmniMindHostingSettingsModal settings={api.settings} running={runtime.active} initialTab={settingsTarget.permissionKind ? 'permissions' : undefined} initialPermissionKind={settingsTarget.permissionKind} jitPermissionKind={settingsTarget.jit ? settingsTarget.permissionKind : undefined} permissionModel={permissions} onSave={api.saveSettings} onSaved={(critical) => setAnnouncement(critical ? omniMindZhCN.settings.savedStopped : omniMindZhCN.settings.saved)} onClose={closeSettings} />}
  </aside>
}
