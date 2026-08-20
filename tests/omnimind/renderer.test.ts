import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildQueueViewModel } from '../../src/features/omnimind/OmniMindQueueViewModel'
import { OMNIMIND_SETTINGS_TABS, omniMindZhCN } from '../../src/features/omnimind/locale'

describe('OmniMind renderer contract', () => {
  it('keeps one four-section settings navigation contract without legacy strategy or timing identities', () => {
    expect(OMNIMIND_SETTINGS_TABS).toEqual([
      { id: 'connection', label: '连接与凭据' },
      { id: 'scope', label: '托管范围' },
      { id: 'response', label: '回复与时序' },
      { id: 'permissions', label: '权限中心' }
    ])
    expect(omniMindZhCN.settings.tabs).toEqual(Object.fromEntries(OMNIMIND_SETTINGS_TABS.map(({ id, label }) => [id, label])))
    expect(omniMindZhCN.hostingCenter.tabs).toEqual({ overview: '概览与队列', ...omniMindZhCN.settings.tabs })
    expect(omniMindZhCN.settings.tabs).not.toHaveProperty('strategy')
    expect(omniMindZhCN.settings.tabs).not.toHaveProperty('timing')
  })

  it('maps authoritative task states into current, waiting, and recent groups', () => {
    const base = { accountId: 'a', sessionId: 's', sessionName: 'Alice', messageKeys: ['m'], text: 'x', createdAt: 1, updatedAt: 1 }
    const view = buildQueueViewModel({ runtimeState: 'running', current: { ...base, id: '1', status: 'sending' }, waiting: [{ ...base, id: '2', status: 'queued' }], recent: [{ ...base, id: '3', status: 'send_failed', failureStage: 'verification_baseline', reason: 'verification_baseline_failed', replyText: 'preserved' }] })
    expect(view.current?.statusLabel).toBe(omniMindZhCN.taskStatus.sending)
    expect(view.waiting).toHaveLength(1)
    expect(view.recent[0].canRetry).toBe(true)
    expect(view.recent[0]).toMatchObject({ hasGeneratedReply: true, replyText: 'preserved', statusLabel: '发送准备失败' })
  })

  it('keeps critical user copy in the feature locale table', () => {
    const components = ['OmniMindQueuePanel.tsx', 'OmniMindHostingHeader.tsx', 'OmniMindHostingSettingsModal.tsx', 'OmniMindManualMessageComposer.tsx']
      .map((file) => readFileSync(new URL(`../../src/features/omnimind/${file}`, import.meta.url), 'utf8')).join('\n')
    expect(components).toContain('omniMindZhCN')
    expect(components).not.toContain('自动托管运行中')
    expect(components).not.toContain('正在发送')
  })

  it('mounts hosting only on Home and preserves the Chat manual-composer policy', () => {
    const chatPage = readFileSync(new URL('../../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
    const home = readFileSync(new URL('../../src/features/home/HomeWorkbench.tsx', import.meta.url), 'utf8')
    const homeQueue = readFileSync(new URL('../../src/features/home/HomeQueuePanel.tsx', import.meta.url), 'utf8')
    expect(home).toContain('useOmniMind()')
    expect(homeQueue).toContain('全局串行队列')
    expect(home).toContain('OmniMindHostingSettingsModal')
    expect(chatPage).not.toContain('<OmniMindHostingCenterDialog')
    expect(chatPage).not.toContain('showQueueDrawer')
    expect(chatPage).not.toContain('<OmniMindQueuePanel')
    expect(chatPage).not.toContain('自动托管')
    expect(chatPage).not.toContain('托管设置')
    expect(chatPage).toContain('getOmniMindChatMountPolicy(standaloneSessionWindow, Boolean(currentSession), currentSession?.username).composer && currentSession && myWxid && <OmniMindManualMessageComposer')
    expect(chatPage).toContain('recoveryActionScope="conversation-only"')
    const styles = readFileSync(new URL('../../src/features/omnimind/omnimind.scss', import.meta.url), 'utf8')
    expect(styles).toContain('.omnimind-hosting-center .omnimind-queue-panel.is-embedded')
    expect(styles).toContain('min-width: 0')
    expect(chatPage).not.toContain('omnimind-queue-separator')
  })

  it('keeps sections permanent and removes the obsolete horizontal-scroll fallback', () => {
    const panel = readFileSync(new URL('../../src/features/omnimind/OmniMindQueuePanel.tsx', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('../../src/features/omnimind/omnimind.scss', import.meta.url), 'utf8')
    expect(panel).not.toContain('omnimind-narrow-hint')
    expect(styles).not.toContain('overflow-x: auto')
    expect(styles).not.toContain('min-width: 1080px')
  })

  it('uses token-owned queue hierarchy for header, metric cards, state cards, sections, and task cards', () => {
    const panel = readFileSync(new URL('../../src/features/omnimind/OmniMindQueuePanel.tsx', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('../../src/features/omnimind/omnimind.scss', import.meta.url), 'utf8')
    expect(panel).toContain('runtime-${view.runtimeState}')
    expect(panel).toContain('omnimind-state-card')
    expect(panel).toContain('state-empty')
    expect(panel).toContain('state-loading')
    expect(panel).toContain('state-error')
    expect(panel).toContain('state-permission')
    expect(styles).toMatch(/\.omnimind-hosting-header\s*\{[^}]*padding:[^}]*background:\s*var\(--(?:bg-secondary|card-bg)\)/s)
    expect(styles).toMatch(/\.omnimind-queue-metrics\s*\{[^}]*display:\s*grid/s)
    expect(styles).toMatch(/\.omnimind-queue-metrics\s*>\s*div\s*\{[^}]*background:\s*var\(--bg-tertiary\)[^}]*border-radius:/s)
    expect(styles).toMatch(/\.omnimind-state-card\s*\{[^}]*background:\s*var\(--bg-tertiary\)[^}]*border-radius:/s)
    expect(styles).toMatch(/\.omnimind-task\s*\{[^}]*background:\s*var\(--bg-tertiary\)[^}]*border-radius:/s)
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('uses the project Lucide icon set for the R6 queue chrome', () => {
    const iconComponents = ['OmniMindHostingHeader.tsx', 'OmniMindQueueTaskItem.tsx']
      .map((file) => readFileSync(new URL(`../../src/features/omnimind/${file}`, import.meta.url), 'utf8'))
      .join('\n')
    expect(iconComponents).toContain("from 'lucide-react'")
    expect(iconComponents).not.toContain('<svg')
  })

  it('keeps recovery actions at 44px with a visible keyboard focus treatment', () => {
    const styles = readFileSync(new URL('../../src/features/omnimind/omnimind.scss', import.meta.url), 'utf8')
    expect(styles).toMatch(/\.omnimind-recovery-actions button\s*\{[^}]*min-height:\s*44px/)
    expect(styles).toMatch(/\.omnimind-recovery-actions button:focus-visible\s*\{[^}]*outline:/)
    expect(styles).toMatch(/\.omnimind-runtime-notice \.omnimind-recovery-confirm\s*\{[^}]*min-height:\s*44px/)
    expect(styles).toMatch(/\.omnimind-runtime-notice \.omnimind-recovery-confirm:focus-visible\s*\{[^}]*outline:\s*3px/)
  })

  it('keeps permission copy locale-owned and permission affordances accessible', () => {
    const components = ['OmniMindPermissionCenter.tsx', 'OmniMindHostingHeader.tsx', 'OmniMindHostingSettingsModal.tsx']
      .map((file) => readFileSync(new URL(`../../src/features/omnimind/${file}`, import.meta.url), 'utf8')).join('\n')
    const styles = readFileSync(new URL('../../src/features/omnimind/omnimind.scss', import.meta.url), 'utf8')
    expect(components).toContain('omniMindZhCN')
    expect(components).not.toContain('打开系统设置')
    expect(components).not.toContain('data-prototype-')
    expect(styles).toMatch(/\.omnimind-permission-actions button\s*\{[^}]*min-height:\s*44px/)
    expect(styles).toMatch(/\.omnimind-permission-card:focus-visible[^}]*outline:\s*3px/)
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('keeps the portalled settings layer isolated from the application background', () => {
    const modal = readFileSync(new URL('../../src/features/omnimind/OmniMindHostingSettingsModal.tsx', import.meta.url), 'utf8')
    expect(modal).toContain("document.getElementById('root')")
    expect(modal).toContain("applicationRoot.setAttribute('aria-hidden', 'true')")
    expect(modal).toContain('applicationRoot.inert = true')
    expect(modal).toContain('createPortal(')
  })

  it('resolves the settings dialog focus ring through the active production theme token', () => {
    const styles = readFileSync(new URL('../../src/features/omnimind/omnimind.scss', import.meta.url), 'utf8')

    expect(styles).toMatch(/\.omnimind-settings-modal[^}]*--omnimind-focus-ring:\s*var\(--primary\)/)
  })

  it('keys the production composer by account and session identity', () => {
    const chatPage = readFileSync(new URL('../../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
    expect(chatPage).toMatch(/<OmniMindManualMessageComposer\s+key=\{`\$\{myWxid\}[^`]*\$\{currentSession\.username\}`\}\s+accountId=\{myWxid\}\s+sessionId=\{currentSession\.username\}/)
  })

  it('injects the current account identity into the composer ownership key', () => {
    const chatPage = readFileSync('src/pages/ChatPage.tsx', 'utf8')
    expect(chatPage).toContain('accountId={myWxid}')
    expect(chatPage).toMatch(/key=\{`\$\{myWxid\}[^`]*\$\{currentSession\.username\}`\}/)
  })

  it('invalidates composer account readiness synchronously when the account changes', () => {
    const chatPage = readFileSync('src/pages/ChatPage.tsx', 'utf8')
    expect(chatPage).toMatch(/const handleAccountChanged = useCallback\(async \(\) => \{\s*invalidateComposerAccount\(\)/)
    expect(chatPage).toContain('const accountRequest = beginComposerAccountConnect()')
    expect(chatPage).toContain('completeComposerAccountConnect(accountRequest, wxid)')
  })
})
