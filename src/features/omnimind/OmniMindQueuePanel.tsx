import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { AppDialog } from '../../components/common/AppDialog'
import { getOmniMindRuntimePresentation, OmniMindHostingHeader } from './OmniMindHostingHeader'
import { OmniMindHostingSettingsModal, type OmniMindSettingsTab } from './OmniMindHostingSettingsModal'
import { buildQueueViewModel } from './OmniMindQueueViewModel'
import { OmniMindQueueTaskItem } from './OmniMindQueueTaskItem'
import { OMNIMIND_SETTINGS_TABS, omniMindZhCN } from './locale'
import { useOmniMind } from './useOmniMind'
import { focusCurrentConversation } from './recoveryActions'
import { useOmniMindPermissions } from './useOmniMindPermissions'
import type { OmniMindPermissionKind } from '../../../shared/omnimind/contracts'
import './omnimind.scss'

export function OmniMindQueuePanel({
  currentSessionId,
  onNavigate = () => undefined,
  onClose,
  isOverlay = false,
  hidden = false,
  embedded = false,
  onOpenSettingsRequest
}: {
  currentSessionId?: string;
  onNavigate?: (path: string) => void;
  onClose?: () => void;
  isOverlay?: boolean;
  hidden?: boolean;
  embedded?: boolean;
  onOpenSettingsRequest?: (permissionKind?: OmniMindPermissionKind) => void;
}) {
  const panelRef = useRef<HTMLElement>(null)
  const api = useOmniMind()
  const permissions = useOmniMindPermissions()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTarget, setSettingsTarget] = useState<{ permissionKind?: OmniMindPermissionKind }>({})
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [pendingConversationId, setPendingConversationId] = useState<string>()
  const settingsOpenerRef = useRef<HTMLElement | null>(null)
  const closeSettings = (): void => {
    const opener = settingsOpenerRef.current
    settingsOpenerRef.current = null
    setSettingsOpen(false)
    queueMicrotask(() => opener?.isConnected && opener.focus())
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
  const openSettings = (opener?: HTMLElement, permissionKind?: OmniMindPermissionKind): void => {
    if (onOpenSettingsRequest) {
      onOpenSettingsRequest(permissionKind)
      setAnnouncement(omniMindZhCN.recovery.settingsOpened)
      return
    }
    settingsOpenerRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setSettingsTarget({ permissionKind })
    setSettingsOpen(true)
    setAnnouncement(omniMindZhCN.recovery.settingsOpened)
  }
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
  const isPaused = view.runtimeState === 'paused'
  const isTransitioning = view.runtimeState === 'validating' || view.runtimeState === 'starting'
  const overviewCopy = isPaused
    ? { title: omniMindZhCN.overview.pausedTitle, description: omniMindZhCN.overview.pausedDescription }
    : runtime.active
      ? { title: omniMindZhCN.overview.runningTitle, description: omniMindZhCN.overview.runningDescription }
      : isTransitioning
        ? { title: omniMindZhCN.overview.validatingTitle, description: omniMindZhCN.overview.validatingDescription }
        : { title: omniMindZhCN.overview.stoppedTitle, description: omniMindZhCN.overview.stoppedDescription }
  const visibleTasks = [view.current, ...view.awaiting, ...view.waiting, ...view.recent].filter(Boolean)
  const queueClassName = [
    'omnimind-queue-panel',
    (isOverlay || onClose) && !embedded && 'overlay-panel omnimind-queue-overlay',
    embedded && 'is-embedded',
    `runtime-${view.runtimeState}`,
    api.loading && 'is-loading',
    api.error && 'has-error',
    !permissions.ready && 'permission-blocked',
    visibleTasks.some((task) => task?.status === 'delivery_unconfirmed') && 'has-unconfirmed'
  ].filter(Boolean).join(' ')
  const recoveryProps = { onInspectConversation: inspectConversation, onOpenHostingSettings: openSettings }
  const firstMissingPermission: OmniMindPermissionKind = permissions.snapshot.accessibility === 'granted' ? 'automation' : 'accessibility'
  useEffect(() => {
    if (!isOverlay || hidden) return
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>('[aria-label="关闭任务队列"]')?.focus())
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.getElementById('hosting-settings-dialog')) return
      event.preventDefault()
      onClose?.()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [hidden, isOverlay, onClose])
  return <aside ref={panelRef} id="omnimind-ai-queue" className={queueClassName} aria-label={omniMindZhCN.title} role={embedded ? 'region' : 'complementary'} tabIndex={-1} hidden={hidden}>
    <OmniMindHostingHeader state={view.runtimeState} loading={api.loading} onClose={embedded ? undefined : onClose} />

    <div id="overview-status-card" className={`omnimind-state-card overview-status-card ${isPaused ? 'paused' : runtime.active ? '' : isTransitioning ? 'validating' : 'stopped'}`}>
      <div className="status-card-info">
        <div id="overview-status-title" className="status-card-title">{overviewCopy.title}</div>
        <div id="overview-status-desc" className="status-card-desc">{overviewCopy.description}</div>
      </div>
      <div className="status-card-actions">
        {!runtime.active && !isTransitioning && (
          <button
            id="start-hosting-overview"
            className="btn primary-card"
            type="button"
            disabled={api.loading || runtime.switchDisabled}
            onClick={() => {
              // 权限未就绪时直接进入统一权限中心，并将焦点落到第一项缺失权限。
              // renderer 只负责导航；主进程 enable/send 仍会重新校验真实系统授权。
              if (!permissions.ready) {
                openSettings(undefined, firstMissingPermission)
                return
              }
              void api.enable()
            }}
          >
            开启托管
          </button>
        )}
        {view.runtimeState === 'running' && (
          <button
            id="pause-hosting-overview"
            className="btn primary-card"
            type="button"
            disabled={api.loading || runtime.switchDisabled}
            onClick={() => void api.pause()}
          >
            {omniMindZhCN.hosting.pause}
          </button>
        )}
        {isPaused && (
          <button
            id="resume-hosting-overview"
            className="btn primary-card"
            type="button"
            disabled={api.loading || runtime.switchDisabled}
            onClick={() => void api.resume()}
          >
            {omniMindZhCN.hosting.resume}
          </button>
        )}
        {view.runtimeState === 'degraded' && (
          <button
            id="stop-hosting-overview"
            className="btn danger-card"
            type="button"
            disabled={api.loading || runtime.switchDisabled}
            onClick={() => void api.disable()}
          >
            {omniMindZhCN.hosting.disable}
          </button>
        )}
      </div>
    </div>

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
      {!api.loading && view.current && <section className="omnimind-queue-section current"><h3>{omniMindZhCN.groups.current} · 1</h3><OmniMindQueueTaskItem key={view.current.id} task={view.current} onCancel={api.cancelTask} onRetry={api.retryTask} onSend={api.sendGeneratedReply} onAbandon={api.abandonGeneratedReply} onConfirmDelivery={api.confirmDelivery} {...recoveryProps} /></section>}
      {!api.loading && view.awaiting.length > 0 && <section className="omnimind-queue-section awaiting"><h3>{omniMindZhCN.groups.awaiting} · {view.awaiting.length}</h3>{view.awaiting.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} onCancel={api.cancelTask} onRetry={api.retryTask} onSend={api.sendGeneratedReply} onAbandon={api.abandonGeneratedReply} onConfirmDelivery={api.confirmDelivery} {...recoveryProps} />)}</section>}
      {!api.loading && view.waiting.length > 0 && <section className="omnimind-queue-section waiting"><h3>{omniMindZhCN.groups.waiting} · {view.waiting.length}</h3>{view.waiting.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} onCancel={api.cancelTask} onRetry={api.retryTask} onSend={api.sendGeneratedReply} onAbandon={api.abandonGeneratedReply} onConfirmDelivery={api.confirmDelivery} {...recoveryProps} />)}</section>}
      {!api.loading && view.recent.length > 0 && <section className="omnimind-queue-section recent"><h3>{omniMindZhCN.groups.recent} · {view.recent.length}</h3>{view.recent.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} onCancel={api.cancelTask} onRetry={api.retryTask} onSend={api.sendGeneratedReply} onAbandon={api.abandonGeneratedReply} onConfirmDelivery={api.confirmDelivery} {...recoveryProps} />)}</section>}
      {!api.loading && !view.current && view.waiting.length === 0 && view.awaiting.length === 0 && runtime.emptyText && <div className="omnimind-state-card omnimind-empty state-empty">{runtime.emptyText}</div>}
    </div>

    <p className="omnimind-sr-only" aria-live="polite">{announcement}</p>
    {!onOpenSettingsRequest && settingsOpen && api.settings && <OmniMindHostingSettingsModal settings={api.settings} running={runtime.active} initialTab={settingsTarget.permissionKind ? 'permissions' : undefined} initialPermissionKind={settingsTarget.permissionKind} permissionModel={permissions} onSave={api.saveSettings} onSaved={(critical) => setAnnouncement(critical ? omniMindZhCN.settings.savedStopped : omniMindZhCN.settings.saved)} onClose={closeSettings} />}
  </aside>
}

