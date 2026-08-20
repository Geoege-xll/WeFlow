// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindPermissionSnapshot, OmniMindRuntimeState, OmniMindSnapshot, OmniMindTaskSummary } from '../shared/omnimind/contracts'
import HomePage from '../src/pages/HomePage'
import { useAppStore } from '../src/stores/appStore'

const settings = {
  schemaVersion: 2 as const,
  pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
  managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
  autoSend: false,
  ignoreOfficial: true,
  hasApiKey: true,
  batchWindowMs: 2000,
  requestTimeoutMs: 15000
}

const grantedPermissions: OmniMindPermissionSnapshot = { accessibility: 'granted', automation: 'granted' }

const installApi = (
  runtimeState: OmniMindRuntimeState = 'stopped',
  options: {
    snapshot?: Partial<OmniMindSnapshot>
    permissions?: OmniMindPermissionSnapshot
    persistentMyWxid?: string | null
    configGet?: ReturnType<typeof vi.fn>
    confirmDeliverySnapshot?: OmniMindSnapshot
  } = {}
) => {
  const snapshot: OmniMindSnapshot = {
    runtimeState,
    waiting: [],
    recent: [],
    ...options.snapshot
  }
  const permissionSnapshot = options.permissions ?? grantedPermissions
  const enable = vi.fn().mockResolvedValue({ runtimeState: 'running', waiting: [], recent: [] })
  const pause = vi.fn().mockResolvedValue({ runtimeState: 'paused', waiting: [], recent: [] })
  const resume = vi.fn().mockResolvedValue({ runtimeState: 'running', waiting: [], recent: [] })
  const disable = vi.fn().mockResolvedValue({ runtimeState: 'stopped', waiting: [], recent: [] })
  const onSnapshotChanged = vi.fn(() => () => undefined)
  const retryTask = vi.fn().mockResolvedValue(undefined)
  const sendGeneratedReply = vi.fn().mockResolvedValue({ success: true })
  const confirmDelivery = vi.fn().mockResolvedValue(options.confirmDeliverySnapshot ?? snapshot)
  const persistedMyWxid = 'persistentMyWxid' in options ? options.persistentMyWxid : 'account-a'
  const configGet = options.configGet ?? vi.fn(async (key: string) => key === 'myWxid' ? persistedMyWxid : null)
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    config: {
      get: configGet,
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined)
    },
    omniMind: {
      getSnapshot: vi.fn(async () => snapshot),
      getSettings: vi.fn(async () => settings),
      onSnapshotChanged,
      enable,
      pause,
      resume,
      disable,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      clearApiKey: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
      cancelTask: vi.fn().mockResolvedValue(undefined),
      retryTask,
      sendGeneratedReply,
      abandonGeneratedReply: vi.fn().mockResolvedValue(undefined),
      confirmDelivery,
      getPermissions: vi.fn(async () => permissionSnapshot),
      requestPermission: vi.fn(async () => permissionSnapshot),
      recheckPermission: vi.fn(async () => permissionSnapshot),
      openPermissionSettings: vi.fn().mockResolvedValue(undefined),
      onPermissionsChanged: vi.fn(() => () => undefined)
    }
  } })
  return { enable, pause, resume, disable, onSnapshotChanged, configGet, retryTask, sendGeneratedReply, confirmDelivery }
}

