// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OMNIMIND_SETTING_RANGES, OMNIMIND_SETTINGS_DEFAULTS } from '../../shared/omnimind/settings-domain'
import { OmniMindHostingCenterDialog } from '../../src/features/omnimind/OmniMindQueuePanel'

afterEach(cleanup)

const settings = {
  schemaVersion: 4 as const,
  pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
  managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'alice', displayName: 'Alice' }] },
  autoSend: false,
  hasApiKey: true,
  batchWindowMs: 2000
}

const installApi = (initialPermissions = { accessibility: 'granted' as const, automation: 'granted' as const }) => {
  const enable = vi.fn().mockResolvedValue({ runtimeState: 'running', waiting: [], recent: [] })
  const disable = vi.fn().mockResolvedValue({ runtimeState: 'stopped', waiting: [], recent: [] })
  let permissions = initialPermissions
  const requestPermission = vi.fn().mockImplementation(async () => {
    permissions = { accessibility: 'granted', automation: 'granted' }
    return permissions
  })
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    omniMind: {
      getSnapshot: async () => ({ runtimeState: 'stopped', waiting: [], recent: [] }),
      getSettings: async () => settings,
      onSnapshotChanged: () => () => undefined,
      enable,
      disable,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      clearApiKey: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
      cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn(),
      getPermissions: vi.fn(async () => permissions),
      requestPermission,
      recheckPermission: vi.fn(async () => permissions),
      openPermissionSettings: vi.fn().mockResolvedValue(undefined),
      onPermissionsChanged: vi.fn(() => () => undefined)
    },
    permissions: { getStatus: vi.fn() }
  } })
  return { enable, disable, requestPermission }
}

