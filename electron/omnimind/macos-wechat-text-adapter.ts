import type { OutboundVerifier, SendTextAdapter } from './unified-sender'

interface ClipboardPort { readText(): string; writeText(value: string): void; availableFormats?(): string[]; readBuffer?(format: string): Buffer; clear?(): void; writeBuffer?(format: string, value: Buffer): void }
interface AdapterDependencies { platform: NodeJS.Platform; clipboard: ClipboardPort; runAppleScript: (script: string, args: string[]) => Promise<string>; now?: () => number }
interface ReadinessDependencies { platform: NodeJS.Platform; runAppleScript: (script: string, args: string[]) => Promise<string> }

export interface WeChatReadinessPort {
  checkReadiness(options?: { restoreFocus?: boolean }): Promise<{ success: boolean; stage?: 'automation'; error?: string }>
}

export const buildOsascriptArguments = (script: string, args: string[]): string[] => ['-e', script, '--', ...args]

export const FOCUS_CAPTURE_SCRIPT = 'tell application "System Events" to return name of first application process whose frontmost is true'

export const PREPARE_WECHAT_WINDOW_SCRIPT = String.raw`
on run
  tell application "System Events"
    -- TCC/AX 边界：进程或窗口不存在只是当前 UI 不可用，不代表用户拒绝了辅助功能权限。
    -- 只有 osascript 抛出明确的 -25211/assistive access 错误时，适配器才会报告权限拒绝。
    if not (exists process "WeChat") then return "wechat-process-unavailable"
    set recoveryMode to "none"
    try
      tell process "WeChat"
        set frontmost to true
        set currentWindowCount to count of windows
        if currentWindowCount is greater than 0 then
          if (role of front window as text) is not "AXWindow" then return "wechat-window-ambiguous"
          set currentWindowMinimized to value of attribute "AXMinimized" of front window as boolean
          if currentWindowMinimized then set recoveryMode to "unminimize"
        end if
      end tell
    on error errorMessage number errorNumber
      if errorNumber is -25211 or errorNumber is -1743 then error errorMessage number errorNumber
      return "wechat-window-recovery-failed"
    end try
    if currentWindowCount is 0 then set recoveryMode to "materialize"
    if recoveryMode is not "none" then
      -- 窗口恢复仅允许通过 System Events 访问 Dock 的 AX 树，不向 WeChat 发送直接 Apple Event。
      -- 每次事务最多执行一组恢复：零窗口点击一次 Dock，最小化窗口只反最小化并 AXRaise 一次。
      try
        if recoveryMode is "materialize" then
          if not (exists process "Dock") then return "wechat-window-recovery-failed"
          tell process "Dock"
            if (count of lists) is 0 then return "wechat-window-recovery-failed"
            set matchingDockItems to {}
            repeat with dockItem in UI elements of list 1
              try
                -- Dock 标题可随系统语言显示为英文或中文；只允许这两个固定名称，并且必须唯一命中。
                set dockItemName to name of dockItem as text
                if dockItemName is "WeChat" or dockItemName is "微信" then set end of matchingDockItems to dockItem
              end try
            end repeat
            if (count of matchingDockItems) is not 1 then return "wechat-window-recovery-failed"
            perform action "AXPress" of item 1 of matchingDockItems
          end tell
        else
          tell process "WeChat"
            set value of attribute "AXMinimized" of front window to false
            perform action "AXRaise" of front window
          end tell
        end if
        set windowReady to false
        repeat 10 times
          delay 0.1
          if not (exists process "WeChat") then return "wechat-process-unavailable"
          tell process "WeChat"
            set frontmost to true
            set recoveredWindowCount to count of windows
            if recoveredWindowCount is greater than 0 then
              set recoveredWindowRole to role of front window as text
              set recoveredWindowMinimized to value of attribute "AXMinimized" of front window as boolean
            end if
          end tell
          if recoveredWindowCount is greater than 0 and recoveredWindowRole is "AXWindow" and recoveredWindowMinimized is false then
            set windowReady to true
            exit repeat
          end if
        end repeat
        if not windowReady then return "wechat-window-recovery-timeout"
      on error errorMessage number errorNumber
        -- 真实 TCC 拒绝必须保留原生错误码交给窄分类器，不得伪装成普通窗口恢复失败。
        if errorNumber is -25211 or errorNumber is -1743 then error errorMessage number errorNumber
        return "wechat-window-recovery-failed"
      end try
    end if
    try
      tell process "WeChat"
        set frontmost to true
        if (count of windows) is 0 then return "wechat-window-unavailable"
        if (role of front window as text) is not "AXWindow" then return "wechat-window-ambiguous"
        if (value of attribute "AXMinimized" of front window as boolean) then return "wechat-window-unavailable"
      end tell
    on error errorMessage number errorNumber
      if errorNumber is -25211 or errorNumber is -1743 then error errorMessage number errorNumber
      return "wechat-window-ambiguous"
    end try
  end tell
  return "wechat-window-ready"
end run`