const recentTask = (id: string, status: OmniMindTaskSummary['status'], overrides: Partial<OmniMindTaskSummary> = {}): OmniMindTaskSummary => ({
  id,
  sessionId: `session-${id}`,
  sessionName: `会话 ${id}`,
  status,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const LocationProbe = () => {
  const location = useLocation()
  const state = location.state as { initialTab?: string } | null
  return <output data-testid="location-probe">{location.pathname}|{state?.initialTab ?? ''}</output>
}

beforeEach(() => {
  // jsdom 没有 WebGL；显式返回 null 让组件走受控二维退化，避免 getContext 的
  // “Not implemented” 噪声掩盖真正的业务断言。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAppStore.getState().reset()
})

describe('OmniMindWeChat 首页玩偶办公室', () => {
  it('renders four fixed roles, connects two real roles, and subscribes to runtime only once', async () => {
    const { onSnapshotChanged } = installApi('stopped', { persistentMyWxid: 'wxid-private-value' })
    useAppStore.setState({ isDbConnected: true })

    const { container } = render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    expect(screen.getByRole('heading', { name: '数据管理员' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'AI 代班员' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '洞察分析师' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '任务技术员' })).toBeTruthy()
    // 桌前岗位牌只显示编号与岗位名称；“筹备中”只保留在下方真实业务模块/只读信息区，避免状态双展示。
    expect(screen.getAllByText('筹备中')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '03 洞察分析师' }).textContent).not.toContain('筹备中')
    expect(screen.getByRole('button', { name: '04 任务技术员' }).textContent).not.toContain('筹备中')
    expect(await screen.findByText('数据可以安全读取')).toBeTruthy()
    expect(await screen.findAllByText('自动托管已停止')).not.toHaveLength(0)
    expect(onSnapshotChanged).toHaveBeenCalledOnce()
    // 首页只能展示安全摘要，真实账号标识、路径和密钥值都不能进入 DOM。
    expect(container.textContent).not.toContain('wxid-private-value')
    expect(container.textContent).not.toContain('/Users/')
  })

  it('uses the persisted account after startup even when the runtime store only knows the database connection', async () => {
    const persistedWxid = 'wxid_real-device-private'
    installApi('stopped', { persistentMyWxid: persistedWxid })
    // 等价真机重启：App 只恢复数据库运行时连接，不在 Zustand 中复制账号 ID。
    useAppStore.setState({ isDbConnected: true })

    const { container } = render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    expect((await screen.findAllByText('数据已就绪')).length).toBeGreaterThan(0)
    expect(screen.getByText('已识别')).toBeTruthy()
    const start = screen.getByRole('button', { name: '开始托管' }) as HTMLButtonElement
    await waitFor(() => expect(start.disabled).toBe(false))
    // Hook 只向首页提供安全 boolean，持久身份原文不得进入 DOM。
    expect(container.textContent).not.toContain(persistedWxid)
  })

  it('fails closed with account-missing copy when the persisted account ID is empty', async () => {
    const { enable } = installApi('stopped', { persistentMyWxid: '   ' })
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    expect((await screen.findAllByText('账号待识别')).length).toBeGreaterThan(0)
    const start = screen.getByRole('button', { name: '开始托管' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(enable).not.toHaveBeenCalled()
  })

  it('distinguishes persisted-account read failures and lets the user retry safely', async () => {
    const configGet = vi.fn()
      .mockRejectedValueOnce(new Error('private config detail'))
      .mockResolvedValue('account-after-retry')
    installApi('stopped', { configGet })
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    expect((await screen.findAllByText('状态读取失败')).length).toBeGreaterThan(0)
    expect(screen.queryByText('账号待识别')).toBeNull()
    const start = screen.getByRole('button', { name: '开始托管' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    const dataModule = screen.getByRole('heading', { name: '数据管理员' }).closest('article')
    fireEvent.click(within(dataModule as HTMLElement).getByRole('button', { name: '重新检查' }))
    expect(await screen.findByText('数据可以安全读取')).toBeTruthy()
    await waitFor(() => expect(start.disabled).toBe(false))
  })

  it('blocks hosting while data is unavailable and routes repair to the existing database settings', async () => {
    const { enable } = installApi()
    useAppStore.setState({ isDbConnected: false })

    render(<div id="root"><MemoryRouter initialEntries={['/home']}><Routes><Route path="*" element={<><HomePage /><LocationProbe /></>} /></Routes></MemoryRouter></div>)

    const start = await screen.findByRole('button', { name: '开始托管' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(enable).not.toHaveBeenCalled()
    const dataModule = screen.getByRole('heading', { name: '数据管理员' }).closest('article')
    fireEvent.click(within(dataModule as HTMLElement).getByRole('button', { name: '修复连接' }))
    expect(screen.getByTestId('location-probe').textContent).toBe('/settings|database')
  })

  it('closes independent settings without stopping hosting or removing the persistent queue', async () => {
    const { disable } = installApi('running')
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    expect(await screen.findByText('AI 代班员正在值守')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '全局串行队列' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '托管设置' }))
    expect(await screen.findByRole('dialog', { name: 'AI 托管与自动化设置' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI 托管与自动化设置' })).toBeNull())
    expect(disable).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '全局串行队列' })).toBeTruthy()
  })

  it.each([
    {
      name: '生成失败',
      recent: [recentTask('generation', 'generation_failed', { failureStage: 'generation', reason: 'generation_failed' })],
      summary: '1 个失败待处理'
    },
    {
      name: '发送失败与发送结果未确认',
      recent: [
        recentTask('send', 'send_failed', { failureStage: 'automation', reason: 'input_submit_failed' }),
        recentTask('unconfirmed', 'delivery_unconfirmed', { failureStage: 'verification_postsend', reason: 'outbound_not_verified' }),
        recentTask('sent', 'sent'),
        recentTask('cancelled', 'cancelled')
      ],
      summary: '2 个失败待处理 · 其中 1 个发送结果待确认'
    }
  ])('keeps actionable recent $name visible in both queue summaries', async ({ recent, summary }) => {
    installApi('stopped', { snapshot: { recent } })
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    expect(await screen.findAllByText(summary)).toHaveLength(1)
    expect(screen.queryByText('队列为空')).toBeNull()
  })

  it('confirms an uncertain delivery through the real command and removes it from the actionable summary', async () => {
    const unconfirmed = recentTask('delivery', 'delivery_unconfirmed', {
      failureStage: 'verification_postsend',
      reason: 'outbound_not_verified'
    })
    const confirmedSnapshot: OmniMindSnapshot = {
      runtimeState: 'stopped',
      waiting: [],
      recent: [recentTask('delivery', 'sent')]
    }
    const { confirmDelivery, retryTask, sendGeneratedReply } = installApi('stopped', {
      snapshot: { recent: [unconfirmed] },
      confirmDeliverySnapshot: confirmedSnapshot
    })
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    expect(await screen.findByText('1 个失败待处理 · 其中 1 个发送结果待确认')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认送达' }))

    await waitFor(() => expect(confirmDelivery).toHaveBeenCalledWith('delivery'))
    expect(retryTask).not.toHaveBeenCalled()
    expect(sendGeneratedReply).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('1 个失败待处理 · 其中 1 个发送结果待确认')).toBeNull())
    expect(screen.getByText('队列为空')).toBeTruthy()
  })

  it('restores focus to the actual queue recovery opener after settings closes', async () => {
    installApi('stopped', { snapshot: { recent: [recentTask('recover', 'send_failed', { failureStage: 'runtime_logging', reason: 'unknown_failure' })] } })
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    const recoveryOpener = await screen.findByRole('button', { name: '检查托管状态' })
    fireEvent.click(recoveryOpener)
    expect(await screen.findByRole('dialog', { name: 'AI 托管与自动化设置' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }))
    await waitFor(() => expect(document.activeElement).toBe(recoveryOpener))
  })

  it('opens the complete permission center directly and restores focus to the start button on close', async () => {
    installApi('stopped', { permissions: { accessibility: 'denied', automation: 'not_requested' } })
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    const startOpener = await screen.findByRole('button', { name: '开始托管' }) as HTMLButtonElement
    await waitFor(() => expect(startOpener.disabled).toBe(false))
    fireEvent.click(startOpener)
    expect(await screen.findByRole('dialog', { name: 'AI 托管与自动化设置' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '辅助功能' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '自动化（Apple Events）' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '开启自动托管前' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }))
    await waitFor(() => expect(document.activeElement).toBe(startOpener))
  })

  it('requires a separate confirmation before ending hosting', async () => {
    const { disable } = installApi('running')
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    fireEvent.click(await screen.findByRole('button', { name: '结束托管' }))
    expect(disable).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '结束自动托管？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认结束托管' }))
    await waitFor(() => expect(disable).toHaveBeenCalledOnce())
  })

  it('uses authoritative pause and resume commands without creating a local paused flag', async () => {
    const running = installApi('running')
    useAppStore.setState({ isDbConnected: true })

    const { unmount } = render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)
    fireEvent.click(await screen.findByRole('button', { name: '暂停托管' }))
    await waitFor(() => expect(running.pause).toHaveBeenCalledOnce())
    unmount()

    const paused = installApi('paused')
    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)
    const resumeButton = await screen.findByRole('button', { name: '继续托管' }) as HTMLButtonElement
    await waitFor(() => expect(resumeButton.disabled).toBe(false))
    fireEvent.click(resumeButton)
    await waitFor(() => expect(paused.resume).toHaveBeenCalledOnce())
    expect(paused.pause).not.toHaveBeenCalled()
  })

  it('routes degraded recovery to settings and never sends an invalid pause command', async () => {
    const { pause } = installApi('degraded')
    useAppStore.setState({ isDbConnected: true })

    render(<div id="root"><MemoryRouter><HomePage /></MemoryRouter></div>)

    fireEvent.click(await screen.findByRole('button', { name: '检查托管设置' }))
    expect(await screen.findByRole('dialog', { name: 'AI 托管与自动化设置' })).toBeTruthy()
    expect(pause).not.toHaveBeenCalled()
  })
})
