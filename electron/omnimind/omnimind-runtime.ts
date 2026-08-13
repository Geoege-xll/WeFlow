import type { OmniMindRuntimeState, OmniMindSettingsInput } from '../../shared/omnimind/contracts'

interface RuntimeDependencies {
  validateStart: () => Promise<{ success: boolean; accountId?: string; error?: string }>
  cancelAllCancellable: (reason: string) => void
  waitForSending: () => Promise<void>
  saveSettings: (settings: OmniMindSettingsInput) => Promise<void>
  onStateChanged: (state: OmniMindRuntimeState, error?: string) => void
}

export class OmniMindRuntime {
  private state: OmniMindRuntimeState = 'stopped'
  private accountId?: string
  private error?: string

  constructor(private readonly dependencies: RuntimeDependencies) {}
  getState(): OmniMindRuntimeState { return this.state }
  getAccountId(): string | undefined { return this.accountId }
  getError(): string | undefined { return this.error }

  async enable(): Promise<void> {
    if (this.state !== 'stopped' && this.state !== 'failed') return
    this.setState('validating')
    let validation: Awaited<ReturnType<RuntimeDependencies['validateStart']>>
    try { validation = await this.dependencies.validateStart() } catch { this.setState('failed', 'validation_failed'); return }
    if (!validation.success || !validation.accountId) { this.setState('failed', validation.error || 'validation_failed'); return }
    this.accountId = validation.accountId
    this.setState('starting')
    this.setState('running')
  }

  fail(reason: string): void { this.setState('failed', reason) }

  async disable(reason = 'hosting_disabled'): Promise<void> {
    if (this.state === 'stopped') return
    this.setState('stopping')
    this.dependencies.cancelAllCancellable(reason)
    await this.dependencies.waitForSending()
    this.setState('stopped')
  }

  async saveSettings(settings: OmniMindSettingsInput, criticalChanged: boolean): Promise<void> {
    if (criticalChanged && this.state === 'running') await this.disable('critical_settings_changed')
    await this.dependencies.saveSettings(settings)
  }

  async handleAccountIdentity(accountId: string): Promise<void> {
    if (this.accountId && accountId !== this.accountId) await this.disable('account_changed')
    this.accountId = accountId
  }

  private setState(state: OmniMindRuntimeState, error?: string): void { this.state = state; this.error = error; this.dependencies.onStateChanged(state, error) }
}
