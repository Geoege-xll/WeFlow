import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { computeChatResponsiveLayout } from '../src/pages/Chat/chatResponsiveLayout'

describe('R6 Chat responsive layout policy', () => {
  it('matches the approved minimum, regular, and wide detail geometries', () => {
    expect(computeChatResponsiveLayout(859, 260)).toEqual({
      sessionWidth: 260,
      messageWidth: 587,
      queueWidth: 0,
      compactHeader: false
    })

    expect(computeChatResponsiveLayout(1039, 260)).toEqual({
      sessionWidth: 260,
      messageWidth: 767,
      queueWidth: 0,
      compactHeader: false
    })

    expect(computeChatResponsiveLayout(1199, 260)).toEqual({
      sessionWidth: 260,
      messageWidth: 927,
      queueWidth: 0,
      compactHeader: false
    })
  })

  it('keeps the six-action desktop header at the standard window geometry and compacts only below its measured fit floor', () => {
    expect(computeChatResponsiveLayout(1017, 260).compactHeader).toBe(false)
    expect(computeChatResponsiveLayout(1018, 260).compactHeader).toBe(false)
    // ResizeObserver reports the content box, which excludes ChatPage's 24px horizontal padding.
    expect(computeChatResponsiveLayout(993, 260).compactHeader).toBe(false)
    expect(computeChatResponsiveLayout(1039, 260).compactHeader).toBe(false)
    expect(computeChatResponsiveLayout(600, 260)).toMatchObject({ messageWidth: 328, compactHeader: true })
  })

  it('accounts for conditional actions instead of allowing an overfull desktop toolbar to wrap', () => {
    expect(computeChatResponsiveLayout(993, 260, 6).compactHeader).toBe(false)
    expect(computeChatResponsiveLayout(680, 260, 7).compactHeader).toBe(true)
    expect(computeChatResponsiveLayout(680, 260, 9).compactHeader).toBe(true)
    expect(computeChatResponsiveLayout(1092, 260, 9).compactHeader).toBe(false)
  })

  it('clamps the preferred session width and accounts for the single real grid gap', () => {
    const narrowPreference = computeChatResponsiveLayout(1199, 120)
    const widePreference = computeChatResponsiveLayout(1199, 520)

    expect(narrowPreference.sessionWidth).toBe(250)
    expect(widePreference.sessionWidth).toBe(260)
    for (const layout of [narrowPreference, widePreference]) {
      expect(layout.sessionWidth + layout.messageWidth + layout.queueWidth + 12).toBe(1199)
    }
  })

  it('returns finite integral widths for missing and non-finite measurements', () => {
    for (const availableWidth of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const layout = computeChatResponsiveLayout(availableWidth, Number.NaN)
      expect(Object.values(layout).every((value) => typeof value === 'boolean' || Number.isFinite(value))).toBe(true)
      expect(Number.isInteger(layout.sessionWidth)).toBe(true)
      expect(Number.isInteger(layout.messageWidth)).toBe(true)
      expect(Number.isInteger(layout.queueWidth)).toBe(true)
    }
  })
})

describe('R6 Chat page responsive DOM contract', () => {
  const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
  const chatStyles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')
  const omniMindStyles = readFileSync(resolve(process.cwd(), 'src/features/omnimind/omnimind.scss'), 'utf8')

  it('observes only the normal Chat root and publishes the computed column widths', () => {
    expect(chatPage).toContain("import { computeChatResponsiveLayout }")
    expect(chatPage).toContain('new ResizeObserver')
    expect(chatPage).toContain('if (standaloneSessionWindow)')
    expect(chatPage).toContain('computeChatResponsiveLayout(chatContainerWidth, undefined, desktopHeaderActionCount)')
    expect(chatPage).toContain("'--chat-session-width': `${responsiveLayout.sessionWidth}px`")
    expect(chatPage).toContain('const compactHeader = !standaloneSessionWindow && responsiveLayout.compactHeader')
    expect(chatPage).not.toContain('compactHeader={compactHeader}')
  })

  it('keeps normal Chat as a pure split view and preserves the standalone composer policy', () => {
    expect(chatPage).not.toContain('<OmniMindHostingCenterDialog')
    expect(chatPage).not.toContain('open-hosting-settings')
    expect(chatPage).not.toContain('hosting-status-capsule')
    expect(chatPage).not.toContain('托管设置')
    expect(chatPage).not.toContain('showQueueDrawer')
    expect(chatPage).toContain('getOmniMindChatMountPolicy(standaloneSessionWindow, Boolean(currentSession), currentSession?.username).composer')
    expect(chatStyles).toMatch(/\.chat-page\.standalone\s*\{[^}]*display:\s*flex/s)
  })

  it('uses a zero-overflow grid without the superseded fixed minimum widths', () => {
    const combinedStyles = `${chatStyles}\n${omniMindStyles}`
    expect(combinedStyles).not.toContain('min-width: 1080px')
    expect(combinedStyles).not.toContain('overflow-x: auto')
    expect(combinedStyles).not.toMatch(/\.chat-page:not\(\.standalone\)[^{]*\{[^}]*min-width:\s*1080px/s)
    expect(combinedStyles).not.toMatch(/\.chat-page:not\(\.standalone\)[^{]*\{[^}]*overflow-x:\s*auto/s)
    expect(combinedStyles).not.toMatch(/\.chat-page:not\(\.standalone\)[^{]*\.session-sidebar\s*\{[^}]*min-width:\s*240px/s)
    expect(combinedStyles).not.toMatch(/\.chat-page:not\(\.standalone\)[^{]*\.message-area\s*\{[^}]*min-width:\s*520px/s)
    expect(chatStyles).toContain('var(--chat-session-width, 260px) minmax(0, 1fr)')
    expect(chatStyles).toMatch(/\.chat-page:not\(\.standalone\)\s*\{[^}]*display:\s*grid[^}]*gap:\s*12px/s)
    expect(chatPage).not.toContain('className="omnimind-queue-separator"')
    expect(chatPage).not.toContain('className="resize-handle"')
    expect(chatPage).not.toContain('handleResizeStart')
    expect(chatPage).not.toContain('isResizing')
    expect(chatStyles).toMatch(/\.chat-page:not\(\.standalone\)\s*\{[^}]*overflow:\s*hidden/s)
    expect(chatStyles).toMatch(/\.message-area\s*\{[^}]*min-width:\s*0/s)
    expect(omniMindStyles).toMatch(/\.omnimind-queue-panel\s*\{[^}]*min-width:\s*0/s)
  })
})
