// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindPermissionReturnEvent, OmniMindPermissionSnapshot } from '../../shared/omnimind/contracts'
import { OmniMindQueuePanel } from '../../src/features/omnimind/OmniMindQueuePanel'
const omniMindStyles = readFileSync('src/features/omnimind/omnimind.scss', 'utf8')

const settings = {
  schemaVersion: 2 as const,
  pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open',
  managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 's', displayName: 'S' }] },
  autoSend: true,
  ignoreOfficial: true,
  hasApiKey: true,
  batchWindowMs: 2000,
  requestTimeoutMs: 15000
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
  it('keeps the first takeover attempt fail-closed behind one Continue action', async () => {
    const { omniMind } = installBridge({ accessibility: 'not_requested', automation: 'not_requested' }, {
      requestPermission: vi.fn().mockResolvedValue({ accessibility: 'denied', automation: 'not_requested' })
    })
    render(<OmniMindQueuePanel />)
    const takeover = await screen.findByRole('switch', { name: '自动托管' })
    await waitFor(() => expect(omniMind.getPermissions).toHaveBeenCalledOnce())
    expect((takeover as HTMLButtonElement).disabled).toBe(false)
    expect(takeover.getAttribute('aria-disabled')).toBe('false')
    expect(takeover.getAttribute('aria-describedby')).toBe('omnimind-takeover-permission-description')
    expect(takeover.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(takeover)

    const explanation = await screen.findByRole('region', { name: '开启自动托管前' })
    expect(explanation.querySelectorAll('button')).toHaveLength(1)
    expect(takeover.getAttribute('aria-expanded')).toBe('true')
    expect(takeover.getAttribute('aria-controls')).toBe('omnimind-permission-jit')
    expect(explanation.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy()
    const continueButton = screen.getByRole('button', { name: '继续' })
    await waitFor(() => expect(document.activeElement).toBe(continueButton))
    expect(omniMind.enable).not.toHaveBeenCalled()
    expect(omniMind.sendGeneratedReply).not.toHaveBeenCalled()
    expect(omniMind.retryTask).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await waitFor(() => expect(omniMind.requestPermission).toHaveBeenCalledWith('accessibility'))
    expect(omniMind.enable).not.toHaveBeenCalled()
  })

  it('shows independent permission states and routes exact recovery commands', async () => {
    const { omniMind } = installBridge({ accessibility: 'granted', automation: 'denied' })
    render(<OmniMindQueuePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '自动托管设置' }))
    fireEvent.click(await screen.findByRole('tab', { name: '权限中心' }))

    const accessibility = screen.getByRole('region', { name: '辅助功能' })
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

  it('treats permission-change events as passive return evidence and focuses Recheck', async () => {
    const bridge = installBridge({ accessibility: 'denied', automation: 'not_requested' })
    render(<OmniMindQueuePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '自动托管设置' }))
    fireEvent.click(await screen.findByRole('tab', { name: '权限中心' }))
    const accessibility = screen.getByRole('region', { name: '辅助功能' })
    fireEvent.click(accessibility.querySelector('button[data-permission-action="settings"]') as HTMLButtonElement)

    bridge.emitPermissionReturn({ kind: 'accessibility', snapshot: { accessibility: 'denied', automation: 'not_requested' } })
    const recheck = accessibility.querySelector('button[data-permission-action="recheck"]') as HTMLButtonElement
    await waitFor(() => expect(document.activeElement).toBe(recheck))
    expect(screen.getByRole('status').textContent).toContain('已返回 WeFlow')
    expect(bridge.omniMind.recheckPermission).not.toHaveBeenCalled()
    expect(bridge.omniMind.enable).not.toHaveBeenCalled()
  })

  it('consumes the event kind exactly, ignores returns without an active matching handoff, and unsubscribes once', async () => {
    const bridge = installBridge({ accessibility: 'denied', automation: 'denied' })
    const view = render(<OmniMindQueuePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '自动托管设置' }))
    fireEvent.click(await screen.findByRole('tab', { name: '权限中心' }))
    const accessibility = screen.getByRole('region', { name: '辅助功能' })
    const automation = screen.getByRole('region', { name: '自动化（Apple Events）' })

    bridge.emitPermissionReturn({ kind: 'automation', snapshot: { accessibility: 'denied', automation: 'denied' } })
    await Promise.resolve()
    expect(document.activeElement).not.toBe(automation.querySelector('[data-permission-action="recheck"]'))

    fireEvent.click(accessibility.querySelector('[data-permission-action="settings"]') as HTMLButtonElement)
    bridge.emitPermissionReturn({ kind: 'automation', snapshot: { accessibility: 'denied', automation: 'denied' } })
    await Promise.resolve()
    expect(document.activeElement).not.toBe(automation.querySelector('[data-permission-action="recheck"]'))

    bridge.emitPermissionReturn({ kind: 'accessibility', snapshot: { accessibility: 'denied', automation: 'denied' } })
    await waitFor(() => expect(document.activeElement).toBe(accessibility.querySelector('[data-permission-action="recheck"]')))
    expect(screen.getByRole('status').textContent).toContain('已返回 WeFlow')
    expect(bridge.omniMind.recheckPermission).not.toHaveBeenCalled()

    view.unmount()
    expect(bridge.unsubscribePermissions).toHaveBeenCalledOnce()
  })

  it('uses the actual switch and settings buttons as 44px click targets with visible focus styling', async () => {
    const stylesheet = document.createElement('style')
    stylesheet.textContent = omniMindStyles
    document.head.append(stylesheet)
    installBridge({ accessibility: 'not_requested', automation: 'not_requested' })
    render(<OmniMindQueuePanel />)
    const takeover = await screen.findByRole('switch', { name: '自动托管' })
    const settingsButton = screen.getByRole('button', { name: '自动托管设置' })
    expect(getComputedStyle(takeover).minWidth).toBe('44px')
    expect(getComputedStyle(takeover).minHeight).toBe('44px')
    expect(getComputedStyle(settingsButton).minWidth).toBe('44px')
    expect(getComputedStyle(settingsButton).minHeight).toBe('44px')
    takeover.focus()
    expect(document.activeElement).toBe(takeover)
    expect(omniMindStyles).toMatch(/\.omnimind-hosting-header \[role='switch'\]:focus-visible[^}]*outline:\s*3px solid/)
    stylesheet.remove()
  })

  it('disables only the material permission action while the exact request is pending', async () => {
    const pending = deferred<OmniMindPermissionSnapshot>()
    const bridge = installBridge({ accessibility: 'not_requested', automation: 'not_requested' }, {
      requestPermission: vi.fn().mockReturnValue(pending.promise)
    })
    render(<OmniMindQueuePanel />)
    const takeover = await screen.findByRole('switch', { name: '自动托管' }) as HTMLButtonElement
    fireEvent.click(takeover)
    const continueButton = await screen.findByRole('button', { name: '继续' }) as HTMLButtonElement
    fireEvent.click(continueButton)
    await waitFor(() => expect(bridge.omniMind.requestPermission).toHaveBeenCalledWith('accessibility'))
    expect(continueButton.disabled).toBe(true)
    expect(continueButton.getAttribute('aria-busy')).toBe('true')
    expect(bridge.omniMind.enable).not.toHaveBeenCalled()
    pending.resolve({ accessibility: 'denied', automation: 'not_requested' })
    await waitFor(() => expect(screen.getByRole('region', { name: '辅助功能' })).toBeTruthy())
  })

  it('requires a distinct later takeover action after both permissions are granted', async () => {
    const bridge = installBridge({ accessibility: 'granted', automation: 'granted' })
    render(<OmniMindQueuePanel />)
    const takeover = await screen.findByRole('switch', { name: '自动托管' })
    await waitFor(() => expect(bridge.omniMind.getPermissions).toHaveBeenCalledOnce())
    expect(bridge.omniMind.enable).not.toHaveBeenCalled()
    fireEvent.click(takeover)
    await waitFor(() => expect(bridge.omniMind.enable).toHaveBeenCalledOnce())
  })

  it('reopens and focuses the exact permission card after an authoritative enable refusal', async () => {
    const bridge = installBridge({ accessibility: 'granted', automation: 'granted' }, {
      enable: vi.fn().mockResolvedValue({ runtimeState: 'failed', error: 'automation_permission_denied', waiting: [], recent: [] })
    })
    render(<OmniMindQueuePanel />)
    const takeover = await screen.findByRole('switch', { name: '自动托管' })
    await waitFor(() => expect(bridge.omniMind.getPermissions).toHaveBeenCalledOnce())
    fireEvent.click(takeover)

    const card = await screen.findByRole('region', { name: '自动化（Apple Events）' })
    await waitFor(() => expect(document.activeElement).toBe(card))
    expect(screen.queryByText('automation_permission_denied')).toBeNull()
    expect(bridge.omniMind.enable).toHaveBeenCalledOnce()
  })
})
