// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendOmniMindSnapshotToMainWindow } from '../../electron/omnimind/snapshot-target'
import { getOmniMindChatMountPolicy } from '../../src/features/omnimind/chatMountPolicy'
import { OmniMindManualMessageComposer } from '../../src/features/omnimind/OmniMindManualMessageComposer'
import { omniMindZhCN } from '../../src/features/omnimind/locale'

const Surfaces = ({ standalone, hasSession }: { standalone: boolean; hasSession: boolean }) => {
  const policy = getOmniMindChatMountPolicy(standalone, hasSession)
  return <>{policy.composer && <OmniMindManualMessageComposer sessionId="session-a" />}</>
}

afterEach(cleanup)

describe('public window and Chat mount policy', () => {
  it('broadcasts only to the authoritative main window', () => {
    const send = vi.fn()
    expect(sendOmniMindSnapshotToMainWindow({ isDestroyed: () => false, webContents: { send } }, { runtimeState: 'stopped' })).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(sendOmniMindSnapshotToMainWindow(null, {})).toBe(false)
  })

  it('mounts one real manual composer on normal Chat and never mounts the hosting queue', () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'stopped', waiting: [], recent: [] }),
      getSettings: async () => ({ schemaVersion: 4, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', managedScope: { mode: 'selected', conversations: [] }, autoSend: true, hasApiKey: false, batchWindowMs: 2000, migrationNotice: 'scope_confirmation_required' }),
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendManual: vi.fn()
    } } })
    const normal = render(<Surfaces standalone={false} hasSession={true} />)
    expect(screen.getAllByRole('textbox', { name: omniMindZhCN.composer.label })).toHaveLength(1)
    expect(getOmniMindChatMountPolicy(false, true).queue).toBe(false)
    expect(screen.queryByRole('complementary', { name: omniMindZhCN.title })).toBeNull()
    normal.unmount()
    render(<Surfaces standalone={true} hasSession={true} />)
    expect(screen.queryByRole('textbox', { name: omniMindZhCN.composer.label })).toBeNull()
    expect(screen.queryByRole('complementary', { name: omniMindZhCN.title })).toBeNull()
  })

  it('mounts composer only for direct chats and group chats, not for official or system accounts', () => {
    expect(getOmniMindChatMountPolicy(false, true, 'wxid_abcdef123456').composer).toBe(true)
    expect(getOmniMindChatMountPolicy(false, true, '1234567890@chatroom').composer).toBe(true)
    expect(getOmniMindChatMountPolicy(false, true, 'gh_official_service').composer).toBe(false)
    expect(getOmniMindChatMountPolicy(false, true, 'fmessage').composer).toBe(false)
    expect(getOmniMindChatMountPolicy(false, true, 'weixin').composer).toBe(false)
    expect(getOmniMindChatMountPolicy(false, true, 'placeholder_foldgroup').composer).toBe(false)
  })
})