type HostingCenterTab = 'overview' | OmniMindSettingsTab

// 外层托管中心与内层设置编辑器复用同一有序标签合同；这里只额外加入队列总览，
// 禁止再维护 strategy/timing 等历史导航键，避免 ARIA、焦点与草稿路由再次漂移。
const HOSTING_CENTER_TABS: HostingCenterTab[] = ['overview', ...OMNIMIND_SETTINGS_TABS.map(({ id }) => id)]

/**
 * 兼容旧调用方的组合设置容器。
 *
 * 新产品入口已迁移到首页，并在首页保持“持续队列 + 独立设置”职责分离；ChatPage
 * 不再挂载本组件。这里仍只组合真实快照与权限能力，不创建前端伪运行状态。
 */
export function OmniMindHostingCenterDialog({
  open,
  onClose,
  openerRef,
  currentSessionId,
  onNavigate = () => undefined,
  initialPermissionKind
}: {
  open: boolean;
  onClose: () => void;
  openerRef?: RefObject<HTMLElement | null>;
  currentSessionId?: string;
  onNavigate?: (path: string) => void;
  initialPermissionKind?: OmniMindPermissionKind;
}) {
  const api = useOmniMind()
  const permissions = useOmniMindPermissions()
  const [activeTab, setActiveTab] = useState<HostingCenterTab>('overview')
  const [settingsTab, setSettingsTab] = useState<OmniMindSettingsTab>('connection')
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false)
  const [stopConfirmationOpen, setStopConfirmationOpen] = useState(false)
  const [commandBusy, setCommandBusy] = useState(false)
  const [commandError, setCommandError] = useState('')
  const [focusedPermissionKind, setFocusedPermissionKind] = useState<OmniMindPermissionKind>()
  const overviewTabRef = useRef<HTMLButtonElement>(null)
  const stopTriggerRef = useRef<HTMLButtonElement>(null)
  const runtime = getOmniMindRuntimePresentation(api.snapshot.runtimeState)

  useEffect(() => {
    if (!open) return
    // 每次从左栏进入都回到总览，确保用户先看到真实运行态与安全队列。
    setActiveTab('overview')
    setDiscardConfirmationOpen(false)
    setStopConfirmationOpen(false)
    setCommandError('')
    setFocusedPermissionKind(initialPermissionKind)
  }, [open])

  useEffect(() => {
    if (!open || !initialPermissionKind) return
    // 常驻 listener 可在中心关闭时接收恢复事件；中心重新打开后准确定位权限卡。
    setFocusedPermissionKind(initialPermissionKind)
    setSettingsTab('permissions')
    setActiveTab('permissions')
  }, [initialPermissionKind, open])

  const requestClose = (): void => {
    if (settingsDirty) {
      setDiscardConfirmationOpen(true)
      return
    }
    onClose()
  }

  const runCommand = async (command: 'start' | 'stop'): Promise<void> => {
    setCommandBusy(true)
    setCommandError('')
    try {
      if (command === 'start') await api.enable()
      else await api.disable()
      setStopConfirmationOpen(false)
      if (command === 'stop') {
        // 停止成功后，原「停止托管」按钮会随运行态卸载，Dialog 无法再恢复到 opener。
        // 先回到总览，再于 React 提交后聚焦持久存在的标签，避免焦点落回 body。
        setActiveTab('overview')
        window.requestAnimationFrame(() => overviewTabRef.current?.focus())
      }
    } catch {
      // 命令失败只展示既有错误文案；队列、凭据与草稿继续由现有状态层保留。
      setCommandError(omniMindZhCN.hosting.commandFailed)
    } finally {
      setCommandBusy(false)
    }
  }

  const runStartCommand = (): void => {
    if (!permissions.ready) {
      // 底部启动入口与概览入口共享真实权限快照；缺权限时直接进入图 2
      // 权限中心，不再显示每次启动进程都会重置的重复说明卡。
      const missing: OmniMindPermissionKind = permissions.snapshot.accessibility === 'granted' ? 'automation' : 'accessibility'
      setFocusedPermissionKind(missing)
      setSettingsTab('permissions')
      setActiveTab('permissions')
      return
    }
    void runCommand('start')
  }

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? HOSTING_CENTER_TABS.length - 1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? (index + 1) % HOSTING_CENTER_TABS.length
          : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
            ? (index - 1 + HOSTING_CENTER_TABS.length) % HOSTING_CENTER_TABS.length
            : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextTab = HOSTING_CENTER_TABS[nextIndex]
    setActiveTab(nextTab)
    if (nextTab !== 'overview') setSettingsTab(nextTab)
    document.getElementById(`omnimind-center-tab-${nextTab}`)?.focus()
  }

  const tabLabels = omniMindZhCN.hostingCenter.tabs
  const subtitle = runtime.active
    ? omniMindZhCN.hostingCenter.subtitleRunning
    : omniMindZhCN.hostingCenter.subtitleStopped

  return <>
    <AppDialog
      open={open}
      onClose={requestClose}
      title={omniMindZhCN.hostingCenter.title}
      subtitle={subtitle}
      size="xl"
      className="omnimind-hosting-center"
      dialogId="hosting-settings-dialog"
      closeAriaLabel={omniMindZhCN.hostingCenter.close}
      initialFocusRef={overviewTabRef}
      openerRef={openerRef}
      closeOnOverlayClick={false}
      footer={<>
        {commandError && <span className="omnimind-center-command-error" role="alert">{commandError}</span>}
        {!runtime.active && <button className="omnimind-primary-action primary-btn" type="button" disabled={commandBusy || api.loading || runtime.switchDisabled} onClick={runStartCommand}>{omniMindZhCN.hostingCenter.start}</button>}
        {runtime.active && <button ref={stopTriggerRef} className="omnimind-danger danger-pill" type="button" disabled={commandBusy || api.loading || runtime.switchDisabled} onClick={() => setStopConfirmationOpen(true)}>{omniMindZhCN.hostingCenter.stop}</button>}
        <button className="secondary-btn" type="button" onClick={requestClose}>{omniMindZhCN.hostingCenter.closeWithoutStopping}</button>
      </>}
    >
      <div className="omnimind-center-layout">
        <nav role="tablist" aria-label={omniMindZhCN.hostingCenter.title} aria-orientation="vertical">
          {HOSTING_CENTER_TABS.map((tab, index) => <button
            key={tab}
            id={`omnimind-center-tab-${tab}`}
            ref={tab === 'overview' ? overviewTabRef : undefined}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`omnimind-center-panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => {
              setActiveTab(tab)
              if (tab !== 'overview') {
                setSettingsTab(tab)
                if (tab !== 'permissions') setFocusedPermissionKind(undefined)
              }
            }}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >{tabLabels[tab]}</button>)}
        </nav>
        <div className="omnimind-center-panels">
          <section id="omnimind-center-panel-overview" role="tabpanel" aria-labelledby="omnimind-center-tab-overview" hidden={activeTab !== 'overview'}>
            {activeTab === 'overview' && <OmniMindQueuePanel
              embedded
              currentSessionId={currentSessionId}
              onNavigate={onNavigate}
              onOpenSettingsRequest={(permissionKind) => {
                setFocusedPermissionKind(permissionKind)
                const nextTab: OmniMindSettingsTab = permissionKind ? 'permissions' : 'connection'
                setSettingsTab(nextTab)
                setActiveTab(nextTab)
              }}
            />}
          </section>
          {/* 设置编辑器保持常驻，跨标签切换时不会因卸载而丢失尚未保存的安全草稿。 */}
          {HOSTING_CENTER_TABS.filter((tab): tab is OmniMindSettingsTab => tab !== 'overview' && tab !== settingsTab).map((tab) => <section
            key={tab}
            id={`omnimind-center-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`omnimind-center-tab-${tab}`}
            hidden
          />)}
          <section
            id={`omnimind-center-panel-${settingsTab}`}
            role="tabpanel"
            aria-labelledby={`omnimind-center-tab-${settingsTab}`}
            hidden={activeTab === 'overview'}
          >
            {api.settings && <OmniMindHostingSettingsModal
              settings={api.settings}
              running={runtime.active}
              activeTab={settingsTab}
              embedded
              initialPermissionKind={focusedPermissionKind}
              permissionModel={permissions}
              onDirtyChange={setSettingsDirty}
              onSave={api.saveSettings}
              onClose={requestClose}
            />}
          </section>
        </div>
      </div>
    </AppDialog>

    <AppDialog
      open={stopConfirmationOpen}
      onClose={() => setStopConfirmationOpen(false)}
      role="alertdialog"
      title={omniMindZhCN.hostingCenter.stopTitle}
      subtitle={omniMindZhCN.hostingCenter.stopDescription}
      size="sm"
      className="omnimind-stop-confirmation"
      openerRef={stopTriggerRef}
      closeOnOverlayClick={false}
      footer={<>
        <button type="button" onClick={() => setStopConfirmationOpen(false)}>{omniMindZhCN.actions.cancel}</button>
        <button className="omnimind-danger" type="button" disabled={commandBusy} onClick={() => void runCommand('stop')}>{omniMindZhCN.hostingCenter.confirmStop}</button>
      </>}
    />

    <AppDialog
      open={discardConfirmationOpen}
      onClose={() => setDiscardConfirmationOpen(false)}
      role="alertdialog"
      title={omniMindZhCN.settings.discardTitle}
      subtitle={omniMindZhCN.settings.discardConfirm}
      size="sm"
      closeOnOverlayClick={false}
      footer={<>
        <button type="button" onClick={() => setDiscardConfirmationOpen(false)}>{omniMindZhCN.actions.continueEditing}</button>
        <button className="omnimind-danger" type="button" onClick={() => { setDiscardConfirmationOpen(false); onClose() }}>{omniMindZhCN.actions.discardChanges}</button>
      </>}
    />
  </>
}