export const SEND_SCRIPT = String.raw`
on run argv
  set expectedTitle to item 1 of argv
  set replyText to item 2 of argv
  tell application "System Events"
    if not (exists process "WeChat") then return "wechat-process-unavailable"
    tell process "WeChat"
      set frontmost to true
      if (count of windows) is 0 then return "wechat-window-unavailable"
      try
        set targetWindow to front window
        if (role of targetWindow as text) is not "AXWindow" then return "wechat-window-ambiguous"
        if (value of attribute "AXMinimized" of targetWindow as boolean) then return "wechat-window-unavailable"
      on error
        return "wechat-window-ambiguous"
      end try
      -- WeChat 4.x 的聊天子控件不再稳定暴露到 AX 子树。发送仅依赖已批准的键盘搜索首项约定，
      -- 而目标显示名唯一性由 sender mutex 内的 service authorize seam 在运行脚本前保证。
      delay 0.3
      try
        keystroke "f" using command down
      on error
        return "search-open-failed"
      end try
      delay 0.5
      try
        set the clipboard to expectedTitle
        keystroke "a" using command down
        delay 0.1
        keystroke "v" using command down
      on error
        return "search-input-failed"
      end try
      delay 0.1
      try
        key code 36 using {}
      on error
        return "search-result-click-failed"
      end try
      delay 0.8
      try
        key code 53 using {}
      on error
        return "search-result-click-failed"
      end try
      delay 0.5
      -- Escape 后重新读取当前 WeChat 前窗口几何，不信任搜索前的坐标或任何聊天子控件。
      try
        set targetWindow to front window
        set windowPosition to position of targetWindow
        set windowSize to size of targetWindow
        set windowX to item 1 of windowPosition
        set windowY to item 2 of windowPosition
        set windowWidth to item 1 of windowSize
        set windowHeight to item 2 of windowSize
        set inputX to (windowX + (windowWidth * 0.7)) as integer
        set inputY to (windowY + windowHeight - 55) as integer
      on error
        return "input-unavailable"
      end try
      try
        click at {inputX, inputY}
      on error
        return "input-click-failed"
      end try
      delay 0.3
      try
        set the clipboard to replyText
        delay 0.1
        keystroke "v" using command down
      on error
        return "input-paste-failed"
      end try
      delay 0.5
      try
        key code 36 using {}
      on error
        return "input-submit-failed"
      end try
      delay 0.3
    end tell
  end tell
  return "sent"
end run`

export const FOCUS_RESTORE_SCRIPT = String.raw`
on run argv
  set previousProcessName to item 1 of argv
  tell application "System Events"
    if exists process previousProcessName then set frontmost of process previousProcessName to true
  end tell
end run`

const mapScriptResult = (result: string): string => ({
  'wechat-process-unavailable': 'wechat_process_unavailable',
  'wechat-window-unavailable': 'wechat_window_unavailable',
  'wechat-window-ambiguous': 'wechat_window_ambiguous',
  'wechat-window-recovery-failed': 'wechat_window_recovery_failed',
  'wechat-window-recovery-timeout': 'wechat_window_recovery_timeout',
  'search-open-failed': 'search_open_failed',
  'search-field-unavailable': 'search_field_unavailable',
  'search-field-ambiguous': 'search_field_ambiguous',
  'search-input-failed': 'search_input_failed',
  'ambiguous-target': 'target_ambiguous',
  'search-result-click-failed': 'search_result_click_failed',
  'target-mismatch': 'target_mismatch',
  'input-unavailable': 'input_unavailable',
  'ambiguous-input': 'input_ambiguous',
  'input-click-failed': 'input_click_failed',
  'input-paste-failed': 'input_paste_failed',
  'input-submit-failed': 'input_submit_failed'
} as Record<string, string>)[result] ?? 'automation_failed'

