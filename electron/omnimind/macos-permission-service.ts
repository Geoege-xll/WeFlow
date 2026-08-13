import type { OmniMindPermissionKind, OmniMindPermissionReturnEvent, OmniMindPermissionSnapshot } from '../../shared/omnimind/contracts'

export const SYSTEM_EVENTS_PERMISSION_PROBE_SCRIPT = 'tell application "System Events" to get name'

export interface MacOsPermissionDependencies {
  platform: NodeJS.Platform
  isTrustedAccessibilityClient: (prompt: boolean) => boolean
  probeSystemEvents: () => Promise<string>
  openExternal: (target: string) => Promise<unknown>
}

const SETTINGS_TARGETS: Record<OmniMindPermissionKind, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'
}

const snapshotsEqual = (left: OmniMindPermissionSnapshot, right: OmniMindPermissionSnapshot): boolean =>
  left.accessibility === right.accessibility && left.automation === right.automation

export const isAutomationPermissionDeniedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; message?: unknown; stdout?: unknown; stderr?: unknown }
  const evidence = [value.code, value.message, value.stdout, value.stderr]
    .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
    .join('\n')
    .toLocaleLowerCase('en-US')
  return /(?:^|\D)-1743(?:\D|$)/.test(evidence) || /not authori[sz]ed to send apple events/.test(evidence)
}

export class MacOsPermissionService {
  private snapshot: OmniMindPermissionSnapshot
  private readonly listeners = new Set<(snapshot: OmniMindPermissionSnapshot) => void>()
  private readonly returnListeners = new Set<(event: OmniMindPermissionReturnEvent) => void>()
  private activeSettingsHandoff?: OmniMindPermissionKind

  constructor(private readonly dependencies: MacOsPermissionDependencies) {
    const initial = dependencies.platform === 'darwin' ? 'not_requested' : 'unsupported'
    this.snapshot = { accessibility: initial, automation: initial }
  }

  getCached(): OmniMindPermissionSnapshot { return { ...this.snapshot } }
  hasActiveSettingsHandoff(): boolean { return this.activeSettingsHandoff !== undefined }
  isReady(): boolean { return this.snapshot.accessibility === 'granted' && this.snapshot.automation === 'granted' }

  onChanged(listener: (snapshot: OmniMindPermissionSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onReturned(listener: (event: OmniMindPermissionReturnEvent) => void): () => void {
    this.returnListeners.add(listener)
    return () => this.returnListeners.delete(listener)
  }

  async refreshPassive(): Promise<OmniMindPermissionSnapshot> {
    if (this.dependencies.platform !== 'darwin') return this.update({ accessibility: 'unsupported', automation: 'unsupported' })
    let accessibility: OmniMindPermissionSnapshot['accessibility'] = 'unknown'
    try {
      accessibility = this.dependencies.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
    } catch {
      accessibility = 'unknown'
    }
    return this.update({ ...this.snapshot, accessibility })
  }

  async request(permission: OmniMindPermissionKind): Promise<OmniMindPermissionSnapshot> {
    if (this.dependencies.platform !== 'darwin') return this.update({ accessibility: 'unsupported', automation: 'unsupported' })
    if (permission === 'accessibility') {
      let accessibility: OmniMindPermissionSnapshot['accessibility'] = 'unknown'
      try {
        accessibility = this.dependencies.isTrustedAccessibilityClient(true) ? 'granted' : 'denied'
      } catch {
        accessibility = 'unknown'
      }
      return this.update({ ...this.snapshot, accessibility })
    }
    await this.refreshPassive()
    return this.probeAutomation()
  }

  async recheck(permission: OmniMindPermissionKind): Promise<OmniMindPermissionSnapshot> {
    if (permission === 'accessibility') return this.refreshPassive()
    return this.probeAutomation()
  }

  async authorizeAction(): Promise<{ success: false; error: 'accessibility_permission_denied' | 'automation_permission_denied' } | undefined> {
    const passive = await this.refreshPassive()
    if (passive.accessibility !== 'granted') return { success: false, error: 'accessibility_permission_denied' }
    const revalidated = await this.probeAutomation()
    if (revalidated.automation !== 'granted') return { success: false, error: 'automation_permission_denied' }
    return undefined
  }

  async openSettings(permission: OmniMindPermissionKind): Promise<void> {
    if (this.dependencies.platform !== 'darwin') return
    await this.dependencies.openExternal(SETTINGS_TARGETS[permission])
    this.activeSettingsHandoff = permission
  }

  async handleNativeReturn(): Promise<OmniMindPermissionSnapshot> {
    const snapshot = await this.refreshPassive()
    const kind = this.activeSettingsHandoff
    if (!kind) return snapshot
    this.activeSettingsHandoff = undefined
    const event = { kind, snapshot: { ...snapshot } }
    this.returnListeners.forEach((listener) => listener(event))
    return snapshot
  }

  private async probeAutomation(): Promise<OmniMindPermissionSnapshot> {
    if (this.dependencies.platform !== 'darwin') return this.update({ accessibility: 'unsupported', automation: 'unsupported' })
    try {
      const name = await this.dependencies.probeSystemEvents()
      return this.update({ ...this.snapshot, automation: name.trim() === 'System Events' ? 'granted' : 'unknown' })
    } catch (error) {
      return this.update({ ...this.snapshot, automation: isAutomationPermissionDeniedError(error) ? 'denied' : 'unknown' })
    }
  }

  private update(next: OmniMindPermissionSnapshot): OmniMindPermissionSnapshot {
    if (snapshotsEqual(this.snapshot, next)) return this.getCached()
    this.snapshot = { ...next }
    const publicSnapshot = this.getCached()
    this.listeners.forEach((listener) => listener(publicSnapshot))
    return publicSnapshot
  }
}
