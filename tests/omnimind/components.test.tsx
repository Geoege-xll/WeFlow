// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindSnapshot } from '../../shared/omnimind/contracts'
import { OmniMindHostingActiveModal } from '../../src/features/omnimind/OmniMindHostingActiveModal'
import { OmniMindHostingSettingsModal } from '../../src/features/omnimind/OmniMindHostingSettingsModal'
import { useOmniMind } from '../../src/features/omnimind/useOmniMind'
import { OmniMindQueuePanel } from '../../src/features/omnimind/OmniMindQueuePanel'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(cleanup)

const v2Settings = { schemaVersion: 4 as const, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, hasApiKey: true, batchWindowMs: 2000 }

describe('OmniMind React behavior', () => {
  it('keeps every R6 runtime, empty, error, and delayed-loading state observable', async () => {
    const runtimeMatrix = [
      ['stopped', '自动托管已停止', '自动托管已停止', false, false],
      ['validating', '正在验证设置', '正在验证设置，队列保持可见。', false, true],
      ['starting', '正在启动监控', '正在启动监控，队列保持可见。', false, true],
      ['running', '自动托管运行中', '自动托管运行中，正在等待新消息', true, false],
      ['paused', '自动托管已暂停', '已暂停领取新任务；现有队列上下文继续保留。', true, false],
      ['degraded', '队列保留，自动接入受限', '队列已保留，等待自动接入恢复。', true, false],
      ['stopping', '正在安全停止', '正在安全停止，未发送任务会按现有规则处理。', false, true],
      ['failed', '启动失败', undefined, false, false]
    ] as const

    for (const [runtimeState, label, emptyLabel] of runtimeMatrix) {
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
      expect(screen.queryByRole('switch', { name: '自动托管' })).toBeNull()
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

  it('continues a paused runtime through resume and never falls back to enable', async () => {
    const enable = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn().mockResolvedValue({ runtimeState: 'running', waiting: [], recent: [] })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'paused', waiting: [], recent: [] }),
      getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable, pause, resume, disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })

    render(<OmniMindQueuePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '继续托管' }))

    await waitFor(() => expect(resume).toHaveBeenCalledOnce())
    expect(enable).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(await screen.findByText('自动托管运行中')).toBeTruthy()
  })

  it('updates the shared hook snapshot from pause, resume, and delivery confirmation results', async () => {
    const pause = vi.fn().mockResolvedValue({ runtimeState: 'paused', waiting: [], recent: [] })
    const resume = vi.fn().mockResolvedValue({ runtimeState: 'running', waiting: [], recent: [] })
    const confirmedSnapshot: OmniMindSnapshot = { runtimeState: 'running', waiting: [], recent: [{ id: 'delivery', sessionId: 's', sessionName: 'S', status: 'sent', createdAt: 1, updatedAt: 2 }] }
    const confirmDelivery = vi.fn().mockResolvedValue(confirmedSnapshot)
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'running', waiting: [], recent: [] }),
      getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), pause, resume, disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn(), confirmDelivery
    } } })
    const { result } = renderHook(() => useOmniMind())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.pause() })
    expect(result.current.snapshot.runtimeState).toBe('paused')
    await act(async () => { await result.current.resume() })
    expect(result.current.snapshot.runtimeState).toBe('running')
    await act(async () => { await result.current.confirmDelivery('delivery') })
    expect(result.current.snapshot).toEqual(confirmedSnapshot)
    expect(pause).toHaveBeenCalledOnce()
    expect(resume).toHaveBeenCalledOnce()
    expect(confirmDelivery).toHaveBeenCalledWith('delivery')
  })

  it('does not expose queue transport identifiers or unauthorized hidden reply text', async () => {
    const snapshot: OmniMindSnapshot = {
      runtimeState: 'running',
      waiting: [{
        id: 'task-public-id', accountId: 'secret-account-id', sessionId: 'secret-session-id', sessionName: '可见会话',
        messageKeys: ['m-key'], text: '公开提问', status: 'queued', createdAt: 1, updatedAt: 1
      }],
      recent: [{
        id: 'task-secret-id', accountId: 'secret-account-id', sessionId: 'secret-session-id', sessionName: '秘密会话',
        messageKeys: ['m-key-2'], text: '系统解析回复', status: 'queued', createdAt: 2, updatedAt: 2
      }]
    }
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => snapshot, getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })

    const { container } = render(<OmniMindQueuePanel />)
    await screen.findByText('可见会话')
    expect(container.textContent).not.toContain('task-public-id')
    expect(container.textContent).not.toContain('task-secret-id')
    expect(container.textContent).not.toContain('secret-account-id')
    expect(container.textContent).not.toContain('secret-session-id')
    expect(container.textContent).not.toContain('已捕获回复草稿')
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    expect(screen.queryByRole('button', { name: '放弃' })).toBeNull()
  })

  it('stops running hosting before saving critical settings', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'running', waiting: [], recent: [] }),
      getSettings: async () => v2Settings,
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings, cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })

    render(<OmniMindHostingSettingsModal settings={v2Settings} running={true} onSave={saveSettings} onClose={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Base URL'), { target: { value: 'http://localhost:8001' } })

    expect(screen.getByText(/运行中保存关键设置会停止托管/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '停止托管并保存' })).toBeTruthy()
  })

  it('uses the existing disable command when hosting is stopped from active modal', async () => {
    const disable = vi.fn().mockResolvedValue({ runtimeState: 'stopped', waiting: [], recent: [] })
    render(<OmniMindHostingActiveModal onStop={disable} />)
    fireEvent.click(screen.getByRole('button', { name: '停止托管' }))
    await waitFor(() => expect(disable).toHaveBeenCalledOnce())
  })

  it('renders the permanent R6 workbench hierarchy and preserves every task command', async () => {
    const now = Date.now()
    const task = (id: string, sessionName: string, status: 'generating' | 'queued' | 'awaiting_manual_send' | 'send_failed') => ({
      id, accountId: 'account-1', sessionId: `session-${id}`, sessionName, messageKeys: [`key-${id}`],
      text: `Task message ${id}`, status, failureStage: status === 'send_failed' ? ('delivery' as const) : undefined,
      reason: status === 'send_failed' ? ('unconfirmed' as const) : undefined, replyText: status === 'send_failed' ? 'Draft reply text' : undefined,
      createdAt: now, updatedAt: now
    })
    const snapshot: OmniMindSnapshot = {
      runtimeState: 'running',
      current: task('current', '林晓', 'generating'),
      waiting: [task('queued', '研发群', 'queued')],
      awaitingManualSend: [task('awaiting', '运营协同', 'awaiting_manual_send')],
      recent: [task('recent', '微信支付', 'send_failed')]
    }
    const cancelTask = vi.fn().mockResolvedValue(snapshot)
    const retryTask = vi.fn().mockResolvedValue(snapshot)
    const sendGeneratedReply = vi.fn().mockResolvedValue(snapshot)
    const abandonGeneratedReply = vi.fn().mockResolvedValue(snapshot)
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => snapshot, getSettings: async () => v2Settings,
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
    expect(screen.queryByRole('switch', { name: '自动托管' })).toBeNull()
    expect(screen.queryByRole('button', { name: '自动托管设置' })).toBeNull()
    expect(container.querySelector('[aria-label="当前 1"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="等待 1"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="待确认 1"]')).toBeTruthy()

    const headings = Array.from(container.querySelectorAll('.omnimind-queue-section > h3')).map((heading) => heading.textContent)
    expect(headings).toEqual(['当前任务 · 1', '等待你发送 · 1', '等待队列 · 1', '最近结果 · 1'])
    expect(container.querySelector('[aria-label*="折叠"], [aria-label*="收起队列"], [aria-label*="抽屉"]')).toBeNull()
    expect(container.querySelector('.omnimind-queue-section.current .omnimind-task.status-generating')).toBeTruthy()
    expect(container.querySelector('.omnimind-queue-section.awaiting .omnimind-task.status-awaiting_manual_send')).toBeTruthy()
    expect(container.querySelector('.omnimind-queue-section.recent .omnimind-task.status-send_failed')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[0])
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(sendGeneratedReply).toHaveBeenCalledWith('awaiting'))
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    await waitFor(() => {
      expect(cancelTask).toHaveBeenCalledWith('current')
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

  it('keeps the settings dialog open and resets the saved baseline after a successful save', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<OmniMindHostingSettingsModal
      settings={v2Settings}
      running={false} onSave={onSave} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://localhost:8001' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'AI 托管与自动化设置' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('preserves edits made while an earlier save transaction is still pending', async () => {
    const pendingSave = deferred<void>()
    const onSave = vi.fn(() => pendingSave.promise)
    const onSaved = vi.fn()
    const Host = () => {
      const [open, setOpen] = useState(true)
      return open
        ? <OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={onSave} onClose={vi.fn()} onSaved={(critical) => { onSaved(critical); setOpen(false) }} />
        : <p>宿主已关闭</p>
    }
    render(<Host />)

    const endpoint = screen.getByLabelText('Base URL') as HTMLInputElement
    fireEvent.change(endpoint, { target: { value: 'http://localhost:8001' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ pythonBaseUrl: 'http://localhost:8001/api/v1/open' })))

    fireEvent.change(endpoint, { target: { value: 'http://localhost:8002' } })
    await act(async () => pendingSave.resolve())

    expect(endpoint.value).toBe('http://localhost:8002')
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'AI 托管与自动化设置' })).toBeTruthy()
    expect(screen.queryByText('宿主已关闭')).toBeNull()
  })

  it('clears the submitted Key after save while preserving a later endpoint edit', async () => {
    const pendingSave = deferred<void>()
    const onSaved = vi.fn()
    const secret = 'submitted-secret'
    const { container } = render(<OmniMindHostingSettingsModal
      settings={{ ...v2Settings, hasApiKey: false }}
      running={false}
      onSave={() => pendingSave.promise}
      onSaved={onSaved}
      onClose={vi.fn()}
    />)
    const key = screen.getByLabelText('新 API Key') as HTMLInputElement
    fireEvent.change(key, { target: { value: secret } })
    fireEvent.click(screen.getByRole('button', { name: '显示草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://localhost:8200' } })

    await act(async () => pendingSave.resolve())

    expect(key.value).toBe('')
    expect(key.type).toBe('password')
    expect(container.textContent).not.toContain(secret)
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('retains only a Key that was entered after the pending save transaction began', async () => {
    const pendingSave = deferred<void>()
    const onSaved = vi.fn()
    render(<OmniMindHostingSettingsModal
      settings={{ ...v2Settings, hasApiKey: false }}
      running={false}
      onSave={() => pendingSave.promise}
      onSaved={onSaved}
      onClose={vi.fn()}
    />)
    const key = screen.getByLabelText('新 API Key') as HTMLInputElement
    fireEvent.change(key, { target: { value: 'first-submitted-key' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    fireEvent.change(key, { target: { value: 'new-unsaved-key' } })

    await act(async () => pendingSave.resolve())

    expect(key.value).toBe('new-unsaved-key')
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('invalidates an in-flight connection test immediately when endpoint or Key input changes', async () => {
    const endpointAttempt = deferred<{ success: boolean; latencyMs?: number }>()
    const keyAttempt = deferred<{ success: boolean; latencyMs?: number }>()
    const testConnection = vi.fn()
      .mockImplementationOnce(() => endpointAttempt.promise)
      .mockImplementationOnce(() => keyAttempt.promise)
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { testConnection } } })
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }))
    await waitFor(() => expect(testConnection).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://new.example.com' } })
    await act(async () => endpointAttempt.resolve({ success: true, latencyMs: 9 }))
    expect(screen.queryByText(/端点连接正常/)).toBeNull()
    expect(document.body.textContent).not.toContain('协议: HTTPS')

    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }))
    await waitFor(() => expect(testConnection).toHaveBeenCalledTimes(2))
    fireEvent.change(screen.getByLabelText('新 API Key'), { target: { value: 'replacement-key' } })
    await act(async () => keyAttempt.resolve({ success: true, latencyMs: 7 }))
    expect(screen.queryByText(/端点连接正常/)).toBeNull()
    expect(document.body.textContent).not.toContain('响应延迟 7ms')
  })

  it('does not write an in-flight connection result after the modal unmounts', async () => {
    const pending = deferred<{ success: boolean }>()
    const testConnection = vi.fn(() => pending.promise)
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { testConnection } } })
    const { unmount } = render(<OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }))
    await waitFor(() => expect(testConnection).toHaveBeenCalledOnce())
    unmount()
    await act(async () => pending.resolve({ success: true }))
    expect(screen.queryByText(/端点连接正常/)).toBeNull()
  })

  it('completes a deferred save normally under React.StrictMode', async () => {
    const pending = deferred<void>()
    render(<StrictMode><OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={() => pending.promise} onClose={vi.fn()} /></StrictMode>)
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://localhost:8300' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(screen.getByRole('button', { name: '正在保存…' })).toBeTruthy()

    await act(async () => pending.resolve())

    await waitFor(() => expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('completes a deferred connection test normally under React.StrictMode', async () => {
    const pending = deferred<{ success: boolean }>()
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { testConnection: () => pending.promise } } })
    render(<StrictMode><OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} /></StrictMode>)
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }))
    expect(screen.getByRole('button', { name: '正在测试…' })).toBeTruthy()

    await act(async () => pending.resolve({ success: true }))

    expect(await screen.findByText('🟢 端点连接正常')).toBeTruthy()
    expect(screen.getByRole('button', { name: /测试连接/ })).toBeTruthy()
  })

  it('completes a deferred clear-Key command normally under React.StrictMode', async () => {
    const pending = deferred<void>()
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { clearApiKey: () => pending.promise } } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<StrictMode><OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} /></StrictMode>)
    fireEvent.click(screen.getByRole('button', { name: '清除已保存 Key' }))
    expect((screen.getByRole('button', { name: '清除已保存 Key' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => pending.resolve())

    expect((await screen.findByRole('status')).textContent).toContain('API Key 已清除')
    expect(screen.queryByRole('button', { name: '清除已保存 Key' })).toBeNull()
  })

  it('never echoes a saved Key and keeps the success confirmation until the next field edit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const secretDraft = 'test-only-secret-value'
    const { container } = render(<OmniMindHostingSettingsModal
      settings={{ ...v2Settings, hasApiKey: false }}
      running={false} onSave={onSave} onClose={vi.fn()} />)

    const input = screen.getByLabelText('新 API Key') as HTMLInputElement
    fireEvent.change(input, { target: { value: secretDraft } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await screen.findByText('API Key 已安全保存 · 内容不会回显')
    expect(input.value).toBe('')
    expect(input.type).toBe('password')
    expect(container.textContent).not.toContain(secretDraft)
    expect(screen.getByText('已安全配置')).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://localhost:8001' } })
    expect(screen.queryByText('API Key 已安全保存 · 内容不会回显')).toBeNull()
  })

  it('preserves the configured-Key state when a replacement save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('save_failed'))
    render(<OmniMindHostingSettingsModal
      settings={v2Settings}
      running={false} onSave={onSave} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('新 API Key'), { target: { value: 'failed-replacement' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await screen.findByText('设置保存失败，请重试。')
    expect(screen.getByText('已安全配置')).toBeTruthy()
    expect(screen.queryByText('未配置')).toBeNull()
  })

  it('keeps all tab relationships resolvable and traps focus in DOM order', async () => {
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} />)

    const tabs = screen.getAllByRole('tab')
    const connectionTab = screen.getByRole('tab', { name: '连接与凭据' })
    const close = screen.getByRole('button', { name: '关闭设置' })
    expect(tabs.map((item) => item.textContent)).toEqual(['连接与凭据', '托管范围', '回复与时序', '权限中心'])
    expect(document.getElementById('omnimind-tab-strategy')).toBeNull()
    expect(document.getElementById('omnimind-tab-timing')).toBeNull()
    expect(document.getElementById('omnimind-panel-strategy')).toBeNull()
    expect(document.getElementById('omnimind-panel-timing')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(connectionTab))
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls')
      expect(panelId).toMatch(/^omnimind-panel-/)
      const panel = document.getElementById(panelId as string) as HTMLElement
      expect(panel).not.toBeNull()
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
      expect(panel.hidden).toBe(tab !== connectionTab)
    }

    // 四标签遵循 ARIA 手动激活模式：方向键循环，Home/End 定位首尾，焦点与选中态同步。
    fireEvent.keyDown(connectionTab, { key: 'End' })
    const permissionsTab = screen.getByRole('tab', { name: '权限中心' })
    expect(document.activeElement).toBe(permissionsTab)
    expect(permissionsTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(permissionsTab, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(connectionTab)
    fireEvent.keyDown(connectionTab, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(permissionsTab)
    fireEvent.keyDown(permissionsTab, { key: 'Home' })
    expect(document.activeElement).toBe(connectionTab)
    fireEvent.keyDown(connectionTab, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '托管范围' }))
    fireEvent.click(connectionTab)
    connectionTab.focus()

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
    const onClose = vi.fn()
    render(<OmniMindHostingSettingsModal settings={settings} running={false} onSave={vi.fn()} onClose={onClose} />)
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
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('uses the approved large safe-viewport shell with sticky chrome and divider-free pill tabs', () => {
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} />)
    const styles = readFileSync(resolve(process.cwd(), 'src/features/omnimind/omnimind.scss'), 'utf8')
    expect(screen.getAllByRole('tab')).toHaveLength(4)
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

    fireEvent.click(screen.getByRole('tab', { name: '回复与时序' }))
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

  it('does not save a legacy selected official account because exclusion is a permanent invariant', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const settings = {
      ...v2Settings,
      managedScope: { mode: 'selected' as const, conversations: [
        { sessionId: 'gh_official-service', displayName: 'Service' },
        { sessionId: 'friend', displayName: 'Friend' }
      ] }
    }
    render(<OmniMindHostingSettingsModal settings={settings} running={false} onSave={onSave} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '托管范围' }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps reply mode and aggregation timing in one response panel without timeout or official-policy controls', () => {
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '回复与时序' }))
    const responsePanel = document.getElementById('omnimind-panel-response') as HTMLElement
    expect(responsePanel.hidden).toBe(false)
    expect(responsePanel.querySelector('#reply-mode-auto')).toBeTruthy()
    expect(responsePanel.querySelector('#reply-mode-review')).toBeTruthy()
    expect(responsePanel.querySelector('#omnimind-batch-window')).toBeTruthy()
    expect(responsePanel.querySelector('#omnimind-request-timeout')).toBeNull()
    expect(responsePanel.querySelector('#timeout-range')).toBeNull()
    expect(responsePanel.querySelector('#preset-timeout-default')).toBeNull()
    expect(responsePanel.querySelector('#reply-ignore-official')).toBeNull()
    expect(screen.queryByRole('switch', { name: '过滤官方账号' })).toBeNull()
  })

  it('routes invalid timing validation and its error-summary link to the response tab', async () => {
    render(<OmniMindHostingSettingsModal settings={v2Settings} running={false} onSave={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: '回复与时序' }))
    fireEvent.change(screen.getByLabelText('消息批处理窗口（秒）'), { target: { value: '0.1' } })
    fireEvent.click(screen.getByRole('tab', { name: '连接与凭据' }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    const errorLink = await screen.findByRole('link', { name: '消息聚合窗口必须在允许范围内。' })
    expect(errorLink.getAttribute('href')).toBe('#omnimind-tab-response')
    expect(screen.getByRole('tab', { name: '回复与时序' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: '回复与时序' })))
  })
})
