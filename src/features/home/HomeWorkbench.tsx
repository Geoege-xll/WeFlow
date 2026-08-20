import { useCallback, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { OmniMindPermissionKind, OmniMindRuntimeState, OmniMindSettingsInput, OmniMindTaskState } from '../../../shared/omnimind/contracts'
import { AppDialog } from '../../components/common/AppDialog'
import { useDataConnectionReadiness } from '../account/useDataConnectionReadiness'
import { getOmniMindRuntimePresentation } from '../omnimind/OmniMindHostingHeader'
import { OmniMindHostingSettingsModal } from '../omnimind/OmniMindHostingSettingsModal'
import { buildQueueViewModel } from '../omnimind/OmniMindQueueViewModel'
import { omniMindZhCN } from '../omnimind/locale'
import { useOmniMind } from '../omnimind/useOmniMind'
import { useOmniMindPermissions } from '../omnimind/useOmniMindPermissions'
import { DollOfficeScene, type DollOfficeRole } from './DollOfficeScene'
import {
  mapDataReadinessToDollActivity,
  mapOmniMindRuntimeToDollActivity,
  mapPlannedRoleToDollActivity
} from './dolls/dollActivityMapping'
import { HomeOperationsPanel } from './HomeOperationsPanel'
import { HomeQueuePanel } from './HomeQueuePanel'
import type { OfficeSeatTone } from './officeWebGLRenderer'

const ACTIONABLE_RECENT_FAILURE_STATES = new Set<OmniMindTaskState>([
  'generation_failed',
  'send_failed',
  'delivery_unconfirmed'
])

/**
 * recent 中的成功和取消只是历史结果；失败及“送达未确认”仍需要人工恢复，
 * 因此首页右侧摘要必须与任务列表共用同一份 view model，不能只统计活动队列。
 */
const deriveQueueSummary = (view: ReturnType<typeof buildQueueViewModel>): string => {
  const activeCount = (view.current ? 1 : 0) + view.waiting.length + view.awaiting.length
  const actionableFailures = view.recent.filter((task) => ACTIONABLE_RECENT_FAILURE_STATES.has(task.status))
  const unconfirmedCount = actionableFailures.filter((task) => task.status === 'delivery_unconfirmed').length
  const pieces: string[] = []
  if (activeCount > 0) {
    pieces.push(`${activeCount} 个进行中`)
    if (view.awaiting.length > 0) pieces.push(`${view.awaiting.length} 个待确认`)
  }
  if (actionableFailures.length > 0) {
    pieces.push(`${actionableFailures.length} 个失败待处理`)
    if (unconfirmedCount > 0) pieces.push(`其中 ${unconfirmedCount} 个发送结果待确认`)
  }
  return pieces.length > 0 ? pieces.join(' · ') : '队列为空'
}

const canRestoreFocus = (element: HTMLElement | null): element is HTMLElement => {
  const nativeControlDisabled = element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
    ? element.disabled
    : false
  return Boolean(element?.isConnected && typeof element.focus === 'function' && !nativeControlDisabled && element.getAttribute('aria-disabled') !== 'true')
}

const runtimeTone = (state: OmniMindRuntimeState): OfficeSeatTone => {
  const value = String(state)
  if (value === 'running') return 'ready'
  if (value === 'validating' || value === 'starting' || value === 'stopping' || value === 'paused') return 'working'
  if (value === 'degraded') return 'warning'
  if (value === 'failed') return 'danger'
  return 'muted'
}

const runtimeDescription = (state: OmniMindRuntimeState): string => {
  switch (String(state)) {
    case 'validating': return '正在检查数据、AI 配置与系统权限；完成前不会领取任务。'
    case 'starting': return '启动命令已确认，运行时正在进入托管状态。'
    case 'running': return 'AI 代班员按全局串行顺序领取新任务；审核与发送确认保留在右侧队列。'
    case 'paused': return '已暂停领取新任务并保留现有队列；继续前会重新执行真实预检。'
    case 'degraded': return '托管仍在运行，但存在需要处理的配置、权限或发送问题。'
    case 'stopping': return '正在安全停止领取新任务，已有任务状态由运行时继续回写。'
    case 'failed': return '启动或运行失败。请先查看错误与恢复入口，再显式重新预检。'
    default: return '自动托管尚未启动；启动前会检查数据连接、AI 配置与必要权限。'
  }
}

type HostingCommand = 'start' | 'pause' | 'resume' | 'stop'

/**
 * 首页唯一的自动托管业务装配层。
 *
 * 真实数据边界：useDataConnectionReadiness 只暴露账号、数据库和密钥的安全派生状态；
 * useOmniMind 在这里且只在这里挂载一次，3D 场景、左下控制区和右侧队列共享同一快照。
 * 子组件均只接收展示模型和受控命令，不会复制 readiness、权限或队列状态机。
 */
export function HomeWorkbench() {
  const navigate = useNavigate()
  const location = useLocation()
  const dataReadiness = useDataConnectionReadiness()
  const api = useOmniMind()
  const permissions = useOmniMindPermissions()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPermission, setSettingsPermission] = useState<OmniMindPermissionKind>()
  const [stopConfirmationOpen, setStopConfirmationOpen] = useState(false)
  const [commandError, setCommandError] = useState('')
  const [commandBusy, setCommandBusy] = useState(false)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsOpenerRef = useRef<HTMLElement | null>(null)
  const stopTriggerRef = useRef<HTMLButtonElement>(null)

  const dataReady = dataReadiness.ready
  const dataChecking = dataReadiness.status === 'checking'
  const dataTone: OfficeSeatTone = dataReadiness.status === 'ready'
    ? 'ready'
    : dataReadiness.status === 'checking'
      ? 'working'
      : dataReadiness.status === 'read-failed'
        ? 'danger'
        : 'warning'
  const view = useMemo(() => buildQueueViewModel(api.snapshot), [api.snapshot])
  const runtime = getOmniMindRuntimePresentation(view.runtimeState)
  const runtimeState = String(view.runtimeState)
  const tone = runtimeTone(view.runtimeState)
  const queueSummary = useMemo(() => deriveQueueSummary(view), [view])

  const openDatabaseSettings = useCallback((): void => {
    // 连接修复继续交给现有数据库设置页，首页不复制密钥读取或数据库 IPC。
    navigate('/settings', { state: { initialTab: 'database', backgroundLocation: location } })
  }, [location, navigate])

  const openHostingSettings = useCallback((opener?: HTMLElement | null, permissionKind?: OmniMindPermissionKind): void => {
    // 记录真实触发源，关闭后优先回到开始/继续、权限或任务恢复按钮。
    settingsOpenerRef.current = opener ?? settingsTriggerRef.current
    setSettingsPermission(permissionKind)
    setSettingsOpen(true)
  }, [])

  const closeHostingSettings = useCallback((): void => {
    // 设置对话框只是编辑面板；关闭它不发送停止命令，也不清空队列。
    const actualOpener = settingsOpenerRef.current
    setSettingsOpen(false)
    window.requestAnimationFrame(() => {
      const fallback = settingsTriggerRef.current
      const focusTarget = canRestoreFocus(actualOpener) ? actualOpener : canRestoreFocus(fallback) ? fallback : null
      focusTarget?.focus()
      settingsOpenerRef.current = null
    })
  }, [])

  const saveHostingSettings = useCallback(async (input: OmniMindSettingsInput): Promise<void> => {
    // 保存设置与托管启停严格分离；失败时设置弹窗保持打开并由原组件报告错误。
    await api.saveSettings(input)
  }, [api])

  const runCommand = useCallback(async (command: HostingCommand): Promise<void> => {
    setCommandBusy(true)
    setCommandError('')
    try {
      if (command === 'start') await api.enable()
      else if (command === 'pause') await api.pause()
      else if (command === 'resume') await api.resume()
      else await api.disable()
      setStopConfirmationOpen(false)
    } catch {
      setCommandError(omniMindZhCN.hosting.commandFailed)
    } finally {
      setCommandBusy(false)
    }
  }, [api])

  const requestStartOrResume = (command: 'start' | 'resume', opener: HTMLButtonElement): void => {
    // renderer 的禁用态不是安全边界；点击时再次读取统一 readiness，并由主进程
    // enable/resume preflight 做最终校验。继续托管同样必须重新通过真实预检。
    if (!dataReadiness.ready) return
    if (!permissions.ready) {
      const missing: OmniMindPermissionKind = permissions.snapshot.accessibility === 'granted' ? 'automation' : 'accessibility'
      // 权限未就绪时直接进入唯一的权限中心并聚焦缺失项；不再插入一层
      // 每次进程启动都会重置的“继续”说明页。主进程 enable 预检仍是最终安全边界。
      openHostingSettings(opener, missing)
      return
    }
    void runCommand(command)
  }

  const inspectConversation = (sessionId: string): void => { void navigate(`/chat?sessionId=${encodeURIComponent(sessionId)}`) }

  const dataSummary = dataReadiness.status === 'ready'
    ? '数据已就绪'
    : dataReadiness.status === 'checking'
      ? '正在检查'
      : dataReadiness.status === 'disconnected'
        ? '数据未连接'
        : dataReadiness.status === 'account-missing'
          ? '账号待识别'
          : '状态读取失败'
  const dataStatusTitle = dataReadiness.status === 'ready'
    ? '数据可以安全读取'
    : dataReadiness.status === 'checking'
      ? '正在读取持久账号状态'
      : dataReadiness.status === 'disconnected'
        ? '需要完成数据连接'
        : dataReadiness.status === 'account-missing'
          ? '需要识别当前账号'
          : '账号状态读取失败'
  const dataStatusCopy = dataReadiness.status === 'ready'
    ? '账号、数据库与本地密钥检查均已通过；敏感值不会在首页回显。'
    : dataReadiness.status === 'checking'
      ? '正在重新读取持久账号配置；完成前自动托管保持禁用。'
      : dataReadiness.status === 'disconnected'
        ? '请进入数据库设置完成密钥检查与连接测试。'
        : dataReadiness.status === 'account-missing'
          ? '数据库已连接，但持久账号配置尚未识别。'
          : '无法安全读取持久账号配置；读取成功前托管保持禁用。'
  const recoverDataReadiness = (): void => {
    if (dataReadiness.status === 'read-failed') dataReadiness.reload()
    else if (dataReadiness.status === 'account-missing') navigate('/account-management')
    else openDatabaseSettings()
  }
  const recoveryLabel = dataReadiness.status === 'read-failed'
    ? '重新检查'
    : dataReadiness.status === 'account-missing'
      ? '账号管理'
      : dataReadiness.status === 'checking'
        ? '检查中'
        : '修复连接'

  const roles = useMemo<DollOfficeRole[]>(() => [
    {
      id: 'data', order: '01', title: '数据管理员', responsibility: '维护账号、数据库与本地密钥的安全连接。',
      status: dataSummary, statusTitle: dataStatusTitle, statusDescription: dataStatusCopy,
      tone: dataTone, activity: mapDataReadinessToDollActivity(dataReadiness.status)
    },
    {
      id: 'ai', order: '02', title: 'AI 代班员', responsibility: '在明确授权下执行自动托管并报告真实运行状态。',
      status: api.loading ? '读取中' : omniMindZhCN.hosting[view.runtimeState],
      statusTitle: runtimeState === 'running' ? 'AI 代班员正在值守' : runtimeState === 'paused' ? '自动托管已暂停' : runtimeState === 'failed' ? '托管运行失败' : '自动托管运行概览',
      statusDescription: runtimeDescription(view.runtimeState), tone,
      activity: mapOmniMindRuntimeToDollActivity(view.runtimeState)
    },
    {
      id: 'insight', order: '03', title: '洞察分析师', responsibility: '在真实分析能力接入后生成可核验洞察。',
      status: '筹备中', statusTitle: '筹备中 · 尚未接入', statusDescription: '当前不展示分析指标、任务或运行进度。', tone: 'muted', activity: mapPlannedRoleToDollActivity('insight')
    },
    {
      id: 'tasks', order: '04', title: '任务技术员', responsibility: '在真实后台能力接入后执行可追踪技术任务。',
      status: '筹备中', statusTitle: '筹备中 · 尚未接入', statusDescription: '当前不展示任务进度、完成数量或模拟队列。', tone: 'muted', activity: mapPlannedRoleToDollActivity('tasks')
    }
  ], [api.loading, dataReadiness.status, dataStatusCopy, dataStatusTitle, dataSummary, dataTone, runtimeState, tone, view.runtimeState])

  const primaryAction = runtimeState === 'running'
    ? { label: '暂停托管', disabled: api.loading || commandBusy || runtime.switchDisabled, onClick: () => { void runCommand('pause') } }
    : runtimeState === 'degraded'
      ? { label: '检查托管设置', disabled: api.loading || !api.settings || commandBusy || runtime.switchDisabled, onClick: (opener: HTMLButtonElement) => openHostingSettings(opener) }
    : runtimeState === 'paused'
      ? { label: '继续托管', disabled: !dataReady || api.loading || !api.settings || permissions.loading || commandBusy || runtime.switchDisabled, onClick: (opener: HTMLButtonElement) => requestStartOrResume('resume', opener) }
      : runtimeState === 'validating' || runtimeState === 'starting' || runtimeState === 'stopping'
        ? { label: runtimeState === 'validating' ? '预检中' : '状态切换中', disabled: true, onClick: () => undefined }
        : { label: runtimeState === 'failed' ? '重新预检' : '开始托管', disabled: !dataReady || api.loading || !api.settings || permissions.loading || commandBusy || runtime.switchDisabled, onClick: (opener: HTMLButtonElement) => requestStartOrResume('start', opener) }

  const queueTaskActions = {
    onCancel: api.cancelTask,
    onRetry: api.retryTask,
    onSend: api.sendGeneratedReply,
    onAbandon: api.abandonGeneratedReply,
    // “确认送达”直接调用同一 useOmniMind 实例暴露的主进程命令；返回的权威快照
    // 会替换当前首页快照，因此队列与失败摘要同步消除，不建立本地假状态。
    onConfirmDelivery: api.confirmDelivery,
    onInspectConversation: inspectConversation,
    onOpenHostingSettings: (opener?: HTMLElement, kind?: OmniMindPermissionKind) => openHostingSettings(opener, kind)
  }

  return (
    <div className="home-workbench" aria-label="OmniMindWeChat 首页固定三模块工作台">
      <DollOfficeScene roles={roles} />

      <HomeOperationsPanel
        data={{
          status: dataSummary,
          tone: dataTone,
          title: dataStatusTitle,
          description: dataStatusCopy,
          account: dataReadiness.status === 'read-failed' ? '读取失败' : dataReadiness.accountIdentified ? '已识别' : dataChecking ? '检查中' : '待识别',
          database: dataReadiness.dbConnected ? '可读取' : '未连接',
          key: dataReady ? '校验通过' : dataReadiness.status === 'read-failed' ? '状态未知' : '待验证',
          checking: dataChecking,
          primaryLabel: dataReadiness.status === 'ready' ? '重新检查' : recoveryLabel,
          primaryKind: dataReadiness.status === 'ready' ? 'recheck' : 'recover',
          onRecheck: dataReadiness.reload,
          onRecover: recoverDataReadiness,
          onAccountManagement: () => navigate('/account-management')
        }}
        ai={{
          status: api.loading ? '读取中' : omniMindZhCN.hosting[view.runtimeState],
          tone,
          title: runtimeState === 'running' ? 'AI 代班员正在值守' : runtimeState === 'paused' ? '自动托管已暂停' : runtimeState === 'failed' ? '托管运行失败' : '自动托管运行概览',
          description: runtimeDescription(view.runtimeState),
          dataWarning: !dataReady ? {
            text: dataReadiness.status === 'read-failed'
              ? '账号状态读取失败，请重新检查后再托管。'
              : dataReadiness.status === 'account-missing'
                ? '数据库已连接，但账号尚未识别。'
                : dataChecking ? '正在确认持久账号状态。' : '数据尚未就绪，请先修复连接。',
            danger: dataReadiness.status === 'read-failed',
            action: recoveryLabel,
            disabled: dataChecking,
            onAction: recoverDataReadiness
          } : undefined,
          commandError: commandError || (api.error ? '无法读取托管状态，请重新检查。' : undefined),
          primary: primaryAction,
          canEnd: ['running', 'degraded', 'paused'].includes(runtimeState),
          endDisabled: api.loading || commandBusy || runtime.switchDisabled,
          onEnd: (opener) => { stopTriggerRef.current = opener; setStopConfirmationOpen(true) },
          settingsDisabled: api.loading || !api.settings,
          settingsRef: settingsTriggerRef,
          onSettings: (opener) => openHostingSettings(opener),
          onPermissions: (opener) => openHostingSettings(opener, permissions.snapshot.accessibility === 'granted' ? 'automation' : 'accessibility'),
          onReload: () => { void api.reload() }
        }}
      />

      <HomeQueuePanel view={view} loading={api.loading} summary={queueSummary} runtime={runtime} actions={queueTaskActions} />

      {settingsOpen && api.settings && <OmniMindHostingSettingsModal
        settings={api.settings}
        running={runtime.active}
        initialTab={settingsPermission ? 'permissions' : undefined}
        initialPermissionKind={settingsPermission}
        permissionModel={permissions}
        onSave={saveHostingSettings}
        onSaved={closeHostingSettings}
        onClose={closeHostingSettings}
      />}

      <AppDialog
        open={stopConfirmationOpen}
        onClose={() => setStopConfirmationOpen(false)}
        role="alertdialog"
        title="结束自动托管？"
        subtitle="结束会停止继续领取新任务。关闭本确认框或托管设置不会停止运行，也不会清空队列。"
        size="sm"
        openerRef={stopTriggerRef}
        closeOnOverlayClick={false}
        footer={<>
          <button type="button" onClick={() => setStopConfirmationOpen(false)}>取消</button>
          <button type="button" className="home-danger-action" disabled={commandBusy} onClick={() => void runCommand('stop')}>确认结束托管</button>
        </>}
      />
    </div>
  )
}