describe('AI hosting center', () => {
  it('is the single dialog, embeds the queue, and starts only from its explicit action', async () => {
    const { enable, disable } = installApi()
    const onClose = vi.fn()
    const openerRef = createRef<HTMLButtonElement>()
    render(<><button ref={openerRef}>入口</button><OmniMindHostingCenterDialog open onClose={onClose} openerRef={openerRef} /></>)

    const dialog = await screen.findByRole('dialog', { name: 'AI 自动托管中心' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(dialog.querySelector('#omnimind-ai-queue')).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '概览与队列', '连接与凭据', '托管范围', '回复与时序', '权限中心'
    ])
    expect(document.getElementById('omnimind-center-tab-strategy')).toBeNull()
    expect(document.getElementById('omnimind-center-tab-timing')).toBeNull()
    expect(document.getElementById('omnimind-center-panel-strategy')).toBeNull()
    expect(document.getElementById('omnimind-center-panel-timing')).toBeNull()
    expect(enable).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '开启自动托管' }))
    await waitFor(() => expect(enable).toHaveBeenCalledOnce())
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '关闭（不停止）' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(disable).not.toHaveBeenCalled()
  })

  it('routes a missing permission directly to the permission center without the removed preflight card', async () => {
    const { enable, requestPermission } = installApi({ accessibility: 'not_requested', automation: 'not_requested' })
    render(<OmniMindHostingCenterDialog open onClose={vi.fn()} />)

    await screen.findByRole('dialog', { name: 'AI 自动托管中心' })
    fireEvent.click(screen.getByRole('button', { name: '开启自动托管' }))
    expect(enable).not.toHaveBeenCalled()

    const accessibility = await screen.findByRole('region', { name: '辅助功能' })
    expect(screen.getByRole('region', { name: '自动化（Apple Events）' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '开启自动托管前' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(accessibility))
    fireEvent.click(screen.getAllByRole('button', { name: '请求授权' })[0])
    await waitFor(() => expect(requestPermission).toHaveBeenCalledWith('accessibility'))
    expect(enable).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '开启自动托管' }))
    await waitFor(() => expect(enable).toHaveBeenCalledOnce())
  })

  it('requires a nested danger confirmation before stopping', async () => {
    const { disable } = installApi()
    Object.defineProperty(window.electronAPI.omniMind, 'getSnapshot', {
      configurable: true,
      value: async () => ({ runtimeState: 'running', waiting: [], recent: [] })
    })
    render(<OmniMindHostingCenterDialog open onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '停止托管…' }))
    expect(disable).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '停止自动托管？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认停止托管' }))
    await waitFor(() => expect(disable).toHaveBeenCalledOnce())
  })

  it('moves focus to the persistent overview tab after stopping succeeds', async () => {
    const { disable } = installApi()
    Object.defineProperty(window.electronAPI.omniMind, 'getSnapshot', {
      configurable: true,
      value: async () => ({ runtimeState: 'running', waiting: [], recent: [] })
    })
    render(<OmniMindHostingCenterDialog open onClose={vi.fn()} />)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: '概览与队列' })))
    fireEvent.click(await screen.findByRole('button', { name: '停止托管…' }))
    const confirmStop = screen.getByRole('button', { name: '确认停止托管' })
    // fireEvent.click 不会模拟浏览器的按钮聚焦；显式聚焦才能真实复现 opener 卸载后的失焦。
    confirmStop.focus()
    expect(document.activeElement).toBe(confirmStop)
    fireEvent.click(confirmStop)

    await waitFor(() => expect(disable).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '停止自动托管？' })).toBeNull())
    // 停止按钮会随运行态卸载，成功路径必须落到仍存在的中心导航控件。
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: '概览与队列' })))
  })

  it('renders the contracted response controls together and truthful connection facts', async () => {
    installApi()
    Object.defineProperty(window.electronAPI.omniMind, 'testConnection', {
      configurable: true,
      value: vi.fn().mockResolvedValue({ success: true })
    })
    render(<OmniMindHostingCenterDialog open onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'AI 自动托管中心' })

    fireEvent.click(screen.getByRole('tab', { name: '回复与时序' }))
    expect(screen.getByRole('button', { name: /全自动接管发送/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /人工审阅模式/ })).toBeTruthy()
    expect(screen.getByLabelText('消息批处理窗口（秒）')).toBeTruthy()
    expect(screen.queryByLabelText('请求超时（秒）')).toBeNull()
    expect(screen.queryByRole('switch', { name: '过滤官方账号' })).toBeNull()
    expect(document.querySelector('#reply-risk-filter')).toBeNull()
    expect(document.querySelector('#reply-model')).toBeNull()
    expect(document.body.textContent).not.toContain('敏感词与风险内容拦截')
    expect(document.body.textContent).not.toContain('底层 AI 思考模型')

    fireEvent.click(document.getElementById('omnimind-center-tab-connection') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }))
    await screen.findByText('🟢 端点连接正常')
    expect(document.body.textContent).toContain('协议: HTTP · Open Channel API v1 兼容')
    expect(document.body.textContent).not.toContain('42ms')
    expect(document.body.textContent).not.toContain('sk-')

    fireEvent.click(document.getElementById('omnimind-center-tab-response') as HTMLElement)
    expect(document.body.textContent).not.toContain('单请求超时处理')
    expect(document.body.textContent).not.toContain('模型生成超时时间')
    const batchRange = document.getElementById('batch-window-range') as HTMLInputElement
    const batchNumber = screen.getByLabelText('消息批处理窗口（秒）') as HTMLInputElement
    expect([batchRange.min, batchRange.max, batchRange.step]).toEqual([
      String(OMNIMIND_SETTING_RANGES.batchWindowMs.min),
      String(OMNIMIND_SETTING_RANGES.batchWindowMs.max),
      String(OMNIMIND_SETTING_RANGES.batchWindowMs.step)
    ])
    expect([batchNumber.min, batchNumber.max, batchNumber.step]).toEqual([
      String(OMNIMIND_SETTING_RANGES.batchWindowMs.min / 1000),
      String(OMNIMIND_SETTING_RANGES.batchWindowMs.max / 1000),
      String(OMNIMIND_SETTING_RANGES.batchWindowMs.step / 1000)
    ])
    expect(document.getElementById('timeout-range')).toBeNull()
    expect(document.getElementById('preset-timeout-default')).toBeNull()
    expect(document.body.textContent).not.toContain('熔断')
    expect(document.body.textContent).not.toContain('草稿箱')
    expect(document.body.textContent).not.toContain('连续超时 3 次')
  })

  it('keeps one settings modal instance and preserves dirty draft across outer hosting-center tabs', async () => {
    installApi()
    render(<OmniMindHostingCenterDialog open onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'AI 自动托管中心' })

    fireEvent.click(screen.getByRole('tab', { name: '连接与凭据' }))
    const endpoint = screen.getByLabelText('Base URL') as HTMLInputElement
    fireEvent.change(endpoint, { target: { value: 'http://localhost:8100' } })
    fireEvent.click(document.getElementById('omnimind-center-tab-response') as HTMLElement)
    fireEvent.click(document.getElementById('omnimind-center-tab-overview') as HTMLElement)
    fireEvent.click(document.getElementById('omnimind-center-tab-connection') as HTMLElement)

    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe('http://localhost:8100')
    fireEvent.click(screen.getByRole('button', { name: '关闭（不停止）' }))
    expect(screen.getByRole('alertdialog', { name: '放弃未保存的更改？' })).toBeTruthy()
  })
})
