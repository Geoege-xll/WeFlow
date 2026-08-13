import type { OutboundVerifier, SendTextAdapter } from './unified-sender'

interface ClipboardPort { readText(): string; writeText(value: string): void; availableFormats?(): string[]; readBuffer?(format: string): Buffer; clear?(): void; writeBuffer?(format: string, value: Buffer): void }
interface AdapterDependencies { platform: NodeJS.Platform; clipboard: ClipboardPort; runAppleScript: (script: string, args: string[]) => Promise<string>; now?: () => number }

export const buildOsascriptArguments = (script: string, args: string[]): string[] => ['-e', script, '--', ...args]

export const SEND_SCRIPT = String.raw`
on run argv
  set expectedTitle to item 1 of argv
  set replyText to item 2 of argv
  tell application "System Events"
    if not (exists process "WeChat") then return "accessibility"
    tell process "WeChat"
      set frontmost to true
      if (count of windows) is 0 then return "accessibility"
      keystroke "f" using command down
      delay 0.3
      set searchFields to {}
      repeat with candidate in entire contents of window 1
        try
          if role of candidate is "AXTextField" and enabled of candidate is true and focused of candidate is true then set end of searchFields to candidate
        end try
      end repeat
      if (count of searchFields) is not 1 then return "accessibility"
      set the clipboard to expectedTitle
      keystroke "a" using command down
      keystroke "v" using command down
      delay 0.4
      set resultCandidates to {}
      repeat with candidate in entire contents of window 1
        try
          set candidateActions to name of every action of candidate
          if (name of candidate as text) is expectedTitle and enabled of candidate is true and (candidateActions contains "AXPress") then set end of resultCandidates to candidate
        end try
      end repeat
      if (count of resultCandidates) is not 1 then return "ambiguous-target"
      try
        perform action "AXPress" of item 1 of resultCandidates
      on error
        return "accessibility"
      end try
      delay 0.4
      set activeTitle to ""
      try
        set titleElement to value of attribute "AXTitleUIElement" of window 1
        set activeTitle to name of titleElement as text
      on error
        return "target-mismatch"
      end try
      if activeTitle is not expectedTitle then return "target-mismatch"
      set inputCandidates to {}
      repeat with candidate in entire contents of window 1
        try
          if role of candidate is "AXTextArea" and enabled of candidate is true then set end of inputCandidates to candidate
        end try
      end repeat
      if (count of inputCandidates) is 0 then return "input-unavailable"
      if (count of inputCandidates) is not 1 then return "ambiguous-input"
      try
        click item 1 of inputCandidates
        set the clipboard to replyText
        keystroke "v" using command down
        delay 0.3
        key code 36
      on error
        return "accessibility"
      end try
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

export class MacOsWeChatTextAdapter implements SendTextAdapter {
  constructor(private readonly dependencies: AdapterDependencies) {}

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
        previousApplication = await this.dependencies.runAppleScript('tell application "System Events" to return name of first application process whose frontmost is true', [])
      } catch (error) {
        const permissionReason = this.permissionDeniedReason(error)
        return permissionReason
          ? { success: false, stage: 'automation', error: permissionReason }
          : { success: false, stage: 'automation', error: 'focus_capture_failed' }
      }
      try {
        const scriptResult = await this.dependencies.runAppleScript(SEND_SCRIPT, [conversationTitle, input.text])
        result = scriptResult === 'sent'
          ? { success: true, sentAt: this.dependencies.now?.() ?? Date.now() }
          : { success: false, stage: 'automation', error: this.mapScriptResult(scriptResult) }
      } catch (error) {
        const permissionReason = this.permissionDeniedReason(error)
        result = permissionReason
          ? { success: false, stage: 'automation', error: permissionReason }
          : this.isTimeout(error)
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

  private mapScriptResult(result: string): string {
    return ({
      accessibility: 'accessibility_permission_denied',
      'ambiguous-target': 'target_ambiguous',
      'target-mismatch': 'target_mismatch',
      'input-unavailable': 'input_unavailable',
      'ambiguous-input': 'input_ambiguous'
    } as Record<string, string>)[result] ?? 'automation_failed'
  }

  private isTimeout(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as { code?: unknown; killed?: unknown; signal?: unknown }
    return value.code === 'ETIMEDOUT' || value.killed === true || value.signal === 'SIGTERM'
  }

  private permissionDeniedReason(error: unknown): 'accessibility_permission_denied' | 'automation_permission_denied' | undefined {
    if (!error || typeof error !== 'object') return undefined
    const value = error as { code?: unknown; message?: unknown; stdout?: unknown; stderr?: unknown }
    const evidence = [value.code, value.message, value.stdout, value.stderr]
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      .join('\n')
      .toLocaleLowerCase('en-US')
    if (/(?:^|\D)-1743(?:\D|$)/.test(evidence) || /not authori[sz]ed to send apple events/.test(evidence)) return 'automation_permission_denied'
    if (/(?:^|\D)-25211(?:\D|$)/.test(evidence) || /(?:not allowed assistive access|assistive access (?:is )?not allowed)/.test(evidence)) return 'accessibility_permission_denied'
    return undefined
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