const isTimeout = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; killed?: unknown; signal?: unknown }
  return value.code === 'ETIMEDOUT' || value.killed === true || value.signal === 'SIGTERM'
}

const permissionDeniedReason = (error: unknown): 'accessibility_permission_denied' | 'automation_permission_denied' | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const value = error as { code?: unknown; message?: unknown; stdout?: unknown; stderr?: unknown }
  // TCC/AX 权限是操作系统授权结论，不能由“找不到窗口或控件”等 UI 现象推断。
  // 这里只接受 osascript 原生错误码或稳定英文拒绝短语，其他异常交由调用方保守归类。
  const evidence = [value.code, value.message, value.stdout, value.stderr]
    .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
    .join('\n')
    .toLocaleLowerCase('en-US')
  if (/(?:^|\D)-1743(?:\D|$)/.test(evidence) || /not authori[sz]ed to send apple events/.test(evidence)) return 'automation_permission_denied'
  if (/(?:^|\D)-25211(?:\D|$)/.test(evidence) || /(?:not allowed assistive access|assistive access (?:is )?not allowed)/.test(evidence)) return 'accessibility_permission_denied'
  return undefined
}

/**
 * 发送与启动预检共用的窗口就绪边界。这个能力只读取/准备 WeChat 前台窗口，
 * 不接收会话标题或回复文本，也不搜索、写剪贴板或按回车。
 */
export class MacOsWeChatReadiness implements WeChatReadinessPort {
  constructor(private readonly dependencies: ReadinessDependencies) {}

  async checkReadiness(options: { restoreFocus?: boolean } = {}): Promise<{ success: boolean; stage?: 'automation'; error?: string }> {
    if (this.dependencies.platform !== 'darwin') return { success: false, stage: 'automation', error: 'unsupported_platform' }
    let previousApplication = ''
    if (options.restoreFocus) {
      try {
        previousApplication = await this.dependencies.runAppleScript(FOCUS_CAPTURE_SCRIPT, [])
      } catch (error) {
        return { success: false, stage: 'automation', error: permissionDeniedReason(error) ?? 'focus_capture_failed' }
      }
    }
    let result: { success: boolean; stage?: 'automation'; error?: string }
    try {
      const scriptResult = await this.dependencies.runAppleScript(PREPARE_WECHAT_WINDOW_SCRIPT, [])
      result = scriptResult === 'wechat-window-ready'
        ? { success: true }
        : { success: false, stage: 'automation', error: mapScriptResult(scriptResult) }
    } catch (error) {
      const permissionReason = permissionDeniedReason(error)
      result = permissionReason
        ? { success: false, stage: 'automation', error: permissionReason }
        // 此脚本不包含消息提交动作；即使运行器超时，也不能把它伪造成“消息可能已发送”。
        : { success: false, stage: 'automation', error: isTimeout(error) ? 'wechat_window_recovery_timeout' : 'wechat_window_recovery_failed' }
    }
    if (options.restoreFocus && previousApplication && previousApplication !== 'WeChat') {
      try {
        await this.dependencies.runAppleScript(FOCUS_RESTORE_SCRIPT, [previousApplication])
      } catch {
        // 启动预检没有消息动作，因此焦点恢复失败可以安全地阻止 running，无需进入发送后 verifier。
        if (result.success) return { success: false, stage: 'automation', error: 'focus_restore_failed' }
      }
    }
    return result
  }
}

export class MacOsWeChatTextAdapter implements SendTextAdapter {
  private readonly readiness: WeChatReadinessPort

  constructor(private readonly dependencies: AdapterDependencies, readiness?: WeChatReadinessPort) {
    this.readiness = readiness ?? new MacOsWeChatReadiness(dependencies)
  }

  checkReadiness(): ReturnType<WeChatReadinessPort['checkReadiness']> { return this.readiness.checkReadiness() }

