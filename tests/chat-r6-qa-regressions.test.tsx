// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindSnapshot } from '../shared/omnimind/contracts'
import { OmniMindQueuePanel } from '../src/features/omnimind/OmniMindQueuePanel'
import ChatHeader from '../src/pages/Chat/ChatHeader'

afterEach(cleanup)

const settings = {
  schemaVersion: 2 as const,
  pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
  managedScope: {
    mode: 'selected' as const,
    conversations: [{ sessionId: 'alice', displayName: 'Alice' }]
  },
  autoSend: true,
  ignoreOfficial: true,
  hasApiKey: true,
  batchWindowMs: 2000,
  requestTimeoutMs: 15000
}

const installOmniMindApi = (snapshot: OmniMindSnapshot): void => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      omniMind: {
        getSnapshot: async () => snapshot,
        getSettings: async () => settings,
        onSnapshotChanged: () => () => undefined,
        enable: vi.fn(),
        disable: vi.fn(),
        saveSettings: vi.fn(),
        cancelTask: vi.fn(),
        retryTask: vi.fn(),
        sendGeneratedReply: vi.fn(),
        abandonGeneratedReply: vi.fn()
      }
    }
  })
}

describe('R6 QA runtime-state regressions', () => {
  it('keeps the degraded hosting status active', async () => {
    installOmniMindApi({ runtimeState: 'degraded', waiting: [], recent: [] })

    render(<OmniMindQueuePanel />)

    expect(await screen.findByText('队列保留，自动接入受限')).toBeTruthy()
    const queue = screen.getByRole('complementary', { name: 'OmniMind 托管' })
    expect(queue.classList).toContain('runtime-degraded')
    expect(screen.queryByRole('switch', { name: '自动托管' })).toBeNull()
  })

  it('does not present a degraded empty queue as stopped', async () => {
    installOmniMindApi({ runtimeState: 'degraded', waiting: [], recent: [] })

    render(<OmniMindQueuePanel />)

    expect(await screen.findByText('队列保留，自动接入受限')).toBeTruthy()
    expect(screen.queryByText('自动托管已停止')).toBeNull()
  })

  it('exposes a failed runtime as an actionable alert instead of a stopped empty queue', async () => {
    installOmniMindApi({
      runtimeState: 'failed',
      waiting: [],
      recent: [],
      error: 'subscriber_bootstrap_failed'
    })

    render(<OmniMindQueuePanel />)

    expect(await screen.findByText('启动失败')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('启动失败')
    expect(screen.queryByText('自动托管已停止')).toBeNull()
  })
})

describe('R6 QA accessible responsive workbench regressions', () => {
  it('moves focus into the compact-header overflow when it opens', async () => {
    render(<ChatHeader
      session={{ username: 'alice', displayName: 'Alice', type: 1, unreadCount: 0, summary: '', sortTimestamp: 0, lastTimestamp: 0, lastMsgType: 1 }}
      isGroupChat={false}
      standaloneSessionWindow={false}
      showGroupMembersPanel={false}
      showJumpPopover={false}
      showInSessionSearch={false}
      showDetailPanel={false}
      aiGroupSummaryEnabled={false}
      shouldHideStandaloneDetailButton={false}
      isPrivateSnsSupported={false}
      isExportActionBusy={false}
      isCurrentSessionExporting={false}
      isPreparingExportDialog={false}
      isBatchTranscribing={false}
      isBatchDecrypting={false}
      isTriggeringSessionInsight={false}
      isRefreshingMessages={false}
      isLoadingMessages={false}
      currentSessionId="alice"
      jumpCalendarWrapRef={createRef<HTMLDivElement>()}
      onTriggerSessionInsight={vi.fn()}
      onToggleGroupSummaryPanel={vi.fn()}
      onGroupAnalytics={vi.fn()}
      onToggleGroupMembersPanel={vi.fn()}
      onExportCurrentSession={vi.fn()}
      onOpenSnsTimeline={vi.fn()}
      onBatchTranscribe={vi.fn()}
      onBatchDecrypt={vi.fn()}
      onToggleJumpPopover={vi.fn()}
      onToggleInSessionSearch={vi.fn()}
      onRefreshMessages={vi.fn()}
      onToggleDetailPanel={vi.fn()}
    />)

    const trigger = screen.getByRole('button', { name: '更多会话操作' })
    trigger.focus()
    fireEvent.click(trigger)
    const firstItem = screen.getByRole('menuitem', { name: '立即触发当前聊天 AI 见解' })

    await waitFor(() => expect(document.activeElement).toBe(firstItem))
    expect(screen.queryByRole('menuitem', { name: '跳转到指定时间' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '搜索会话消息' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '会话详情' })).toBeNull()
  })

  it('uses the approved sessions and messages landmarks', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')

    expect(
      /<nav\s+[^>]*id="chat-session-list"/s.test(chatPage),
      'the session surface must be a nav landmark'
    ).toBe(true)
    expect(
      /<main\s+[^>]*id="chat-message-area"/s.test(chatPage),
      'the message surface must be a main landmark'
    ).toBe(true)
  })

  it('gives every session-row variant one 40px avatar rhythm and keyboard selection semantics', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')

    expect(chatPage).not.toContain('size={48}')
    expect(chatPage.match(/role="option"/g)?.length).toBeGreaterThanOrEqual(3)
    expect(chatPage.match(/aria-selected=\{isActive\}/g)?.length).toBeGreaterThanOrEqual(3)
    expect(chatPage).toContain("event.key === 'Enter' || event.key === ' '")
    expect((chatPage.match(/role="listbox"/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(styles).toMatch(/\.session-item\s*\{[^}]*min-height:\s*60px/s)
    expect(chatPage).toContain('className="session-list-avatar fold-entry-avatar"')
    expect(chatPage).toContain('className="session-list-avatar biz-entry-avatar"')
    expect(styles).toMatch(/\.session-list-avatar\s*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*flex:\s*0 0 40px/s)
    expect(styles).toContain('font-variant-numeric: tabular-nums')
  })

  it('renders the public-account secondary list as a full-width state with the approved row rhythm', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const chatStyles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')
    const bizStyles = readFileSync(resolve(process.cwd(), 'src/pages/BizPage.scss'), 'utf8')

    expect(chatPage).toContain('aria-label="返回会话列表"')
    expect(chatPage).not.toContain("<div style={{ height: '100%', overflowY: 'auto' }}>")
    expect(chatStyles).toMatch(/\.session-list-panel[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/s)
    expect(chatStyles).toMatch(/&\.folded[^]*?\.folded-panel[^}]*visibility:\s*visible[^}]*pointer-events:\s*auto/s)
    expect(bizStyles).toMatch(/\.biz-account-item\s*\{[^}]*min-height:\s*(?:56|64)px/s)
    expect(bizStyles).toMatch(/\.biz-avatar\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s)
    expect(bizStyles).toMatch(/\.biz-name\s*\{[^}]*font-size:\s*15px[^}]*font-weight:\s*600/s)
    expect(bizStyles).toMatch(/\.biz-time\s*\{[^}]*font-size:\s*12px/s)
  })

  it('uses one named avatar reservation per chat context and a bounded media shell', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const bubble = readFileSync(resolve(process.cwd(), 'src/pages/Chat/ChatMessageBubble.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')

    expect(bubble).toContain('className="message-avatar-slot"')
    expect(bubble).toContain('message-avatar')
    expect(bubble).not.toContain('className="bubble-avatar"')
    expect(chatPage).toContain('className={session.username.includes(\'@chatroom\') ? \'group session-list-avatar\' : \'session-list-avatar\'}')
    expect(styles).toMatch(/\.message-avatar-slot\s*\{[^}]*flex:\s*0 0 36px[^}]*width:\s*36px/s)
    expect(styles).toMatch(/\.message-avatar\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*overflow:\s*hidden/s)
    expect(styles).toMatch(/\.session-list-avatar\s*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*flex:\s*0 0 40px[^}]*object-fit:\s*cover/s)
    expect(styles).toMatch(/\.message-bubble\.(?:image|video)\s+\.bubble-content\s*\{[^}]*border:\s*1px solid var\(--border-color\)[^}]*border-radius:[^}]*overflow:\s*hidden/s)
    expect(styles).not.toMatch(/\.bubble-content:has\(> \.image-(?:message|stage|message-wrapper)\)/)
  })

  it('keeps session-list commands and search clearing labelled, busy-aware, and appropriately sized', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')
    expect(chatPage).toContain('aria-label="刷新会话"')
    expect(chatPage).toContain('aria-busy={isLoadingSessions || isRefreshingSessions}')
    expect(chatPage).toContain('aria-busy={isMarkingAllSessionsRead}')
    // 回归锁定真实按钮的紧凑盒模型与状态样式
    expect(styles).toMatch(/\.session-header[^]*?\.refresh-btn[^]*?width:\s*32px\s*!important[^}]*height:\s*32px\s*!important/s)
    expect(styles).toMatch(/\.session-header[^]*?\.close-search\s*\{[^}]*width:\s*20px[^}]*height:\s*20px/s)
  })

  it('makes the queue landmark a real programmatic skip-link focus target', async () => {
    installOmniMindApi({ runtimeState: 'running', waiting: [], recent: [] })

    render(<OmniMindQueuePanel />)

    const queue = await screen.findByRole('complementary', { name: 'OmniMind 托管' })
    expect(queue.getAttribute('tabindex')).toBe('-1')
    queue.focus()
    expect(document.activeElement).toBe(queue)
  })

  it('lets the topmost compact overflow consume Escape before an open inspector', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const inspectorHandlerStart = chatPage.indexOf('const handleInspectorEscape')
    const inspectorHandlerEnd = chatPage.indexOf("document.addEventListener('keydown', handleInspectorEscape)", inspectorHandlerStart)
    const inspectorEscapeHandler = chatPage.slice(inspectorHandlerStart, inspectorHandlerEnd)

    expect(inspectorHandlerStart).toBeGreaterThan(-1)
    expect(inspectorHandlerEnd).toBeGreaterThan(inspectorHandlerStart)
    expect(
      inspectorEscapeHandler.includes('chat-header-more-menu'),
      'the inspector Escape handler must defer while the compact overflow menu is the topmost layer'
    ).toBe(true)
  })

  it('implements compact-inspector Escape dismissal and focus restoration', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const hasEscapeDismissal = /event\.key\s*!==?\s*['"]Escape['"]|event\.key\s*===?\s*['"]Escape['"]/.test(chatPage)
    const restoresInspectorTriggerFocus = /(?:detail|inspector)\w*Ref\.current\?\.focus\(\)/i.test(chatPage)

    expect(
      hasEscapeDismissal && restoresInspectorTriggerFocus,
      'the compact inspector must close on Escape and restore its trigger focus'
    ).toBe(true)
  })
})
