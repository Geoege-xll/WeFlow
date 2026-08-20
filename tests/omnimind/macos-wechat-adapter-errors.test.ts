import { describe, expect, it, vi } from 'vitest'
import { MacOsWeChatTextAdapter, PREPARE_WECHAT_WINDOW_SCRIPT, SEND_SCRIPT } from '../../electron/omnimind/macos-wechat-text-adapter'

const createAdapter = (sendOutcome: string | unknown) => new MacOsWeChatTextAdapter({
  platform: 'darwin',
  clipboard: { readText: () => 'before', writeText: vi.fn() },
  runAppleScript: vi.fn(async (script: string, args: string[]) => {
    if (script === PREPARE_WECHAT_WINDOW_SCRIPT) return 'wechat-window-ready'
    if (args.length === 0) return 'Finder'
    if (args[0] === 'Finder') return ''
    if (typeof sendOutcome === 'string') return sendOutcome
    throw sendOutcome
  }),
  now: () => 123
})

describe('macOS 微信文本适配器错误分类', () => {
  it.each([
    // 这些结果都描述微信 UI 的瞬时状态或 AX 控件操作失败，不能据此推断 TCC 授权状态。
    ['wechat-process-unavailable', 'wechat_process_unavailable'],
    ['wechat-window-unavailable', 'wechat_window_unavailable'],
    ['wechat-window-ambiguous', 'wechat_window_ambiguous'],
    ['wechat-window-recovery-failed', 'wechat_window_recovery_failed'],
    ['wechat-window-recovery-timeout', 'wechat_window_recovery_timeout'],
    ['search-open-failed', 'search_open_failed'],
    ['search-input-failed', 'search_input_failed'],
    ['search-result-click-failed', 'search_result_click_failed'],
    ['input-unavailable', 'input_unavailable'],
    ['input-click-failed', 'input_click_failed'],
    ['input-paste-failed', 'input_paste_failed']
  ])('把 AppleScript 结果 %s 映射为非权限失败码 %s', async (scriptResult, expectedReason) => {
    await expect(createAdapter(scriptResult).sendText({
      accountId: 'account', sessionId: 'session', conversationTitle: '会话', text: '回复'
    })).resolves.toEqual({ success: false, stage: 'automation', error: expectedReason })
  })

  it('脚本中的所有 UI 失败出口均使用稳定的非权限结果码', () => {
    const scripts = `${PREPARE_WECHAT_WINDOW_SCRIPT}\n${SEND_SCRIPT}`
    expect(scripts).not.toContain('return "accessibility"')
    for (const code of [
      'wechat-process-unavailable', 'wechat-window-ambiguous',
      'wechat-window-recovery-failed', 'wechat-window-recovery-timeout', 'search-open-failed',
      'search-input-failed', 'search-result-click-failed',
      'input-unavailable', 'input-click-failed',
      'input-paste-failed', 'input-submit-failed'
    ]) expect(scripts).toContain(`return "${code}"`)
  })

  it('WeChat 4.x 发送脚本不依赖任何聊天 AX 子控件', () => {
    for (const forbidden of ['entire contents', 'AXTextField', 'AXTitleUIElement', 'AXTextArea', 'resultCandidates', 'inputCandidates']) {
      expect(SEND_SCRIPT).not.toContain(forbidden)
    }
  })

  it('按批准时序选择搜索首项并用前窗口几何点击输入区', () => {
    const markers = [
      'delay 0.3', 'keystroke "f" using command down', 'delay 0.5',
      'set the clipboard to expectedTitle', 'keystroke "a" using command down', 'delay 0.1', 'keystroke "v" using command down',
      'delay 0.1', 'key code 36 using {}', 'delay 0.8', 'key code 53 using {}',
      'set windowPosition to position of targetWindow', 'set windowSize to size of targetWindow',
      'set inputX to (windowX + (windowWidth * 0.7)) as integer', 'set inputY to (windowY + windowHeight - 55) as integer',
      'click at {inputX, inputY}', 'delay 0.3', 'set the clipboard to replyText', 'delay 0.1',
      'keystroke "v" using command down',
      'delay 0.5', 'key code 36 using {}', 'delay 0.3'
    ]
    let cursor = -1
    for (const marker of markers) {
      const next = SEND_SCRIPT.indexOf(marker, cursor + 1)
      expect(next, marker).toBeGreaterThan(cursor)
      cursor = next
    }
  })

  it('搜索选择、Escape 和最终提交都显式清空 Cmd 修饰键', () => {
    expect(SEND_SCRIPT.match(/key code 36 using \{\}/g)).toHaveLength(2)
    expect(SEND_SCRIPT.match(/key code 53 using \{\}/g)).toHaveLength(1)
    expect(SEND_SCRIPT).not.toMatch(/key code (?:36|53)(?! using \{\})/)
  })

  it('零窗口时只通过 System Events 执行一次受限 Dock 恢复并有界等待', () => {
    expect(PREPARE_WECHAT_WINDOW_SCRIPT).toContain('tell process "Dock"')
    expect(PREPARE_WECHAT_WINDOW_SCRIPT).toContain('dockItemName is "WeChat" or dockItemName is "微信"')
    expect(PREPARE_WECHAT_WINDOW_SCRIPT).toMatch(/repeat 10 times[\s\S]*delay 0\.1/)
    expect(PREPARE_WECHAT_WINDOW_SCRIPT.match(/perform action "AXPress"/g)).toHaveLength(1)
    expect(PREPARE_WECHAT_WINDOW_SCRIPT).toContain('return "wechat-window-recovery-failed"')
    expect(PREPARE_WECHAT_WINDOW_SCRIPT).toContain('return "wechat-window-recovery-timeout"')
  })

  it('唯一窗口最小化时先反最小化与 AXRaise，再有界确认可操作', () => {
    for (const marker of [
      'currentWindowMinimized to value of attribute "AXMinimized"',
      'set value of attribute "AXMinimized" of front window to false',
      'perform action "AXRaise" of front window',
      'recoveredWindowMinimized to value of attribute "AXMinimized"'
    ]) {
      const markerIndex = PREPARE_WECHAT_WINDOW_SCRIPT.indexOf(marker)
      expect(markerIndex).toBeGreaterThanOrEqual(0)
    }
    expect(PREPARE_WECHAT_WINDOW_SCRIPT.match(/perform action "AXRaise"/g)).toHaveLength(1)
  })

  it('多窗口时准备 front window，不按数量拒绝也不猜测 WeChatAppEx owner', () => {
    expect(PREPARE_WECHAT_WINDOW_SCRIPT).not.toContain('currentWindowCount is greater than 1')
    expect(PREPARE_WECHAT_WINDOW_SCRIPT).toContain('role of front window as text')
    expect(SEND_SCRIPT).toContain('set targetWindow to front window')
    expect(`${PREPARE_WECHAT_WINDOW_SCRIPT}${SEND_SCRIPT}`).not.toContain('WeChatAppEx')
  })

  it('回车提交失败保守标记为动作可能已发生', async () => {
    await expect(createAdapter('input-submit-failed').sendText({
      accountId: 'account', sessionId: 'session', conversationTitle: '会话', text: '回复'
    })).resolves.toEqual({
      success: false,
      stage: 'automation',
      error: 'input_submit_failed',
      actionMayHaveOccurred: true,
      sentAt: 123
    })
  })

  it.each([
    ['wechat-window-ambiguous', 'wechat_window_ambiguous'],
    ['wechat-window-recovery-failed', 'wechat_window_recovery_failed'],
    ['wechat-window-recovery-timeout', 'wechat_window_recovery_timeout']
  ])('窗口就绪阶段失败 %s 在发送脚本前安全停止', async (readyOutcome, expectedReason) => {
    const runAppleScript = vi.fn(async (script: string, args: string[]) => {
      if (script === PREPARE_WECHAT_WINDOW_SCRIPT) return readyOutcome
      return args.length === 0 ? 'Finder' : 'sent'
    })
    const writeText = vi.fn()
    const adapter = new MacOsWeChatTextAdapter({
      platform: 'darwin',
      clipboard: { readText: () => 'before', writeText },
      runAppleScript
    })

    await expect(adapter.sendText({ accountId: 'account', sessionId: 'session', conversationTitle: '会话', text: '回复' })).resolves.toEqual({
      success: false, stage: 'automation', error: expectedReason
    })
    expect(runAppleScript.mock.calls.filter(([script]) => script === SEND_SCRIPT)).toHaveLength(0)
    // 失败分支仍执行原有剪贴板恢复，不把发送中断变成本地数据泄露。
    expect(writeText).toHaveBeenCalledWith('before')
  })

  it.each([
    [{ code: -25211, message: 'localized error' }, 'accessibility_permission_denied'],
    [{ code: 1, stderr: 'osascript is not allowed assistive access.' }, 'accessibility_permission_denied'],
    [{ code: -1743, message: 'localized error' }, 'automation_permission_denied']
  ])('仅把明确原生权限拒绝映射为 %s', async (nativeError, expectedReason) => {
    await expect(createAdapter(nativeError).sendText({
      accountId: 'account', sessionId: 'session', conversationTitle: '会话', text: '回复'
    })).resolves.toEqual({ success: false, stage: 'automation', error: expectedReason })
  })

  it('未知异常保持保守自动化失败且不伪造权限', async () => {
    await expect(createAdapter(new Error('unknown AX failure')).sendText({
      accountId: 'account', sessionId: 'session', conversationTitle: '会话', text: '回复'
    })).resolves.toEqual({
      success: false, stage: 'automation', error: 'automation_failed', actionMayHaveOccurred: true, sentAt: 123
    })
  })

  it('超时保持独立失败码且不伪造权限', async () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    await expect(createAdapter(timeout).sendText({
      accountId: 'account', sessionId: 'session', conversationTitle: '会话', text: '回复'
    })).resolves.toEqual({
      success: false, stage: 'automation', error: 'automation_timeout', actionMayHaveOccurred: true, sentAt: 123
    })
  })
})