  async sendText(input: { accountId: string; sessionId: string; conversationTitle?: string; text: string }): ReturnType<SendTextAdapter['sendText']> {
    if (this.dependencies.platform !== 'darwin') return { success: false, error: 'unsupported_platform' }
    const conversationTitle = String(input.conversationTitle || '').trim()
    if (!conversationTitle) return { success: false, error: 'conversation_title_required' }
    if (!input.text.trim()) return { success: false, error: 'empty_text' }
    let previousClipboard: Array<{ format: string; value: Buffer }> | string
    try {
      previousClipboard = this.captureClipboard()
    } catch {
      return { success: false, stage: 'automation', error: 'clipboard_capture_failed' }
    }
    let previousApplication = ''
    let result: { success: boolean; error?: string; stage?: 'automation'; sentAt?: number; actionMayHaveOccurred?: boolean; cleanupWarnings?: string[] }
    try {
      try {
        previousApplication = await this.dependencies.runAppleScript(FOCUS_CAPTURE_SCRIPT, [])
      } catch (error) {
        const permissionReason = permissionDeniedReason(error)
        return permissionReason
          ? { success: false, stage: 'automation', error: permissionReason }
          : { success: false, stage: 'automation', error: 'focus_capture_failed' }
      }
      try {
        const readiness = await this.readiness.checkReadiness()
        if (!readiness.success) {
          result = { success: false, stage: 'automation', error: readiness.error ?? 'wechat_window_recovery_failed' }
          return result
        }
        const scriptResult = await this.dependencies.runAppleScript(SEND_SCRIPT, [conversationTitle, input.text])
        const sentAt = this.dependencies.now?.() ?? Date.now()
        result = scriptResult === 'sent'
          ? { success: true, sentAt }
          // 回车调用返回失败时，系统可能已接收 key code 36；必须进入 WCDB 回读，不能按确定未发送开放重试。
          : scriptResult === 'input-submit-failed'
            ? { success: false, stage: 'automation', error: 'input_submit_failed', actionMayHaveOccurred: true, sentAt }
            : { success: false, stage: 'automation', error: mapScriptResult(scriptResult) }
      } catch (error) {
        const permissionReason = permissionDeniedReason(error)
        result = permissionReason
          ? { success: false, stage: 'automation', error: permissionReason }
          : isTimeout(error)
            ? { success: false, stage: 'automation', error: 'automation_timeout', actionMayHaveOccurred: true, sentAt: this.dependencies.now?.() ?? Date.now() }
            : { success: false, stage: 'automation', error: 'automation_failed', actionMayHaveOccurred: true, sentAt: this.dependencies.now?.() ?? Date.now() }
      }
    } catch (error) {
      void error
      result = { success: false, stage: 'automation', error: 'automation_failed' }
    } finally {
      const cleanupWarnings: string[] = []
      try { this.restoreClipboard(previousClipboard) } catch { cleanupWarnings.push('clipboard_restore_failed') }
      if (previousApplication && previousApplication !== 'WeChat') {
        try {
          await this.dependencies.runAppleScript(FOCUS_RESTORE_SCRIPT, [previousApplication])
        } catch { cleanupWarnings.push('focus_restore_failed') }
      }
      if (result! && cleanupWarnings.length > 0) result.cleanupWarnings = cleanupWarnings
    }
    return result!
  }

  private captureClipboard(): Array<{ format: string; value: Buffer }> | string {
    if (!this.dependencies.clipboard.availableFormats || !this.dependencies.clipboard.readBuffer) return this.dependencies.clipboard.readText()
    return this.dependencies.clipboard.availableFormats().map((format) => ({ format, value: this.dependencies.clipboard.readBuffer!(format) }))
  }

  private restoreClipboard(snapshot: Array<{ format: string; value: Buffer }> | string): void {
    if (typeof snapshot === 'string' || !this.dependencies.clipboard.clear || !this.dependencies.clipboard.writeBuffer) { this.dependencies.clipboard.writeText(typeof snapshot === 'string' ? snapshot : ''); return }
    this.dependencies.clipboard.clear()
    for (const entry of snapshot) this.dependencies.clipboard.writeBuffer(entry.format, entry.value)
  }
}

interface MessageRecord { messageKey?: string; localId?: number | null; isSend?: number | null; createTime?: number | null; parsedContent?: string | null; rawContent?: string | null }
interface ChatMessagesPort { getMessages(sessionId: string, offset: number, limit: number, startTime: number, endTime: number, ascending: boolean): Promise<{ success: boolean; messages?: MessageRecord[]; hasMore?: boolean }> }

