// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindSnapshot } from '../../shared/omnimind/contracts'
import { OmniMindHostingSettingsModal } from '../../src/features/omnimind/OmniMindHostingSettingsModal'
import { useOmniMind } from '../../src/features/omnimind/useOmniMind'
import { OmniMindQueuePanel } from '../../src/features/omnimind/OmniMindQueuePanel'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(cleanup)

const v2Settings = { schemaVersion: 2 as const, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, ignoreOfficial: true, hasApiKey: true, batchWindowMs: 2000, requestTimeoutMs: 15000 }

describe('OmniMind React behavior', () => {
  it('keeps every R6 runtime, empty, error, and delayed-loading state observable', async () => {
    const runtimeMatrix = [
      ['stopped', '自动托管已停止', '自动托管已停止', false, false],
      ['validating', '正在验证设置', '正在验证设置，队列保持可见。', false, true],
      ['starting', '正在启动监控', '正在启动监控，队列保持可见。', false, true],
      ['running', '自动托管运行中', '自动托管运行中，正在等待新消息', true, false],
      ['degraded', '队列保留，自动接入受限', '队列已保留，等待自动接入恢复。', true, false],
      ['stopping', '正在安全停止', '正在安全停止，未发送任务会按现有规则处理。', false, true],
      ['failed', '启动失败', undefined, false, false]
    ] as const

    for (const [runtimeState, label, emptyLabel, checked, disabled] of runtimeMatrix) {
      Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
        getSnapshot: async () => ({ runtimeState, waiting: [], recent: [] }),
        getSettings: async () => v2Settings,
        onSnapshotChanged: () => () => undefined,
        enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
      } } })
      render(<OmniMindQueuePanel />)
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0)
      const queue = screen.getByRole('complementary', { name: 'OmniMind 托管' })
      expect(queue.classList).toContain(`runtime-${runtimeState}`)
      const hostingSwitch = screen.getByRole('switch', { name: '自动托管' }) as HTMLButtonElement
      expect(hostingSwitch.getAttribute('aria-checked')).toBe(String(checked))
      expect(hostingSwitch.disabled).toBe(disabled)
      if (emptyLabel) {
        expect(screen.getAllByText(emptyLabel).some((element) => element.classList.contains('omnimind-empty'))).toBe(true)
        expect(queue.querySelector('.omnimind-state-card.state-empty')).toBeTruthy()
      } else {
        const failedState = screen.getByRole('alert')
        expect(failedState.textContent).toContain('自动托管启动失败')
        expect(failedState.classList).toContain('state-failed')
      }
      if (runtimeState === 'degraded' || runtimeState === 'failed') {
        expect(screen.getByRole('button', { name: '检查自动托管设置' })).toBeTruthy()
      }
      if (runtimeState !== 'stopped') expect(screen.queryByText('自动托管已停止')).toBeNull()
      cleanup()
    }

    const reloadSnapshot = vi.fn().mockRejectedValue(new Error('snapshot_failed'))
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: reloadSnapshot, getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })
    render(<OmniMindQueuePanel />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('队列状态加载失败')
    expect(alert.classList).toContain('state-error')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(reloadSnapshot).toHaveBeenCalledTimes(2))
    cleanup()

    vi.useFakeTimers()
    try {
      const pending = new Promise<OmniMindSnapshot>(() => undefined)
      Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
        getSnapshot: () => pending, getSettings: async () => v2Settings,
        onSnapshotChanged: () => () => undefined,
        enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
      } } })
      render(<OmniMindQueuePanel />)
      expect(screen.queryByRole('status')).toBeNull()
      await act(async () => { vi.advanceTimersByTime(301) })
      const loadingState = screen.getByRole('status')
      expect(loadingState.textContent).toContain('正在加载 AI 队列…')
      expect(loadingState.classList).toContain('state-loading')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expose queue transport identifiers or unauthorized hidden reply text', async () => {
    const snapshot: OmniMindSnapshot = {
      runtimeState: 'running',
      waiting: [{
        id: 'task-public-id', accountId: 'secret-account-id', sessionId: 'secret-session-id', sessionName: '可见会话',
        messageKeys: ['secret-message-key'], text: 'secret-input-text', replyText: 'secret-waiting-reply',
        status: 'queued', createdAt: 1, updatedAt: 1
      }],
      recent: []
    }
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => snapshot, getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })

    const { container } = render(<OmniMindQueuePanel />)
    await screen.findByText('可见会话')
    const publicText = container.textContent || ''
    expect(publicText).not.toContain('secret-account-id')
    expect(publicText).not.toContain('secret-session-id')
    expect(publicText).not.toContain('secret-message-key')
    expect(publicText).not.toContain('secret-input-text')
    expect(publicText).not.toContain('secret-waiting-reply')
  })

  it('keeps degraded settings under the active-hosting critical-save guard', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'degraded', waiting: [], recent: [] }),
      getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })

    render(<OmniMindQueuePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '自动托管设置' }))
    fireEvent.change(await screen.findByLabelText('Base URL'), { target: { value: 'http://localhost:8001' } })

    expect(screen.getByText(/运行中保存关键设置会停止托管/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '停止托管并保存' })).toBeTruthy()
  })

  it('uses the existing disable command when degraded hosting is switched off', async () => {
    const enable = vi.fn()
    const disable = vi.fn().mockResolvedValue({ runtimeState: 'stopped', waiting: [], recent: [] })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'degraded', waiting: [], recent: [] }),
      getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable, disable, saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })

    render(<OmniMindQueuePanel />)
    fireEvent.click(await screen.findByRole('switch', { name: '自动托管' }))

    await waitFor(() => expect(disable).toHaveBeenCalledOnce())
    expect(enable).not.toHaveBeenCalled()
  })

  it('renders the permanent R6 workbench hierarchy and preserves every task command', async () => {
    const now = Date.now()
    const task = (id: string, sessionName: string, status: 'generating' | 'queued' | 'awaiting_manual_send' | 'send_failed') => ({
      id,
      sessionId: `session-${id}`,
      sessionName,
      status,
      createdAt: now,
      updatedAt: now
    })
    const snapshot: OmniMindSnapshot = {
      runtimeState: 'running',
      current: task('current', '当前会话', 'generating'),
      waiting: [task('waiting', '等待会话', 'queued')],
      awaitingManualSend: [{ ...task('awaiting', '待确认会话', 'awaiting_manual_send'), replyText: '已生成的安全回复', generatedAt: now, newMessagesSinceGenerated: 1 }],
      recent: [{ ...task('failed', '失败会话', 'send_failed'), replyText: '保留的失败回复', generatedAt: now, failureStage: 'verification_baseline', reason: 'verification_baseline_failed' }]
    }
    const cancelTask = vi.fn()
    const retryTask = vi.fn()
    const sendGeneratedReply = vi.fn().mockResolvedValue({ success: true })
    const abandonGeneratedReply = vi.fn()
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => snapshot,
      getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(),
      cancelTask, retryTask, sendGeneratedReply, abandonGeneratedReply
    } } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const { container } = render(<OmniMindQueuePanel />)
    const queue = await screen.findByRole('complementary', { name: 'OmniMind 托管' })
    expect(queue.id).toBe('omnimind-ai-queue')
    expect(queue.classList).toContain('runtime-running')
    expect(screen.getByRole('heading', { name: '自动托管' })).toBeTruthy()
    expect(screen.getByText('自动托管运行中')).toBeTruthy()
    expect(screen.getByText('全局串行队列')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '自动托管' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: '自动托管设置' })).toBeTruthy()
    expect(screen.getByLabelText('当前 1')).toBeTruthy()
    expect(screen.getByLabelText('等待 1')).toBeTruthy()
    expect(screen.getByLabelText('待确认 1')).toBeTruthy()

    const headings = Array.from(container.querySelectorAll('.omnimind-queue-section > h3')).map((heading) => heading.textContent)
    expect(headings).toEqual(['当前任务 · 1', '等待你发送 · 1', '等待队列 · 1', '最近结果 · 1'])
    expect(container.querySelector('[aria-label*="折叠"], [aria-label*="收起队列"], [aria-label*="抽屉"]')).toBeNull()
    expect(container.querySelector('.omnimind-queue-section.current .omnimind-task.status-generating')).toBeTruthy()
    expect(container.querySelector('.omnimind-queue-section.awaiting .omnimind-task.status-awaiting_manual_send')).toBeTruthy()
    expect(container.querySelector('.omnimind-queue-section.recent .omnimind-task.status-send_failed')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[0])
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }))
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(sendGeneratedReply).toHaveBeenCalledWith('awaiting'))
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    await waitFor(() => {
      expect(cancelTask).toHaveBeenCalledWith('current')
      expect(retryTask).toHaveBeenCalledWith('failed')
      expect(abandonGeneratedReply).toHaveBeenCalledWith('awaiting')
    })
  })

  it('does not let a late initial snapshot overwrite a newer live event', async () => {
    const initial = deferred<OmniMindSnapshot>()
    let listener: ((snapshot: OmniMindSnapshot) => void) | undefined
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: () => initial.promise,
      getSettings: async () => v2Settings,
      onSnapshotChanged: (next: typeof listener) => { listener = next; return () => { listener = undefined } }
    } } })
    const { result } = renderHook(() => useOmniMind())
    const live: OmniMindSnapshot = { runtimeState: 'running', waiting: [], recent: [] }
    act(() => listener?.(live))
    await act(async () => initial.resolve({ runtimeState: 'stopped', waiting: [], recent: [] }))
    await waitFor(() => expect(result.current.snapshot.runtimeState).toBe('running'))
  })

  it('validates the endpoint on blur, focuses the first error, and permits save retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('save_failed')).mockResolvedValueOnce(undefined)
    render(<OmniMindHostingSettingsModal
      settings={v2Settings}
      running={false} onSave={onSave} onClose={vi.fn()} />)
    const endpoint = screen.getByLabelText('Base URL')
    fireEvent.change(endpoint, { target: { value: 'http://remote.example' } })
    fireEvent.blur(endpoint)
    expect(screen.getByRole('alert').textContent).toContain('本机 HTTP 或远端 HTTPS')
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(document.activeElement).toBe(endpoint)
    fireEvent.change(endpoint, { target: { value: 'http://127.0.0.1:8000/api/v1/open' } })
    fireEvent.blur(endpoint)
    fireEvent.change(endpoint, { target: { value: 'http://localhost:8001' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置保存失败，请重试。')
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
  })

  it('closes the settings dialog after a successful save', async () => {
    const onClose = vi.fn()
    render(<OmniMindHostingSettingsModal
      settings={v2Settings}
      running={false} onSave={vi.fn().mockResolvedValue(undefined)} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://localhost:8001' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('keeps all tab relationships resolvable and traps focus in DOM order', async () => {
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} />)

    const tabs = screen.getAllByRole('tab')
    const connectionTab = screen.getByRole('tab', { name: '连接与凭据' })
    const close = screen.getByRole('button', { name: '关闭设置' })
    await waitFor(() => expect(document.activeElement).toBe(connectionTab))
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls')
      expect(panelId).toMatch(/^omnimind-panel-/)
      const panel = document.getElementById(panelId as string) as HTMLElement
      expect(panel).not.toBeNull()
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
      expect(panel.hidden).toBe(tab !== connectionTab)
    }

    const user = userEvent.setup()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(close)
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://localhost:8001' } })
    close.focus()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '保存设置' }))
    await user.tab()
    expect(document.activeElement).toBe(close)
  })

  it('uses an accessible discard dialog for dirty Escape and restores focus to the settings trigger', async () => {
    const settings = v2Settings
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'stopped', waiting: [], recent: [] }), getSettings: async () => settings,
      onSnapshotChanged: () => () => undefined, enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })
    const confirm = vi.spyOn(window, 'confirm')
    render(<OmniMindQueuePanel />)
    const trigger = await screen.findByRole('button', { name: '自动托管设置' })
    fireEvent.click(trigger)
    const close = await screen.findByRole('button', { name: '关闭设置' })
    expect(screen.getByRole('dialog').closest('.omnimind-queue-panel')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '连接与凭据' }))
    fireEvent.change(screen.getByLabelText('新 API Key'), { target: { value: 'replacement' } })
    close.focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(confirm).not.toHaveBeenCalled()
    const discardDialog = screen.getByRole('alertdialog', { name: '放弃未保存的更改？' })
    const settingsDialog = document.querySelector<HTMLElement>('.omnimind-settings-modal')
    expect(settingsDialog?.getAttribute('aria-hidden')).toBe('true')
    expect(settingsDialog?.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '继续编辑' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(close))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(discardDialog.isConnected).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '放弃更改' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('uses the approved large safe-viewport shell with sticky chrome and divider-free pill tabs', () => {
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} />)
    const styles = readFileSync(resolve(process.cwd(), 'src/features/omnimind/omnimind.scss'), 'utf8')
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(styles).toMatch(/\.omnimind-settings-modal\s*\{[^}]*width:\s*min\(880px,\s*calc\(100vw - 64px\)\)[^}]*height:\s*min\(720px,\s*calc\(100vh - 64px\)\)[^}]*border-radius:\s*16px/s)
    expect(styles).toMatch(/\.omnimind-settings-modal header[^}]*position:\s*sticky/s)
    expect(styles).toMatch(/\.omnimind-settings-modal footer[^}]*position:\s*sticky/s)
    expect(styles).not.toMatch(/\.omnimind-settings-layout nav\s*\{[^}]*border-right:/s)
    expect(styles).toMatch(/\[role='tab'\]\[aria-selected='true'\][^}]*border-radius:/s)
  })

  it('constrains the active settings panel to a real scrolling grid track', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/features/omnimind/omnimind.scss'), 'utf8')
    expect(styles).toMatch(/\.omnimind-settings-panels\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s)
    expect(styles).toMatch(/\.omnimind-settings-panel\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/s)
    expect(styles).toMatch(/\.omnimind-settings-panel\[hidden\]\s*\{[^}]*display:\s*none/s)
  })

  it('saves a general-only change while running without a critical-stop confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<OmniMindHostingSettingsModal
      settings={v2Settings}
      running={true} onSave={onSave} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '时序与超时' }))
    fireEvent.change(screen.getByLabelText('消息批处理窗口（秒）'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ batchWindowMs: 2500 }))
  })

  it('clears a saved key immediately through its dedicated IPC', async () => {
    const clearApiKey = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { clearApiKey } } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={true} onSave={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '清除已保存 Key' }))
    await waitFor(() => expect(clearApiKey).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status').textContent).toContain('已清除')
  })

  it('normalizes an equivalent endpoint before deciding whether a running save is critical', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={true} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://127.0.0.1:8000/' } })
    expect(screen.queryByText(/运行中保存关键设置/)).toBeNull()
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('accepts the shared-contract IPv6 loopback endpoint in the settings UI', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<OmniMindHostingSettingsModal
      settings={v2Settings}
      running={false} onSave={onSave} onClose={vi.fn()} />)

    const endpoint = screen.getByLabelText('Base URL')
    fireEvent.change(endpoint, { target: { value: 'http://[::1]:8000/api/v1/open' } })
    fireEvent.blur(endpoint)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  })

  it('does not save selected official accounts before the exclusion difference is explicitly confirmed', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const settings = {
      ...v2Settings,
      managedScope: { mode: 'selected' as const, conversations: [
        { sessionId: 'official-service', displayName: 'Service' },
        { sessionId: 'friend', displayName: 'Friend' }
      ] },
      ignoreOfficial: false
    }
    render(<OmniMindHostingSettingsModal settings={settings} running={false} onSave={onSave} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '回复策略' }))
    fireEvent.click(screen.getByRole('switch', { name: '过滤官方账号' }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    expect(onSave).not.toHaveBeenCalled()
  })
})
