// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindFailureStage, OmniMindSnapshot } from '../../shared/omnimind/contracts'
import { OmniMindManualMessageComposer } from '../../src/features/omnimind/OmniMindManualMessageComposer'
import { OmniMindQueuePanel } from '../../src/features/omnimind/OmniMindQueuePanel'
import { OmniMindQueueTaskItem } from '../../src/features/omnimind/OmniMindQueueTaskItem'
import { buildQueueViewModel } from '../../src/features/omnimind/OmniMindQueueViewModel'
import { useOmniMindComposerAccountReadiness } from '../../src/features/omnimind/useOmniMindComposerAccountReadiness'
import {
  getManualComposerState,
  resetManualComposerStoreForTests,
  sendManualComposerText,
  subscribeManualComposerState,
  updateManualComposerState
} from '../../src/features/omnimind/manualComposerStore'
import { OMNIMIND_OPEN_SETTINGS_EVENT, requestOmniMindSettings, type OmniMindOpenSettingsDetail } from '../../src/features/omnimind/recoveryActions'

afterEach(() => { cleanup(); resetManualComposerStoreForTests() })

const taskFor = (failureStage: OmniMindFailureStage, reason: string, status: 'generation_failed' | 'send_failed' | 'delivery_unconfirmed' = 'send_failed') => {
  const snapshot: OmniMindSnapshot = {
    runtimeState: 'running',
    waiting: [],
    recent: [{
      id: `task-${reason}`,
      sessionId: 'private-session',
      sessionName: '可见会话',
      status,
      createdAt: 1,
      updatedAt: 1,
      generatedAt: 1,
      replyText: '保留的回复草稿',
      failureStage,
      reason
    }]
  }
  return buildQueueViewModel(snapshot).recent[0]
}

