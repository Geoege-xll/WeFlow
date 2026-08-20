// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindPermissionKind, OmniMindPermissionReturnEvent, OmniMindPermissionSnapshot } from '../../shared/omnimind/contracts'
import { OmniMindQueuePanel } from '../../src/features/omnimind/OmniMindQueuePanel'
import { OmniMindPermissionCenter } from '../../src/features/omnimind/OmniMindPermissionCenter'
import { useOmniMindPermissions } from '../../src/features/omnimind/useOmniMindPermissions'
const omniMindStyles = readFileSync('src/features/omnimind/omnimind.scss', 'utf8')

const settings = {
  schemaVersion: 4 as const,
  pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
  managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 's', displayName: 'S' }] },
  autoSend: true,
  hasApiKey: true,
  batchWindowMs: 2000
}

function TestPermissionCenter({ focusKind }: { focusKind?: OmniMindPermissionKind }) {
  const model = useOmniMindPermissions()
  return <OmniMindPermissionCenter model={model} focusKind={focusKind} />
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const installBridge = (permissions: OmniMindPermissionSnapshot, overrides: Record<string, unknown> = {}) => {
  let permissionListener: ((event: OmniMindPermissionReturnEvent) => void) | undefined
  const unsubscribePermissions = vi.fn(() => { permissionListener = undefined })
  const omniMind = {
    getSnapshot: vi.fn().mockResolvedValue({ runtimeState: 'stopped', waiting: [], recent: [] }),
    getSettings: vi.fn().mockResolvedValue(settings),
    onSnapshotChanged: vi.fn(() => () => undefined),
    enable: vi.fn().mockResolvedValue({ runtimeState: 'running', waiting: [], recent: [] }),
    disable: vi.fn(), saveSettings: vi.fn(), cancelTask: vi.fn(), retryTask: vi.fn(),
    sendGeneratedReply: vi.fn(), abandonGeneratedReply: vi.fn(),
    getPermissions: vi.fn().mockResolvedValue(permissions),
    requestPermission: vi.fn().mockResolvedValue(permissions),
    recheckPermission: vi.fn().mockResolvedValue(permissions),
    openPermissionSettings: vi.fn().mockResolvedValue(undefined),
    onPermissionsChanged: vi.fn((listener: (event: OmniMindPermissionReturnEvent) => void) => {
      permissionListener = listener
      return unsubscribePermissions
    }),
    ...overrides
  }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { omniMind } })
  return { omniMind, unsubscribePermissions, emitPermissionReturn: (event: OmniMindPermissionReturnEvent) => permissionListener?.(event) }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OmniMind permission center', () => {
  it('shows the complete permission center immediately without the removed preflight card', async () => {
    const { omniMind } = installBridge({ accessibility: 'not_requested', automation: 'not_requested' }, {
      requestPermission: vi.fn().mockResolvedValue({ accessibility: 'denied', automation: 'not_requested' })
    })
    render(<TestPermissionCenter focusKind="accessibility" />)
    await waitFor(() => expect(omniMind.getPermissions).toHaveBeenCalledOnce())

    const accessibility = await screen.findByRole('region', { name: '辅助功能' })
    expect(screen.getByRole('region', { name: '自动化（Apple Events）' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '开启自动托管前' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(accessibility))
    expect(omniMind.enable).not.toHaveBeenCalled()
    expect(omniMind.sendGeneratedReply).not.toHaveBeenCalled()
    expect(omniMind.retryTask).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: '请求授权' })[0])
    await waitFor(() => expect(omniMind.requestPermission).toHaveBeenCalledWith('accessibility'))
    expect(omniMind.enable).not.toHaveBeenCalled()
  })

  it('shows independent permission states and routes exact recovery commands', async () => {
    const { omniMind } = installBridge({ accessibility: 'granted', automation: 'denied' })
    render(<TestPermissionCenter />)

    const accessibility = await screen.findByRole('region', { name: '辅助功能' })
    const automation = screen.getByRole('region', { name: '自动化（Apple Events）' })
    expect(accessibility.textContent).toContain('已允许')
    expect(automation.textContent).toContain('未允许')
    expect(automation.textContent).toContain('此权限独立于辅助功能')

    fireEvent.click(automation.querySelector('button[data-permission-action="settings"]') as HTMLButtonElement)
    expect(omniMind.openPermissionSettings).toHaveBeenCalledWith('automation')
    expect(omniMind.enable).not.toHaveBeenCalled()
    fireEvent.click(accessibility.querySelector('button[data-permission-action="recheck"]') as HTMLButtonElement)
    await waitFor(() => expect(omniMind.recheckPermission).toHaveBeenCalledWith('accessibility'))
    expect(omniMind.recheckPermission).not.toHaveBeenCalledWith('automation')
    fireEvent.click(automation.querySelector('button[data-permission-action="recheck"]') as HTMLButtonElement)
    await waitFor(() => expect(omniMind.recheckPermission).toHaveBeenCalledWith('automation'))
    expect(omniMind.enable).not.toHaveBeenCalled()
  })

  it('renders only the two IPC-backed permissions without local fake grants or pseudo-JIT controls', async () => {
    installBridge({ accessibility: 'denied', automation: 'granted' })
    render(<TestPermissionCenter />)

    await screen.findByRole('region', { name: '辅助功能' })
    expect(screen.getAllByRole('region').filter((region) => region.classList.contains('omnimind-permission-card'))).toHaveLength(2)
    expect(screen.queryByText(/屏幕录制|系统通知/)).toBeNull()
    expect(screen.queryByRole('button', { name: /调起.*JIT 授权/ })).toBeNull()
    // 所有可见状态均来自真实 permission snapshot，不能默认显示额外“已授权”卡片。
    expect(screen.getAllByText('已授权 ✓')).toHaveLength(1)
  })

  it('treats permission-change events as passive return evidence and focuses Recheck', async () => {
    const bridge = installBridge({ accessibility: 'denied', automation: 'not_requested' })
    render(<TestPermissionCenter />)
    const accessibility = await screen.findByRole('region', { name: '辅助功能' })
    await waitFor(() => expect(bridge.omniMind.getPermissions).toHaveBeenCalledOnce())
    fireEvent.click(accessibility.querySelector('button[data-permission-action="settings"]') as HTMLButtonElement)
    await waitFor(() => expect(bridge.omniMind.openPermissionSettings).toHaveBeenCalledWith('accessibility'))

    bridge.emitPermissionReturn({ kind: 'accessibility', snapshot: { accessibility: 'denied', automation: 'not_requested' } })
    const recheck = accessibility.querySelector('button[data-permission-action="recheck"]') as HTMLButtonElement
    await waitFor(() => expect(document.activeElement).toBe(recheck))
    expect(screen.getByRole('status').textContent).toContain('已返回 OmniMindWeChat')
    expect(bridge.omniMind.recheckPermission).not.toHaveBeenCalled()
    expect(bridge.omniMind.enable).not.toHaveBeenCalled()
  })

  it('consumes the event kind exactly, ignores returns without an active matching handoff, and unsubscribes once', async () => {
    const bridge = installBridge({ accessibility: 'denied', automation: 'denied' })
    const view = render(<TestPermissionCenter />)
    const accessibility = await screen.findByRole('region', { name: '辅助功能' })
    const automation = screen.getByRole('region', { name: '自动化（Apple Events）' })
    await waitFor(() => expect(bridge.omniMind.getPermissions).toHaveBeenCalledOnce())

    bridge.emitPermissionReturn({ kind: 'automation', snapshot: { accessibility: 'denied', automation: 'denied' } })
    await Promise.resolve()
    expect(document.activeElement).not.toBe(automation.querySelector('[data-permission-action="recheck"]'))

    fireEvent.click(accessibility.querySelector('[data-permission-action="settings"]') as HTMLButtonElement)
    await waitFor(() => expect(bridge.omniMind.openPermissionSettings).toHaveBeenCalledWith('accessibility'))
    bridge.emitPermissionReturn({ kind: 'automation', snapshot: { accessibility: 'denied', automation: 'denied' } })
    await Promise.resolve()
    expect(document.activeElement).not.toBe(automation.querySelector('[data-permission-action="recheck"]'))

    bridge.emitPermissionReturn({ kind: 'accessibility', snapshot: { accessibility: 'denied', automation: 'denied' } })
    await waitFor(() => expect(document.activeElement).toBe(accessibility.querySelector('[data-permission-action="recheck"]')))
    expect(screen.getByRole('status').textContent).toContain('已返回 OmniMindWeChat')
    expect(bridge.omniMind.recheckPermission).not.toHaveBeenCalled()

    view.unmount()
    expect(bridge.unsubscribePermissions).toHaveBeenCalledOnce()
  })

  it('uses permission cards and actions as 44px click targets with visible focus styling', async () => {
    const stylesheet = document.createElement('style')
    stylesheet.textContent = omniMindStyles
    document.head.append(stylesheet)
    installBridge({ accessibility: 'not_requested', automation: 'not_requested' })
    render(<TestPermissionCenter />)
    const card = await screen.findByRole('region', { name: '辅助功能' })
    const actionButton = card.querySelector('button') as HTMLButtonElement
    expect(getComputedStyle(actionButton).minHeight).toBe('44px')
    expect(omniMindStyles).toMatch(/\.omnimind-permission-actions button\s*\{[^}]*min-height:\s*44px/)
    stylesheet.remove()
  })

  it('disables only the material permission card action while the exact request is pending', async () => {
    const pending = deferred<OmniMindPermissionSnapshot>()
    const bridge = installBridge({ accessibility: 'not_requested', automation: 'not_requested' }, {
      requestPermission: vi.fn().mockReturnValue(pending.promise)
    })
    render(<TestPermissionCenter focusKind="accessibility" />)
    await waitFor(() => expect(bridge.omniMind.getPermissions).toHaveBeenCalledOnce())
    const requestButton = (await screen.findAllByRole('button', { name: '请求授权' }))[0] as HTMLButtonElement
    fireEvent.click(requestButton)
    await waitFor(() => expect(bridge.omniMind.requestPermission).toHaveBeenCalledWith('accessibility'))
    expect(requestButton.disabled).toBe(true)
    expect(bridge.omniMind.enable).not.toHaveBeenCalled()
    pending.resolve({ accessibility: 'denied', automation: 'not_requested' })
    await waitFor(() => expect(screen.getByRole('region', { name: '辅助功能' })).toBeTruthy())
  })

  it('requires a distinct later takeover action after both permissions are granted', async () => {
    const bridge = installBridge({ accessibility: 'granted', automation: 'granted' })
    render(<TestPermissionCenter />)
    await waitFor(() => expect(bridge.omniMind.getPermissions).toHaveBeenCalledOnce())
    expect(bridge.omniMind.enable).not.toHaveBeenCalled()
  })

  it('reopens and focuses the exact permission card after an authoritative enable refusal', async () => {
    const bridge = installBridge({ accessibility: 'granted', automation: 'granted' }, {
      getSnapshot: vi.fn().mockResolvedValue({ runtimeState: 'failed', error: 'automation_permission_denied', waiting: [], recent: [] })
    })
    render(<OmniMindQueuePanel />)

    const card = await screen.findByRole('region', { name: '自动化（Apple Events）' })
    await waitFor(() => expect(document.activeElement).toBe(card))
    expect(screen.queryByText('automation_permission_denied')).toBeNull()
  })
})
