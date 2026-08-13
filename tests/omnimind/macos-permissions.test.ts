import { describe, expect, it, vi } from 'vitest'
import { MacOsPermissionService, SYSTEM_EVENTS_PERMISSION_PROBE_SCRIPT } from '../../electron/omnimind/macos-permission-service'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/weflow-permissions-test' },
  clipboard: { readText: () => '', writeText: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
  shell: { openExternal: vi.fn() },
  systemPreferences: { isTrustedAccessibilityClient: () => false }
}))

vi.mock('../../electron/services/config', () => ({ ConfigService: { getInstance: () => ({ get: () => undefined, getAccountBundle: () => ({ myWxid: '', dbPath: '', decryptKey: '', imageXorKey: 0, imageAesKey: '', cachePath: '', lastOpenedDb: '' }), setAccountBundle: vi.fn() }) } }))
vi.mock('../../electron/services/chatService', () => ({ chatService: { getMessages: vi.fn(), getSessions: vi.fn() } }))
vi.mock('../../electron/services/messagePushService', () => ({ messagePushService: { handleOmniMindSubscriberChanged: vi.fn(), handleConfigCleared: vi.fn(), rebaselineForAccountChange: vi.fn() } }))

const makeService = (overrides: Partial<ConstructorParameters<typeof MacOsPermissionService>[0]> = {}) => {
  const dependencies = {
    platform: 'darwin' as NodeJS.Platform,
    isTrustedAccessibilityClient: vi.fn(() => false),
    probeSystemEvents: vi.fn(async () => 'System Events'),
    openExternal: vi.fn(async () => undefined),
    ...overrides
  }
  return { service: new MacOsPermissionService(dependencies), dependencies }
}