const renderTask = (task: ReturnType<typeof taskFor>) => {
  const onRetry = vi.fn()
  const onSend = vi.fn()
  const onConfirmDelivery = vi.fn()
  const onInspectConversation = vi.fn<(sessionId: string) => void>()
  const onOpenHostingSettings = vi.fn()
  const { container } = render(<OmniMindQueueTaskItem
    task={task}
    onCancel={vi.fn()}
    onRetry={onRetry}
    onSend={onSend}
    onAbandon={vi.fn()}
    onConfirmDelivery={onConfirmDelivery}
    onInspectConversation={onInspectConversation}
    onOpenHostingSettings={onOpenHostingSettings}
  />)
  return { container, onRetry, onSend, onConfirmDelivery, onInspectConversation, onOpenHostingSettings }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const identityFor = (sessionId: string, accountId = 'account-a') => ({ accountId, sessionId })

const AccountReadinessHarness = ({ readAccountId }: { readAccountId: () => Promise<unknown> }) => {
  const readiness = useOmniMindComposerAccountReadiness()
  const connect = (): void => {
    const request = readiness.beginConnect()
    void readAccountId()
      .then((value) => readiness.completeConnect(request, value))
      .catch(() => readiness.failConnect(request))
  }
  return <div>
    <button type="button" onClick={connect}>connect account</button>
    {readiness.accountId && <OmniMindManualMessageComposer accountId={readiness.accountId} sessionId="shared-session" />}
  </div>
}

describe('OmniMind privacy-safe failure reasons', () => {
  it.each([
    ['timeout', 'Python 服务端未在生成时限内返回，但请求可能已经执行。'],
    ['auth', 'Python 服务端拒绝了当前 API Key。'],
    ['network', 'OmniMindWeChat 无法从 Python 服务端取得有效回复。'],
    ['malformed', 'Python 服务端返回了 OmniMindWeChat 无法解析的结果。'],
    ['empty', 'Python 服务端已返回，但没有可发送的文本。'],
    ['handoff', 'Python 服务端已判定本次对话不应自动回复。'],
    ['generation_exception', 'OmniMindWeChat 调用 Python 生成服务时发生内部异常。']
  ] as const)('maps generation %s to a detailed privacy-safe fact', (reason, fact) => {
    const { container } = renderTask(taskFor('generation', reason, 'generation_failed'))
    expect(screen.getByText(fact)).toBeTruthy()
    expect(container.textContent).not.toContain(reason)
    cleanup()
  })

  it('marks generation timeout uncertain and renders no retry action', () => {
    const task = taskFor('generation', 'timeout', 'generation_failed')
    expect(task.failure).toMatchObject({ canRetry: false, uncertain: true })
    const { onRetry } = renderTask(task)
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    expect(screen.getByText(/不要直接重试/)).toBeTruthy()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it.each([
    ['verification_baseline', 'verification_baseline_failed', '无法读取发送前的微信消息记录。尚未执行微信发送。', '确认 OmniMindWeChat 能读取当前会话后，再重新检查。'],
    ['automation', 'accessibility_permission_denied', 'OmniMindWeChat 没有控制微信所需的辅助功能权限。尚未发送。', '打开权限中心的辅助功能卡片，并按提示恢复。'],
    ['automation', 'automation_permission_denied', 'OmniMindWeChat 没有控制微信界面所需的自动化权限。尚未发送。', '打开权限中心的自动化卡片，并按提示恢复。'],
    ['authorization', 'automation_permission_denied', 'OmniMindWeChat 没有控制微信界面所需的自动化权限。尚未发送。', '打开权限中心的自动化卡片，并按提示恢复。'],
    ['automation', 'target_ambiguous', '找到多个匹配会话，无法安全确定发送目标。尚未发送。', '在微信中只保留并打开正确会话，再重试。'],
    ['automation', 'target_mismatch', '当前微信会话与任务目标不一致。尚未发送。', '切换到正确会话并确认标题后，再重试。'],
    ['automation', 'wechat_process_unavailable', '当前未找到微信进程，尚未发送。', '请打开微信并保持桌面版窗口可见，再重试。'],
    ['automation', 'wechat_window_unavailable', '微信当前没有可操作窗口，尚未发送。', '请打开并解锁微信主窗口，再重试。'],
    ['automation', 'search_open_failed', '无法打开微信搜索界面，尚未发送。', '请确认微信主窗口处于前台，再重试。'],
    ['automation', 'search_field_unavailable', '无法定位可用的微信搜索框，尚未发送。', '请确认微信主窗口已显示搜索框，再重试。'],
    ['automation', 'search_field_ambiguous', '找到多个微信搜索框，无法安全确定操作目标。尚未发送。', '请关闭多余微信窗口并恢复标准布局，再重试。'],
    ['automation', 'search_input_failed', '微信搜索框无法接收会话标题，尚未发送。', '请手动点击搜索框并确认可输入，再重试。'],
    ['automation', 'search_result_click_failed', '找到目标会话但点击打开失败，尚未发送。', '请在微信中手动打开目标会话并保持前台，再重试。'],
    ['automation', 'input_unavailable', '无法定位可用的微信输入框。尚未发送。', '确认微信窗口已解锁且会话输入区可用。'],
    ['automation', 'input_ambiguous', '无法定位可用的微信输入框。尚未发送。', '确认微信窗口已解锁且会话输入区可用。'],
    ['automation', 'input_click_failed', '已找到微信输入框，但点击聚焦失败。尚未发送。', '请点击微信输入框确认可输入后，再重试。'],
    ['automation', 'input_paste_failed', '无法将回复粘贴到微信输入框，尚未发送。', '请确认微信输入框可编辑且剪贴板可用，再重试。'],
    ['automation', 'input_submit_failed', '微信输入框未能提交消息，尚未发送。', '请确认输入框仍处于会话中，再检查后决定是否重试。'],
    ['automation', 'automation_timeout', '自动化操作超时，发送结果无法确认。', '请先检查微信会话；不要直接重试，以免重复发送。'],
    ['verification_postsend', 'outbound_not_verified', '发送动作可能已执行，但消息记录尚未确认。', '请先检查微信会话；确认未发送后再决定是否重发。'],
    ['verification_postsend', 'verification_unbounded', '发送动作可能已执行，但消息记录尚未确认。', '请先检查微信会话；确认未发送后再决定是否重发。']
  ] as const)('maps %s / %s to an approved fact and next step', (failureStage, reason, fact, nextStep) => {
    renderTask(taskFor(failureStage, reason, failureStage === 'verification_postsend' ? 'delivery_unconfirmed' : 'send_failed'))
    expect(screen.getByText(fact)).toBeTruthy()
    expect(screen.getByText(nextStep)).toBeTruthy()
    expect(screen.queryByText(reason)).toBeNull()
    cleanup()
  })

  it('offers confirmation only for delivery-unconfirmed and never routes it through retry or send', async () => {
    const uncertain = renderTask(taskFor('verification_postsend', 'outbound_not_verified', 'delivery_unconfirmed'))
    fireEvent.click(screen.getByRole('button', { name: '打开会话检查' }))
    fireEvent.click(screen.getByRole('button', { name: '确认送达' }))
    await waitFor(() => expect(uncertain.onConfirmDelivery).toHaveBeenCalledWith('task-outbound_not_verified'))
    expect(uncertain.onInspectConversation).toHaveBeenCalledWith('private-session')
    expect(uncertain.onRetry).not.toHaveBeenCalled()
    expect(uncertain.onSend).not.toHaveBeenCalled()
    cleanup()

    renderTask(taskFor('automation', 'input_submit_failed', 'send_failed'))
    expect(screen.queryByRole('button', { name: '确认送达' })).toBeNull()
  })

  it('keeps known failures out of the generic send-failed fallback and allows only explicit pre-send retry', () => {
    const { onRetry } = renderTask(taskFor('verification_baseline', 'verification_baseline_failed'))
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByText('发送失败')).toBeNull()
  })

  it.each([
    ['automation', 'automation_timeout', 'send_failed'],
    ['verification_postsend', 'outbound_not_verified', 'delivery_unconfirmed'],
    ['automation', 'secret raw stack /Users/private/account-id', 'send_failed']
  ] as const)('prohibits blind retry for uncertain %s / %s', (failureStage, reason, status) => {
    const { container, onInspectConversation } = renderTask(taskFor(failureStage, reason, status))
    expect(screen.queryByRole('button', { name: /重试|发送/ })).toBeNull()
    expect(container.textContent).not.toContain(reason)
    fireEvent.click(screen.getByRole('button', { name: '打开会话检查' }))
    expect(onInspectConversation).toHaveBeenCalledWith('private-session')
    cleanup()
  })

  it('exposes two real recovery buttons for the unknown fallback', () => {
    const { onInspectConversation, onOpenHostingSettings } = renderTask(taskFor('automation', 'private raw failure'))
    fireEvent.click(screen.getByRole('button', { name: '打开会话检查' }))
    fireEvent.click(screen.getByRole('button', { name: '检查托管状态' }))
    expect(onInspectConversation).toHaveBeenCalledOnce()
    expect(onOpenHostingSettings).toHaveBeenCalledOnce()
  })

  it.each([
    ['accessibility_permission_denied', 'accessibility'],
    ['automation_permission_denied', 'automation']
  ] as const)('routes %s through typed permission recovery without retrying', (reason, permission) => {
    const { container, onRetry, onOpenHostingSettings } = renderTask(taskFor('automation', reason))
    const help = screen.getByRole('button', { name: '查看授权步骤' })
    help.focus()
    expect(document.activeElement).toBe(help)
    fireEvent.click(help)
    expect(onRetry).not.toHaveBeenCalled()
    expect(onOpenHostingSettings).toHaveBeenCalledWith(help, permission)
    expect(container.textContent).not.toContain('accessibility_permission_denied')
    expect(container.textContent).not.toContain('automation_permission_denied')
  })

  it('preserves a manual draft and blocks another send after an unconfirmed result', async () => {
    const sendManual = vi.fn().mockResolvedValue({
      success: false,
      stage: 'verification_postsend',
      error: 'outbound_not_verified'
    })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    const inspectionTarget = document.createElement('main')
    inspectionTarget.id = 'chat-message-area'
    inspectionTarget.tabIndex = -1
    document.body.append(inspectionTarget)
    render(<OmniMindManualMessageComposer accountId="account-a" sessionId="private-session" />)
    const input = screen.getByLabelText('手动发送文本') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '需要保留的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await screen.findByText('发送动作可能已执行，但消息记录尚未确认。')
    expect(input.value).toBe('需要保留的草稿')
    expect(screen.getByText('请先检查微信会话；确认未发送后再决定是否重发。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '先检查会话' }) as HTMLButtonElement).disabled).toBe(true)
    sendManual.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '打开会话检查' }))
    expect(document.activeElement).toBe(inspectionTarget)
    expect(sendManual).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '已检查且未发送' }))
    expect(sendManual).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(sendManual).toHaveBeenCalledTimes(1)
    inspectionTarget.remove()
  })

  it('keeps uncertain composer locked when the conversation area is unavailable', async () => {
    document.getElementById('chat-message-area')?.remove()
    const sendManual = vi.fn().mockResolvedValue({ success: false, stage: 'verification_postsend', error: 'outbound_not_verified' })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    render(<OmniMindManualMessageComposer accountId="account-a" sessionId="private-session" />)
    fireEvent.change(screen.getByLabelText('手动发送文本'), { target: { value: 'locked draft' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText('发送动作可能已执行，但消息记录尚未确认。')
    sendManual.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '打开会话检查' }))
    expect(screen.queryByRole('button', { name: '已检查且未发送' })).toBeNull()
    expect((screen.getByRole('button', { name: '先检查会话' }) as HTMLButtonElement).disabled).toBe(true)
    expect(sendManual).not.toHaveBeenCalled()
  })

  it('preserves a manual draft but permits a controlled retry after a confirmed pre-send failure', async () => {
    const sendManual = vi.fn().mockResolvedValue({
      success: false,
      stage: 'verification_baseline',
      error: 'verification_baseline_failed'
    })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    render(<OmniMindManualMessageComposer accountId="account-a" sessionId="private-session" />)
    const input = screen.getByLabelText('手动发送文本') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '需要保留的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await screen.findByText('无法读取发送前的微信消息记录。尚未执行微信发送。')
    expect(input.value).toBe('需要保留的草稿')
    await waitFor(() => expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false))
    sendManual.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }))
    expect(sendManual).toHaveBeenCalledOnce()
  })

  it('keeps an in-flight manual transaction owned by its session across remounts', async () => {
    const pending = deferred<{ success: boolean; stage?: OmniMindFailureStage; error?: string }>()
    const sendManual = vi.fn().mockReturnValue(pending.promise)
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    const { rerender } = render(<OmniMindManualMessageComposer key="session-a" accountId="account-a" sessionId="session-a" />)
    const inputA = screen.getByLabelText('手动发送文本') as HTMLTextAreaElement
    fireEvent.change(inputA, { target: { value: 'session A draft' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(inputA.readOnly || inputA.disabled).toBe(true)
    fireEvent.change(inputA, { target: { value: 'must not replace in-flight draft' } })
    expect(inputA.value).toBe('session A draft')

    rerender(<OmniMindManualMessageComposer key="session-b" accountId="account-a" sessionId="session-b" />)
    fireEvent.change(screen.getByLabelText('手动发送文本'), { target: { value: 'session B draft' } })
    rerender(<OmniMindManualMessageComposer key="session-a-return" accountId="account-a" sessionId="session-a" />)
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('session A draft')
    expect((screen.getByRole('button', { name: '等待当前发送完成…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(sendManual).toHaveBeenCalledOnce()

    pending.resolve({ success: false, stage: 'verification_postsend', error: 'outbound_not_verified' })
    await screen.findByText('发送动作可能已执行，但消息记录尚未确认。')
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('session A draft')
    rerender(<OmniMindManualMessageComposer key="session-b-return" accountId="account-a" sessionId="session-b" />)
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('session B draft')
    expect(screen.queryByText('发送动作可能已执行，但消息记录尚未确认。')).toBeNull()
  })

  it('keeps a pending transaction with its account when another account opens the same session id', async () => {
    const pending = deferred<{ success: boolean; stage?: OmniMindFailureStage; error?: string }>()
    const sendManual = vi.fn().mockReturnValue(pending.promise)
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    const { rerender } = render(<OmniMindManualMessageComposer key="account-a" accountId="account-a" sessionId="shared-session" />)
    fireEvent.change(screen.getByLabelText('手动发送文本'), { target: { value: 'account A pending draft' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    rerender(<OmniMindManualMessageComposer key="account-b" accountId="account-b" sessionId="shared-session" />)
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByRole('button', { name: '等待当前发送完成…' })).toBeNull()
    rerender(<OmniMindManualMessageComposer key="account-a-return" accountId="account-a" sessionId="shared-session" />)
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('account A pending draft')
    expect((screen.getByRole('button', { name: '等待当前发送完成…' }) as HTMLButtonElement).disabled).toBe(true)

    pending.resolve({ success: false, stage: 'verification_postsend', error: 'outbound_not_verified' })
    await screen.findByText('发送动作可能已执行，但消息记录尚未确认。')
  })

  it('isolates drafts, uncertain tombstones, and resend unlocks by account plus session', () => {
    const sharedSession = 'same-session-id'
    updateManualComposerState(identityFor(sharedSession, 'account-a'), {
      text: 'account A uncertain draft', failure: { stage: 'verification_postsend', reason: 'outbound_not_verified' }, resendConfirmed: true
    })
    updateManualComposerState(identityFor(sharedSession, 'account-b'), {
      text: 'account B uncertain draft', failure: { stage: 'verification_postsend', reason: 'outbound_not_verified' }, resendConfirmed: false
    })
    const { rerender } = render(<OmniMindManualMessageComposer key="a" accountId="account-a" sessionId={sharedSession} />)
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('account A uncertain draft')
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false)

    rerender(<OmniMindManualMessageComposer key="b" accountId="account-b" sessionId={sharedSession} />)
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('account B uncertain draft')
    expect((screen.getByRole('button', { name: '先检查会话' }) as HTMLButtonElement).disabled).toBe(true)
    expect(getManualComposerState(identityFor(sharedSession, 'account-a')).resendConfirmed).toBe(true)
    expect(getManualComposerState(identityFor(sharedSession, 'account-b')).resendConfirmed).toBe(false)
  })

  it('unmounts the composer during deferred account replacement and mounts only the new identity', async () => {
    updateManualComposerState(identityFor('shared-session', 'account-a'), {
      text: 'old account uncertain draft', failure: { stage: 'verification_postsend', reason: 'outbound_not_verified' }
    })
    const oldPending = deferred<{ success: boolean }>()
    updateManualComposerState(identityFor('old-pending', 'account-a'), { text: 'old account pending draft' })
    const oldAttempt = sendManualComposerText(identityFor('old-pending', 'account-a'), () => oldPending.promise)

    const nextAccount = deferred<unknown>()
    const readAccountId = vi.fn<() => Promise<unknown>>().mockResolvedValueOnce('account-a').mockReturnValueOnce(nextAccount.promise)
    const view = render(<AccountReadinessHarness readAccountId={readAccountId} />)
    fireEvent.click(screen.getByRole('button', { name: 'connect account' }))
    expect(await screen.findByDisplayValue('old account uncertain draft')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'connect account' }))
    expect(screen.queryByLabelText('手动发送文本')).toBeNull()
    expect(getManualComposerState(identityFor('shared-session', 'account-a')).failure).toEqual({ stage: 'verification_postsend', reason: 'outbound_not_verified' })
    expect(getManualComposerState(identityFor('old-pending', 'account-a')).sending).toBe(true)

    nextAccount.resolve('account-b')
    await waitFor(() => expect(screen.getByLabelText('手动发送文本')).toBeTruthy())
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('')
    expect(getManualComposerState(identityFor('shared-session', 'account-a')).text).toBe('old account uncertain draft')
    oldPending.resolve({ success: true })
    await oldAttempt
    view.unmount()
  })

  it('ignores a stale account read that completes after a newer connect begins', async () => {
    const staleRead = deferred<unknown>()
    const currentRead = deferred<unknown>()
    const readAccountId = vi.fn<() => Promise<unknown>>().mockReturnValueOnce(staleRead.promise).mockReturnValueOnce(currentRead.promise)
    render(<AccountReadinessHarness readAccountId={readAccountId} />)
    fireEvent.click(screen.getByRole('button', { name: 'connect account' }))
    fireEvent.click(screen.getByRole('button', { name: 'connect account' }))

    staleRead.resolve('stale-account')
    await Promise.resolve()
    expect(screen.queryByLabelText('手动发送文本')).toBeNull()
    currentRead.resolve('current-account')
    await waitFor(() => expect(screen.getByLabelText('手动发送文本')).toBeTruthy())
  })

  it.each([
    ['empty account id', () => Promise.resolve('   ')],
    ['account read failure', () => Promise.reject(new Error('read failed'))]
  ] as const)('keeps the composer unmounted after %s', async (_label, readAccountId) => {
    const read = vi.fn(readAccountId)
    render(<AccountReadinessHarness readAccountId={read} />)
    fireEvent.click(screen.getByRole('button', { name: 'connect account' }))
    await waitFor(() => expect(read).toHaveBeenCalledOnce())
    expect(screen.queryByLabelText('手动发送文本')).toBeNull()
  })

  it('retains more than 25 unresolved uncertain tombstones and their blind-resend guards', () => {
    for (let index = 0; index < 30; index += 1) {
      updateManualComposerState(identityFor(`uncertain-${index}`), {
        text: `draft-${index}`,
        failure: { stage: 'verification_postsend', reason: 'outbound_not_verified' },
        conversationChecked: false,
        resendConfirmed: false
      })
    }
    for (let index = 0; index < 80; index += 1) {
      updateManualComposerState(identityFor(`safe-${index}`), { text: '' })
    }
    for (let index = 0; index < 30; index += 1) {
      const state = getManualComposerState(identityFor(`uncertain-${index}`))
      expect(state.text).toBe(`draft-${index}`)
      expect(state.failure).toEqual({ stage: 'verification_postsend', reason: 'outbound_not_verified' })
      expect(state.resendConfirmed).toBe(false)
    }
    render(<OmniMindManualMessageComposer accountId="account-a" sessionId="uncertain-0" />)
    expect((screen.getByRole('button', { name: '先检查会话' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hard-caps globally pending manual sends and preserves a rejected session draft', async () => {
    const operations: Array<ReturnType<typeof deferred<{ success: boolean }>>> = []
    const sendManual = vi.fn(() => {
      const operation = deferred<{ success: boolean }>()
      operations.push(operation)
      return operation.promise
    })
    const attempts = Array.from({ length: 5 }, (_, index) => {
      const sessionId = `pending-${index}`
      updateManualComposerState(identityFor(sessionId), { text: `pending draft ${index}` })
      return sendManualComposerText(identityFor(sessionId), sendManual)
    })

    expect(sendManual).toHaveBeenCalledTimes(4)
    expect(await attempts[4]).toBe('capacity_reached')
    expect(getManualComposerState(identityFor('pending-4')).text).toBe('pending draft 4')
    expect(getManualComposerState(identityFor('pending-4')).sending).toBe(false)
    operations.forEach((operation) => operation.resolve({ success: true }))
    await Promise.all(attempts.slice(0, 4))
  })

  it('releases its transaction token and sending state when the first listener notification throws', async () => {
    updateManualComposerState(identityFor('listener-throws'), { text: 'preserved listener draft' })
    const unsubscribe = subscribeManualComposerState(identityFor('listener-throws'), () => { throw new Error('listener failed') })
    const sendManual = vi.fn().mockResolvedValue({ success: true })

    await expect(sendManualComposerText(identityFor('listener-throws'), sendManual)).resolves.toBe('started')
    unsubscribe()
    expect(sendManual).not.toHaveBeenCalled()
    expect(getManualComposerState(identityFor('listener-throws')).sending).toBe(false)
    expect(getManualComposerState(identityFor('listener-throws')).text).toBe('preserved listener draft')
    expect(getManualComposerState(identityFor('listener-throws')).failure).toEqual({})

    const pending = Array.from({ length: 5 }, (_, index) => {
      updateManualComposerState(identityFor(`after-listener-${index}`), { text: `draft ${index}` })
      return sendManualComposerText(identityFor(`after-listener-${index}`), () => new Promise(() => undefined))
    })
    expect(await pending[4]).toBe('capacity_reached')
  })

  it.each([
    ['synchronous throw', () => { throw new Error('sync IPC failure') }],
    ['promise rejection', () => Promise.reject(new Error('async IPC failure'))]
  ] as const)('cleans the active transaction after an IPC %s', async (_label, failingSend) => {
    updateManualComposerState(identityFor('ipc-failure'), { text: 'failure draft' })
    await expect(sendManualComposerText(identityFor('ipc-failure'), failingSend)).resolves.toBe('started')
    expect(getManualComposerState(identityFor('ipc-failure')).sending).toBe(false)
    expect(getManualComposerState(identityFor('ipc-failure')).failure).toEqual({})
    const operations: Array<ReturnType<typeof deferred<{ success: boolean }>>> = []
    const attempts = Array.from({ length: 5 }, (_, index) => {
      updateManualComposerState(identityFor(`after-ipc-${index}`), { text: `draft ${index}` })
      return sendManualComposerText(identityFor(`after-ipc-${index}`), () => {
        const operation = deferred<{ success: boolean }>()
        operations.push(operation)
        return operation.promise
      })
    })
    expect(await attempts[4]).toBe('capacity_reached')
    operations.forEach((operation) => operation.resolve({ success: true }))
    await Promise.all(attempts.slice(0, 4))
  })

  it('does not let a pre-reset promise release any of four post-reset active tokens', async () => {
    const oldOperation = deferred<{ success: boolean }>()
    updateManualComposerState(identityFor('old-pending'), { text: 'old draft' })
    const oldAttempt = sendManualComposerText(identityFor('old-pending'), () => oldOperation.promise)
    resetManualComposerStoreForTests()

    const newOperations: Array<ReturnType<typeof deferred<{ success: boolean }>>> = []
    const newAttempts: Array<ReturnType<typeof sendManualComposerText>> = []
    for (let index = 0; index < 4; index += 1) {
      updateManualComposerState(identityFor(`new-pending-${index}`), { text: `new draft ${index}` })
      newAttempts.push(sendManualComposerText(identityFor(`new-pending-${index}`), () => {
        const operation = deferred<{ success: boolean }>()
        newOperations.push(operation)
        return operation.promise
      }))
    }
    oldOperation.resolve({ success: true })
    await oldAttempt
    updateManualComposerState(identityFor('fifth-after-reset'), { text: 'must remain blocked' })
    const fifth = await sendManualComposerText(identityFor('fifth-after-reset'), () => Promise.resolve({ success: true }))
    expect(fifth).toBe('capacity_reached')
    newOperations.forEach((operation) => operation.resolve({ success: true }))
    await Promise.all(newAttempts)
  })

  it('resolves an uncertain draft as already sent without sending and makes the entry pruneable', async () => {
    const sendManual = vi.fn().mockResolvedValue({ success: false, stage: 'verification_postsend', error: 'outbound_not_verified' })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    const view = render(<OmniMindManualMessageComposer accountId="account-a" sessionId="already-sent" />)
    fireEvent.change(screen.getByLabelText('手动发送文本'), { target: { value: 'old uncertain draft' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText('发送动作可能已执行，但消息记录尚未确认。')
    sendManual.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '已确认已发送，丢弃旧草稿' }))
    expect(sendManual).not.toHaveBeenCalled()
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByText('发送动作可能已执行，但消息记录尚未确认。')).toBeNull()
    fireEvent.change(screen.getByLabelText('手动发送文本'), { target: { value: 'new independent message' } })
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false)

    view.unmount()
    for (let index = 0; index < 40; index += 1) updateManualComposerState(identityFor(`prune-${index}`), { text: '' })
    expect(getManualComposerState(identityFor('already-sent')).recoveryAnnouncement).toBe('')
  })

  it('keeps unknown composer recovery actions separate from sending', async () => {
    const sendManual = vi.fn().mockResolvedValue({ success: false, stage: 'automation', error: 'private raw failure' })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    render(<OmniMindManualMessageComposer accountId="account-a" sessionId="private-session" />)
    fireEvent.change(screen.getByLabelText('手动发送文本'), { target: { value: 'draft' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText('发送状态暂时无法确认。为安全起见，系统没有自动重试。')
    sendManual.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '打开会话检查' }))
    fireEvent.click(screen.getByRole('button', { name: '检查托管状态' }))
    expect(sendManual).not.toHaveBeenCalled()
  })

  it('navigates an off-screen queue task to its own session without sending or retrying', async () => {
    const now = Date.now()
    const settings = {
      schemaVersion: 4 as const,
      pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'private-session', displayName: 'Visible' }] },
      autoSend: true,
      hasApiKey: true,
      batchWindowMs: 2000
    }
    const inspectionTarget = document.createElement('main')
    inspectionTarget.id = 'chat-message-area'
    inspectionTarget.tabIndex = -1
    document.body.append(inspectionTarget)
    const navigate = vi.fn()
    const sendGeneratedReply = vi.fn()
    const retryTask = vi.fn()
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'running', waiting: [], recent: [{ id: 'unknown', sessionId: 'private-session', sessionName: '可见会话', status: 'send_failed', createdAt: now, updatedAt: now, failureStage: 'automation', reason: 'private raw failure' }] }),
      getSettings: async () => settings,
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask, sendGeneratedReply, abandonGeneratedReply: vi.fn()
    } } })
    const { rerender } = render(<OmniMindQueuePanel currentSessionId="different-current-session" onNavigate={navigate} />)

    fireEvent.click(await screen.findByRole('button', { name: '打开会话检查' }))
    expect(navigate).toHaveBeenCalledWith('/chat?sessionId=private-session')
    expect(sendGeneratedReply).not.toHaveBeenCalled()
    expect(retryTask).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(inspectionTarget)
    expect(document.querySelector('.omnimind-queue-panel > p[aria-live="polite"]')?.textContent).toBe('')
    rerender(<OmniMindQueuePanel currentSessionId="private-session" onNavigate={navigate} />)
    await waitFor(() => expect(document.activeElement).toBe(inspectionTarget))
    expect(screen.getByText('已进入当前会话消息区域，请检查最新消息。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '检查托管状态' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    inspectionTarget.remove()
  })

  it('resets draft and recovery permission when the composer session key changes', async () => {
    const sendManual = vi.fn().mockResolvedValue({ success: false, stage: 'verification_postsend', error: 'outbound_not_verified' })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    const inspectionTarget = document.createElement('main')
    inspectionTarget.id = 'chat-message-area'
    inspectionTarget.tabIndex = -1
    document.body.append(inspectionTarget)
    const { rerender } = render(<OmniMindManualMessageComposer key="session-a" accountId="account-a" sessionId="session-a" />)
    fireEvent.change(screen.getByLabelText('手动发送文本'), { target: { value: 'old session draft' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText('发送动作可能已执行，但消息记录尚未确认。')
    fireEvent.click(screen.getByRole('button', { name: '打开会话检查' }))
    fireEvent.click(screen.getByRole('button', { name: '已检查且未发送' }))

    rerender(<OmniMindManualMessageComposer key="session-b" accountId="account-a" sessionId="session-b" />)
    expect((screen.getByLabelText('手动发送文本') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByText('发送动作可能已执行，但消息记录尚未确认。')).toBeNull()
    expect(screen.queryByRole('button', { name: '已检查且未发送' })).toBeNull()
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true)
    inspectionTarget.remove()
  })

  it('does not leak a current task busy state or late error into the next current task', async () => {
    const cancelA = deferred<void>()
    let publish: ((snapshot: OmniMindSnapshot) => void) | undefined
    const now = Date.now()
    const makeCurrent = (id: string): OmniMindSnapshot => ({
      runtimeState: 'running',
      current: { id, sessionId: id, sessionName: id, status: 'queued', createdAt: now, updatedAt: now },
      waiting: [], recent: []
    })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => makeCurrent('task-a'),
      getSettings: async () => undefined,
      onSnapshotChanged: (listener: (snapshot: OmniMindSnapshot) => void) => { publish = listener; return () => undefined },
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(() => cancelA.promise), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })
    render(<OmniMindQueuePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    publish?.(makeCurrent('task-b'))
    await waitFor(() => expect(screen.getByLabelText(/task-b/)).toBeTruthy())
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false)
    cancelA.reject(new Error('late task A failure'))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('preserves the exact opener and permission kind for the shared permission center', () => {
    const opener = document.createElement('button')
    let received: OmniMindOpenSettingsDetail | undefined
    const listener = (event: Event): void => { received = (event as CustomEvent<OmniMindOpenSettingsDetail>).detail }
    window.addEventListener(OMNIMIND_OPEN_SETTINGS_EVENT, listener)

    requestOmniMindSettings(opener, 'automation')

    expect(received).toEqual({ opener, tab: 'permissions', permissionKind: 'automation' })
    window.removeEventListener(OMNIMIND_OPEN_SETTINGS_EVENT, listener)
  })

  it.each(['degraded', 'failed'] as const)('restores the %s runtime settings opener after close', async (runtimeState) => {
    const settings = {
      schemaVersion: 4 as const, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
      managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'session-a', displayName: 'A' }] },
      autoSend: true, hasApiKey: true, batchWindowMs: 2000
    }
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState, waiting: [], recent: [] }), getSettings: async () => settings,
      onSnapshotChanged: () => () => undefined, enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn()
    } } })
    render(<OmniMindQueuePanel />)
    const opener = await screen.findByRole('button', { name: '检查自动托管设置' })
    fireEvent.click(opener)
    fireEvent.click(await screen.findByRole('button', { name: '关闭设置' }))
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('mounts empty recovery live regions before announcing updates', async () => {
    const sendManual = vi.fn().mockResolvedValue({ success: false, stage: 'automation', error: 'accessibility_permission_denied' })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: { sendManual } } })
    const composer = render(<OmniMindManualMessageComposer accountId="account-a" sessionId="live-region-session" />)
    const composerRegion = composer.container.querySelector('.omnimind-manual-composer [aria-live="polite"]')
    expect(composerRegion).toBeTruthy()
    expect(composerRegion?.textContent).toBe('')
    fireEvent.change(screen.getByLabelText('手动发送文本'), { target: { value: 'draft' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(await screen.findByRole('button', { name: '查看授权步骤' }))
    expect(composerRegion?.textContent).toContain('打开权限中心的辅助功能卡片')
    cleanup()

    const task = renderTask(taskFor('automation', 'accessibility_permission_denied'))
    const taskRegion = task.container.querySelector('.omnimind-task [aria-live="polite"]')
    expect(taskRegion).toBeTruthy()
    expect(taskRegion?.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '查看授权步骤' }))
    expect(taskRegion?.textContent).toContain('打开权限中心的辅助功能卡片')
  })

  it('keeps the confirmation target at 44px after the runtime-notice cascade', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync('src/features/omnimind/omnimind.scss', 'utf8')
    document.head.append(style)
    const notice = document.createElement('div')
    notice.className = 'omnimind-runtime-notice'
    const confirm = document.createElement('button')
    confirm.className = 'omnimind-recovery-confirm'
    notice.append(confirm)
    document.body.append(notice)
    expect(getComputedStyle(confirm).minHeight).toBe('44px')
    notice.remove(); style.remove()
  })

  it('uses a three-pixel high-contrast focus token in light and dark modes', () => {
    const css = readFileSync('src/features/omnimind/omnimind.scss', 'utf8')
    expect(css).toContain('--omnimind-focus-ring: var(--text-primary)')
    expect(css).toMatch(/\.omnimind-recovery-actions button:focus-visible[^}]*outline:\s*3px solid var\(--omnimind-focus-ring\)/)
    expect(css).toMatch(/\.omnimind-runtime-notice \.omnimind-recovery-confirm:focus-visible[^}]*outline:\s*3px solid var\(--omnimind-focus-ring\)/)
    const luminance = (hex: string): number => {
      const channels = hex.match(/[a-f\d]{2}/gi)!.map((channel) => Number.parseInt(channel, 16) / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const contrast = (left: string, right: string): number => {
      const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a)
      return (lighter + 0.05) / (darker + 0.05)
    }
    expect(contrast('#0d0d0d', '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrast('#0d0d0d', '#f0f0f0')).toBeGreaterThanOrEqual(3)
    expect(contrast('#ececec', '#212121')).toBeGreaterThanOrEqual(3)
    expect(contrast('#ececec', '#383838')).toBeGreaterThanOrEqual(3)
  })
})
