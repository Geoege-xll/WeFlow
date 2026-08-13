// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendOmniMindSnapshotToMainWindow } from '../../electron/omnimind/snapshot-target'
import { getOmniMindChatMountPolicy } from '../../src/features/omnimind/chatMountPolicy'
import { OmniMindManualMessageComposer } from '../../src/features/omnimind/OmniMindManualMessageComposer'
import { OmniMindQueuePanel } from '../../src/features/omnimind/OmniMindQueuePanel'
import { omniMindZhCN } from '../../src/features/omnimind/locale'

const Surfaces = ({ standalone, hasSession }: { standalone: boolean; hasSession: boolean }) => {
  const policy = getOmniMindChatMountPolicy(standalone, hasSession)
  return <>{policy.composer && <OmniMindManualMessageComposer sessionId="session-a" />}{policy.queue && <OmniMindQueuePanel />}</>
}

afterEach(cleanup)

describe('public window and Chat mount policy', () => {
  it('broadcasts only to the authoritative main window', () => {
    const send = vi.fn()
    expect(sendOmniMindSnapshotToMainWindow({ isDestroyed: () => false, webContents: { send } }, { runtimeState: 'stopped' })).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(sendOmniMindSnapshotToMainWindow(null, {})).toBe(false)
  })

  it('mounts one real OmniMind composer and queue for normal Chat and excludes standalone', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind: {
      getSnapshot: async () => ({ runtimeState: 'stopped', waiting: [], recent: [] }),
      getSettings: async () => ({ pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', scope: [], hasApiKey: false, officialAccountPolicy: 'ignore', batchWindowMs: 2000, requestTimeoutMs: 15000 }),
      onSnapshotChanged: () => () => undefined,
      enable: vi.fn(), disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(), sendManual: vi.fn()
    } } })
    const normal = render(<Surfaces standalone={false} hasSession={true} />)
    expect(screen.getAllByRole('textbox', { name: omniMindZhCN.composer.label })).toHaveLength(1)
    expect(await screen.findAllByRole('complementary', { name: omniMindZhCN.title })).toHaveLength(1)
    normal.unmount()
    render(<Surfaces standalone={true} hasSession={true} />)
    expect(screen.queryByRole('textbox', { name: omniMindZhCN.composer.label })).toBeNull()
    expect(screen.queryByRole('complementary', { name: omniMindZhCN.title })).toBeNull()
  })
})
