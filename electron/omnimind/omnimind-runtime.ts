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
  private validationEpoch = 0
  private disablePromise?: Promise<void>

  constructor(private readonly dependencies: RuntimeDependencies) {}
  getState(): OmniMindRuntimeState { return this.state }
  getAccountId(): string | undefined { return this.accountId }
  getError(): string | undefined { return this.error }

  async enable(): Promise<void> {
    if (!await this.prepareEnable()) return
    this.completeStart()
  }

  /**
   * 首次启动的“准备阶段”只负责真实预检并停在 starting，绝不提前宣称 running。
   * 生产 Service 必须等 controller 与消息 subscriber 全部 bootstrap 成功后，再调用
   * completeStart；保留 enable() 自动提交仅供 Runtime 自身的无 ingress 单元语义使用。
   */
  prepareEnable(): Promise<boolean> {
    if (this.state !== 'stopped' && this.state !== 'failed') return Promise.resolve(false)
    return this.validateAndPrepareStart()
  }

  /**
   * 暂停只改变主进程权威状态，不触发停止路径中的队列取消或发送等待。
   * ingress 的先停后切态顺序由 OmniMindService 负责；Runtime 只接受 running，
   * 明确拒绝 degraded 等不具备安全恢复前提的状态，并让重复 pause 保持幂等。
   */
  pause(): void {
    if (this.state !== 'running') return
    this.setState('paused')
  }

  /**
   * 继续托管必须复用与首次 enable 完全相同的真实预检。验证期间先进入 validating，
   * 验证失败则进入 failed；已有任务由队列层持有，本方法不会执行任何取消动作。
   */
  async resume(): Promise<void> {
    if (!await this.prepareResume()) return
    this.completeStart()
  }

  /** paused 的恢复准备与首次启动严格复用同一条预检路径，并同样停在 starting。 */
  prepareResume(): Promise<boolean> {
    if (this.state !== 'paused') return Promise.resolve(false)
    return this.validateAndPrepareStart()
  }

  /**
   * 只有完成预检、处于 starting 的一次启动事务才能提交为 running。
   * Service 无法任意写 Runtime 状态；若异步 bootstrap 期间已被 fail/disable，旧提交会被拒绝。
   */
  completeStart(): boolean {
    if (this.state !== 'starting') return false
    this.setState('running')
    return true
  }

  private async validateAndPrepareStart(): Promise<boolean> {
    const epoch = ++this.validationEpoch
    this.setState('validating')
    let validation: Awaited<ReturnType<RuntimeDependencies['validateStart']>>
    try { validation = await this.dependencies.validateStart() } catch {
      if (epoch === this.validationEpoch) this.setState('failed', 'validation_failed')
      return false
    }
    // disable/account/settings 可能在异步预检完成前令本次启动失效；旧结果不得重新拉起 ingress。
    if (epoch !== this.validationEpoch) return false
    if (!validation.success || !validation.accountId) { this.setState('failed', validation.error || 'validation_failed'); return false }
    this.accountId = validation.accountId
    this.setState('starting')
    return true
  }

  fail(reason: string): void {
    this.validationEpoch += 1
    this.setState('failed', reason)
  }

  /**
   * 将已经运行中的托管实例标记为“降级”。
   *
   * 权限在运行期间可能被用户从 macOS 设置中撤销。此时不能调用 disable：
   * disable 会清理队列中的可取消任务，而 degraded 合同要求保留队列和待确认回复，
   * 只暂停后续自动接入。只有 running 才能进入 degraded，避免启动校验失败被错误地
   * 伪装成运行时降级；重复收到同一权限失败也保持幂等，不覆盖第一次的诊断原因。
   */
  degrade(reason: string): void {
    if (this.state !== 'running') return
    this.setState('degraded', reason)
  }

  async disable(reason = 'hosting_disabled'): Promise<void> {
    if (this.state === 'stopped') return
    if (this.disablePromise) return this.disablePromise
    this.validationEpoch += 1
    const operation = (async () => {
      this.setState('stopping')
      this.dependencies.cancelAllCancellable(reason)
      await this.dependencies.waitForSending()
      this.setState('stopped')
    })()
    this.disablePromise = operation
    try { await operation } finally {
      if (this.disablePromise === operation) this.disablePromise = undefined
    }
  }

  async saveSettings(settings: OmniMindSettingsInput, criticalChanged: boolean): Promise<void> {
    // paused/degraded 仍持有旧账号与旧配置上下文；关键设置变化必须走正式停止语义，
    // 绝不能保存后直接恢复到 running 并绕过新配置预检。
    if (criticalChanged && ['running', 'paused', 'degraded', 'validating', 'starting'].includes(this.state)) await this.disable('critical_settings_changed')
    await this.dependencies.saveSettings(settings)
  }

  async handleAccountIdentity(accountId: string): Promise<void> {
    if (this.accountId && accountId !== this.accountId) await this.disable('account_changed')
    this.accountId = accountId
  }

  private setState(state: OmniMindRuntimeState, error?: string): void { this.state = state; this.error = error; this.dependencies.onStateChanged(state, error) }
}
