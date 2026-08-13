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
  it('keeps the degraded hosting switch active', async () => {
    installOmniMindApi({ runtimeState: 'degraded', waiting: [], recent: [] })

    render(<OmniMindQueuePanel />)

    expect(await screen.findByText('队列保留，自动接入受限')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '自动托管' }).getAttribute('aria-checked')).toBe('true')
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
      showGroupSummaryPanel={false}
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
      compactHeader
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

  it('gives every session-row variant one 44px avatar rhythm and keyboard selection semantics', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')

    expect(chatPage).not.toContain('size={48}')
    expect(chatPage.match(/role="option"/g)?.length).toBeGreaterThanOrEqual(3)
    expect(chatPage.match(/aria-selected=\{isActive\}/g)?.length).toBeGreaterThanOrEqual(3)
    expect(chatPage).toContain("event.key === 'Enter' || event.key === ' '")
    expect((chatPage.match(/role="listbox"/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(styles).toMatch(/\.session-item\s*\{[^}]*min-height:\s*68px/s)
    expect(styles).toMatch(/\.fold-entry-avatar[^}]*width:\s*44px[^}]*height:\s*44px/s)
    expect(styles).toMatch(/\.biz-entry-avatar[^}]*width:\s*44px[^}]*height:\s*44px/s)
    expect(styles).toContain('font-variant-numeric: tabular-nums')
  })

  it('keeps both session-list commands labelled, busy-aware, and 44px keyboard targets', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')
    expect(chatPage).toContain('aria-label="刷新会话"')
    expect(chatPage).toContain('aria-busy={isLoadingSessions || isRefreshingSessions}')
    expect(chatPage).toContain('aria-busy={isMarkingAllSessionsRead}')
    expect(styles).toMatch(/\.session-header[^]*?\.icon-btn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
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