describe('macOS OmniMind permission authority', () => {
  it('defines a target-specific read-only probe with no WeChat or input automation commands', () => {
    expect(SYSTEM_EVENTS_PERMISSION_PROBE_SCRIPT).toBe('tell application "System Events" to get name')
    expect(SYSTEM_EVENTS_PERMISSION_PROBE_SCRIPT).not.toMatch(/WeChat|微信|click|keystroke|key code|clipboard|activate/i)
  })

  it('checks Accessibility passively without prompting and never probes Automation', async () => {
    const { service, dependencies } = makeService()

    await expect(service.refreshPassive()).resolves.toEqual({
      accessibility: 'denied',
      automation: 'not_requested'
    })
    expect(dependencies.isTrustedAccessibilityClient).toHaveBeenCalledWith(false)
    expect(dependencies.probeSystemEvents).not.toHaveBeenCalled()
  })

  it('allows only an explicit Accessibility request to ask macOS to prompt', async () => {
    const { service, dependencies } = makeService({ isTrustedAccessibilityClient: vi.fn(() => true) })

    await expect(service.request('accessibility')).resolves.toEqual({
      accessibility: 'granted',
      automation: 'not_requested'
    })
    expect(dependencies.isTrustedAccessibilityClient).toHaveBeenCalledTimes(1)
    expect(dependencies.isTrustedAccessibilityClient).toHaveBeenCalledWith(true)
  })

  it('runs only the injected harmless System Events probe on an explicit Automation request', async () => {
    const { service, dependencies } = makeService()

    await expect(service.request('automation')).resolves.toEqual({
      accessibility: 'denied',
      automation: 'granted'
    })
    expect(dependencies.probeSystemEvents).toHaveBeenCalledTimes(1)
    expect(dependencies.openExternal).not.toHaveBeenCalled()
  })

  it('maps canonical Automation denial and unknown probe errors conservatively', async () => {
    const denied = makeService({ probeSystemEvents: vi.fn(async () => { throw Object.assign(new Error('Not authorized to send Apple events'), { code: -1743 }) }) })
    await expect(denied.service.request('automation')).resolves.toMatchObject({ automation: 'denied' })

    const unknown = makeService({ probeSystemEvents: vi.fn(async () => { throw new Error('opaque native failure') }) })
    await expect(unknown.service.request('automation')).resolves.toMatchObject({ automation: 'unknown' })
  })

  it('revalidates Automation for every authorized action and detects revocation after a prior grant', async () => {
    const probeSystemEvents = vi.fn()
      .mockResolvedValueOnce('System Events')
      .mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: -1743 }))
    const { service } = makeService({ isTrustedAccessibilityClient: vi.fn(() => true), probeSystemEvents })
    await service.request('automation')

    await expect(service.authorizeAction()).resolves.toEqual({ success: false, error: 'automation_permission_denied' })
    expect(probeSystemEvents).toHaveBeenCalledTimes(2)
    expect(service.getCached().automation).toBe('denied')
  })

  it('rechecks Accessibility without an Automation probe and rechecks Automation with one probe', async () => {
    const { service, dependencies } = makeService({ isTrustedAccessibilityClient: vi.fn(() => true) })

    await expect(service.recheck('accessibility')).resolves.toMatchObject({ accessibility: 'granted', automation: 'not_requested' })
    expect(dependencies.isTrustedAccessibilityClient).toHaveBeenCalledWith(false)
    expect(dependencies.probeSystemEvents).not.toHaveBeenCalled()

    await expect(service.recheck('automation')).resolves.toMatchObject({ automation: 'granted' })
    expect(dependencies.probeSystemEvents).toHaveBeenCalledTimes(1)
  })

  it('emits one kind-specific return event even when the permission snapshot is unchanged', async () => {
    const { service, dependencies } = makeService({ isTrustedAccessibilityClient: vi.fn(() => true) })
    const returned = vi.fn()
    service.onReturned(returned)
    await service.refreshPassive()
    await service.openSettings('accessibility')
    await service.handleNativeReturn()
    await service.handleNativeReturn()

    expect(returned).toHaveBeenCalledOnce()
    expect(returned).toHaveBeenCalledWith({ kind: 'accessibility', snapshot: { accessibility: 'granted', automation: 'not_requested' } })
    expect(dependencies.probeSystemEvents).not.toHaveBeenCalled()
  })

  it('does not emit a return event without an active Settings handoff', async () => {
    const { service } = makeService({ isTrustedAccessibilityClient: vi.fn(() => true) })
    const returned = vi.fn()
    service.onReturned(returned)
    await service.handleNativeReturn()
    expect(returned).not.toHaveBeenCalled()
  })

  it('fails closed on unsupported platforms without touching native ports', async () => {
    const { service, dependencies } = makeService({ platform: 'win32' })

    await expect(service.refreshPassive()).resolves.toEqual({ accessibility: 'unsupported', automation: 'unsupported' })
    await expect(service.request('automation')).resolves.toEqual({ accessibility: 'unsupported', automation: 'unsupported' })
    expect(service.isReady()).toBe(false)
    expect(dependencies.isTrustedAccessibilityClient).not.toHaveBeenCalled()
    expect(dependencies.probeSystemEvents).not.toHaveBeenCalled()
  })

  it('opens only fixed Settings targets selected by enum', async () => {
    const { service, dependencies } = makeService()

    await service.openSettings('accessibility')
    await service.openSettings('automation')
    expect(dependencies.openExternal).toHaveBeenNthCalledWith(1, 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    expect(dependencies.openExternal).toHaveBeenNthCalledWith(2, 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation')
  })

  it('deduplicates passive change events and keeps Automation cached during native return refresh', async () => {
    const trusted = vi.fn(() => false)
    const { service, dependencies } = makeService({ isTrustedAccessibilityClient: trusted })
    const listener = vi.fn()
    service.onChanged(listener)
    await service.refreshPassive()
    await service.refreshPassive()
    trusted.mockReturnValue(true)
    await service.refreshPassive()

    expect(listener).toHaveBeenCalledTimes(2)
    expect(dependencies.probeSystemEvents).not.toHaveBeenCalled()
    expect(service.getCached()).toEqual({ accessibility: 'granted', automation: 'not_requested' })
  })

  it('fails a manual service send before session lookup, baseline, clipboard, or adapter when permission is denied', async () => {
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const denied = makeService({ isTrustedAccessibilityClient: vi.fn(() => false) }).service
    const service = new OmniMindService(denied)
    const internals = service as unknown as {
      sender: { sendManual: ReturnType<typeof vi.fn> }
    }
    internals.sender.sendManual = vi.fn()

    await expect(service.sendManual({ sessionId: 'private-session', text: 'private reply' })).resolves.toEqual({
      success: false,
      error: 'accessibility_permission_denied'
    })
    expect(internals.sender.sendManual).not.toHaveBeenCalled()
  })

  it('does not suppress an active Settings return event behind the passive refresh debounce', async () => {
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const authority = makeService({ isTrustedAccessibilityClient: vi.fn(() => true) }).service
    const service = new OmniMindService(authority)
    const returned = vi.fn()
    service.setPermissionBroadcaster(returned)
    await service.refreshPermissionsAfterNativeReturn()
    await service.openPermissionSettings('accessibility')

    await service.refreshPermissionsAfterNativeReturn()
    expect(returned).toHaveBeenCalledOnce()
    expect(returned).toHaveBeenCalledWith({ kind: 'accessibility', snapshot: { accessibility: 'granted', automation: 'not_requested' } })
  })

  it('blocks enable and manual service actions after Automation revocation with no runtime or sender ingress', async () => {
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    const { chatService } = await import('../../electron/services/chatService')
    const { messagePushService } = await import('../../electron/services/messagePushService')
    const probeSystemEvents = vi.fn()
      .mockResolvedValueOnce('System Events')
      .mockRejectedValue(Object.assign(new Error('private native detail'), { code: -1743 }))
    const authority = makeService({ isTrustedAccessibilityClient: vi.fn(() => true), probeSystemEvents }).service
    await authority.request('automation')
    const service = new OmniMindService(authority)
    const internals = service as unknown as { sender: { sendManual: ReturnType<typeof vi.fn> } }
    internals.sender.sendManual = vi.fn()

    await expect(service.sendManual({ sessionId: 'private-session', text: 'private reply' })).resolves.toEqual({ success: false, error: 'automation_permission_denied' })
    expect(chatService.getSessions).not.toHaveBeenCalled()
    expect(internals.sender.sendManual).not.toHaveBeenCalled()

    const snapshot = await service.enable()
    expect(snapshot).toMatchObject({ runtimeState: 'failed', error: 'automation_permission_denied' })
    expect(messagePushService.handleOmniMindSubscriberChanged).not.toHaveBeenCalled()
  })
})