export interface OutboundWatermark { keys: string[]; createTime: number; localId: number }

interface VerificationTiming {
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  verificationDeadlineMs?: number
  pollIntervalMs?: number
}

const comparePosition = (left: Pick<OutboundWatermark, 'createTime' | 'localId'>, right: Pick<OutboundWatermark, 'createTime' | 'localId'>): number =>
  left.createTime - right.createTime || left.localId - right.localId

export class WcdbOutboundVerifier implements OutboundVerifier {
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly verificationDeadlineMs: number
  private readonly pollIntervalMs: number

  constructor(private readonly chat: ChatMessagesPort, timing: VerificationTiming = {}) {
    this.now = timing.now ?? Date.now
    this.sleep = timing.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.verificationDeadlineMs = timing.verificationDeadlineMs ?? 2_500
    this.pollIntervalMs = timing.pollIntervalMs ?? 100
  }

  async captureBaseline(input: { accountId: string; sessionId: string }): Promise<OutboundWatermark> {
    const nowSeconds = Math.floor(this.now() / 1000)
    const pageSize = 50
    let latestOverall: OutboundWatermark = { keys: [], createTime: 0, localId: 0 }
    let latestOutbound: OutboundWatermark | undefined
    for (let page = 0; page < 20; page += 1) {
      const result = await this.chat.getMessages(input.sessionId, page * pageSize, pageSize, 0, nowSeconds + 1, false)
      if (!result.success || !Array.isArray(result.messages)) throw new Error('verification_baseline_failed')
      for (const message of result.messages) {
        const position = { createTime: Number(message.createTime || 0), localId: Number(message.localId || 0) }
        if (comparePosition(position, latestOverall) > 0) latestOverall = { ...position, keys: [] }
        if (message.isSend === 1 && (!latestOutbound || comparePosition(position, latestOutbound) > 0)) {
          latestOutbound = { ...position, keys: message.messageKey ? [message.messageKey] : [] }
        }
      }
      const hasMore = result.hasMore === true || result.messages.length === pageSize
      if (!hasMore) return { ...latestOverall, keys: latestOutbound?.keys ?? [] }
    }
    throw new Error('verification_baseline_unbounded')
  }

  async verify(input: { accountId: string; sessionId: string; text: string; sentAt: number; watermark?: unknown }): Promise<{ success: boolean; error?: string; verifiedMessageKey?: string }> {
    const sentSeconds = Math.floor(input.sentAt / 1000)
    const watermark = input.watermark && typeof input.watermark === 'object' && Array.isArray((input.watermark as OutboundWatermark).keys)
      ? input.watermark as OutboundWatermark
      : { keys: [], createTime: sentSeconds - 1, localId: 0 }
    const knownKeys = new Set(watermark.keys)
    const deadline = this.now() + this.verificationDeadlineMs
    while (true) {
      const pageSize = 50
      for (let page = 0; page < 20; page += 1) {
        const result = await this.chat.getMessages(input.sessionId, page * pageSize, pageSize, Math.max(0, sentSeconds - 2), sentSeconds + 10, false)
        if (!result.success || !Array.isArray(result.messages)) return { success: false, error: 'verification_read_failed' }
        const match = result.messages.find((message) => {
          const createTime = Number(message.createTime || 0)
          const localId = Number(message.localId || 0)
          const isNewPosition = createTime > watermark.createTime || (createTime === watermark.createTime && localId > watermark.localId)
          return message.isSend === 1 && !knownKeys.has(String(message.messageKey || '')) && isNewPosition && createTime >= sentSeconds - 1 && String(message.parsedContent || message.rawContent || '').trim() === input.text.trim()
        })
        if (match?.messageKey) return { success: true, verifiedMessageKey: match.messageKey }
        const hasMore = result.hasMore === true || result.messages.length === pageSize
        if (!hasMore) break
        if (page === 19) return { success: false, error: 'verification_unbounded' }
      }
      const remaining = deadline - this.now()
      if (remaining <= 0) return { success: false, error: 'outbound_not_verified' }
      await this.sleep(Math.min(this.pollIntervalMs, remaining))
    }
  }
}
