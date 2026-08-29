import { app, clipboard, safeStorage, shell, systemPreferences } from 'electron'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { isCriticalSettingsChange, isManagedSession, type ManagedScope, type OmniMindPermissionKind, type OmniMindPermissionReturnEvent, type OmniMindPermissionSnapshot, type OmniMindSendResult, type OmniMindSettingsInput, type OmniMindSnapshot, type OmniMindTask } from '../../shared/omnimind/contracts'
import { ConfigService } from '../services/config'
import { chatService } from '../services/chatService'
import { messagePushService } from '../services/messagePushService'
import { buildOsascriptArguments, MacOsWeChatReadiness, MacOsWeChatTextAdapter, type WeChatReadinessPort, WcdbOutboundVerifier } from './macos-wechat-text-adapter'
import { normalizedMessageEventHub } from './normalized-message-event-hub'
import { OmniMindController } from './omnimind-controller'
import { OmniMindPythonClient } from './omnimind-python-client'
import { OmniMindRuntime } from './omnimind-runtime'
import { OpenChannelDeliveryClient, OpenRecoveryDeliveryLoop } from './open-channel-delivery-client'
import { PersistentDeliveryJournal } from './persistent-delivery-journal'
import { SecureOmniMindSettingsStore } from './secure-settings-store'
import { UnifiedSender } from './unified-sender'
import { AccountSwitchCoordinator } from './account-switch-coordinator'
import { parseAccountConfigBundle, type AccountConfigPatch } from '../../shared/omnimind/account-bundle'
import { createAtomicDiagnosticFile, DeliveryDiagnosticStore } from './delivery-diagnostics'
import { registerClosedStreamDiagnosticSink } from '../safe-console'
import { MacOsPermissionService, SYSTEM_EVENTS_PERMISSION_PROBE_SCRIPT, type MacOsAuthorizationFailure } from './macos-permission-service'
import { UNIFIED_AUTOMATIC_HOSTING_POLICY } from '../../shared/omnimind/automatic-hosting-policy.generated'

const execFileAsync = promisify(execFile)

export class OmniMindService {
  private readonly config = ConfigService.getInstance()
  private readonly python: OmniMindPythonClient
  private readonly store: SecureOmniMindSettingsStore
  private readonly deliveryJournal: PersistentDeliveryJournal
  private readonly deliveryLoop: OpenRecoveryDeliveryLoop
  private readonly sender: UnifiedSender
  private readonly controller: OmniMindController
  private readonly runtime: OmniMindRuntime
  private snapshotBroadcaster?: (snapshot: OmniMindSnapshot) => void
  private permissionBroadcaster?: (event: OmniMindPermissionReturnEvent) => void
  private readonly permissions: MacOsPermissionService
  private readonly wechatReadiness: WeChatReadinessPort
  private managedScope: ManagedScope = { mode: 'selected', conversations: [] }
  // 运行时冷启动也必须读取与 QQ 共用的默认合同；不能只让设置页显示统一值，
  // 否则设置尚未完成加载的短窗口仍会使用另一套自动发送或聚合时序。
  private autoSend = UNIFIED_AUTOMATIC_HOSTING_POLICY.autoSend
  private batchWindowMs = UNIFIED_AUTOMATIC_HOSTING_POLICY.batchWindowMs.default
  private readonly accountSwitcher: AccountSwitchCoordinator
  private nativeReturnRefresh?: Promise<OmniMindPermissionSnapshot>
  private lastNativeReturnRefreshAt = 0
  /**
   * controller 可能因消息推送的其他消费者而继续订阅共享 hub，因此不能把“关闭专属 subscriber”
   * 当作唯一 ingress 闸门。这个主进程布尔值只由串行生命周期命令修改，并在 controller 的
   * authorizeIngress 边界同步检查，确保 pause 的第一步就阻断新任务进入批处理器。
   */
  private ingressEnabled = false
  private subscriberActive = false
  private lifecycleTail: Promise<void> = Promise.resolve()
  /**
   * 设置保存与凭据清除共享同一条主进程 mutation 队列。Renderer 的按钮禁用只是体验保护，
   * 真正的 read-modify-write、fail-closed 生命周期和 Store 写入必须在此按到达顺序串行。
   */
  private settingsMutationTail: Promise<void> = Promise.resolve()
  private startOperation?: Promise<OmniMindSnapshot>
  /** 最近一次完整启动预检实际验证过的 Open API 基址；只在同一次 runtime account 上使用。 */
  private validatedPythonBaseUrl?: string

  constructor(permissionService?: MacOsPermissionService) {
    const settingsDirectory = path.join(app.getPath('userData'), 'omnimind')
    const writePrivateFileAtomic = async (target: string, value: string): Promise<void> => {
      // 目录与临时文件都显式收紧权限；rename 后目标继承临时文件 0600，不依赖用户 umask。
      await fs.mkdir(settingsDirectory, { recursive: true, mode: 0o700 })
      // Windows ACL 不等价于 POSIX chmod；该平台由用户目录 ACL 隔离，避免强行 chmod 触发 EPERM。
      if (process.platform !== 'win32') await fs.chmod(settingsDirectory, 0o700)
      const temporary = path.join(settingsDirectory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
      let renamed = false
      try {
        await fs.writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temporary, target)
        renamed = true
      } finally {
        // rename 成功后临时路径已不存在；失败则尽力清理密文临时文件，原始错误仍向上抛出。
        if (!renamed) {
          try { await fs.unlink(temporary) } catch { /* 写入失败时临时文件可能尚未创建。 */ }
        }
      }
    }
    this.store = new SecureOmniMindSettingsStore({
      safeStorage,
      read: async (key) => {
        try { return await fs.readFile(path.join(settingsDirectory, `${key}.json`), 'utf8') } catch { return undefined }
      },
      writeAtomic: async (key, value) => {
        const target = path.join(settingsDirectory, `${key}.json`)
        await writePrivateFileAtomic(target, value)
      },
      remove: async (key) => {
        try { await fs.unlink(path.join(settingsDirectory, `${key}.json`)) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    })
    const deliveryJournalPath = path.join(settingsDirectory, 'open-recovery-delivery-journal.json')
    this.deliveryJournal = new PersistentDeliveryJournal({
      safeStorage,
      read: async () => {
        try { return await fs.readFile(deliveryJournalPath, 'utf8') } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        }
      },
      writeAtomic: (value) => writePrivateFileAtomic(deliveryJournalPath, value),
      quarantine: async () => {
        // 损坏文件只改名隔离，不读取或记录密文/正文；下一次写入会创建新的完整 journal。
        try {
          await fs.rename(deliveryJournalPath, path.join(settingsDirectory, `open-recovery-delivery-journal.corrupt.${Date.now()}.json`))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    })
    this.python = new OmniMindPythonClient({
      onRouteObserved: ({ sessionReference, accountId, sessionId }) =>
        this.deliveryJournal.recordRoute(sessionReference, accountId, sessionId)
    })
    this.permissions = permissionService ?? new MacOsPermissionService({
      platform: process.platform,
      isTrustedAccessibilityClient: (prompt) => systemPreferences?.isTrustedAccessibilityClient(prompt) ?? false,
      probeSystemEvents: async () => {
        const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', SYSTEM_EVENTS_PERMISSION_PROBE_SCRIPT], { timeout: 5_000 })
        return stdout.trim()
      },
      openExternal: (target) => shell.openExternal(target)
    })
    this.permissions.onReturned((event) => this.permissionBroadcaster?.(event))
    const runAppleScript = async (script: string, args: string[]): Promise<string> => {
      const { stdout } = await execFileAsync('/usr/bin/osascript', buildOsascriptArguments(script, args), { timeout: 15_000 })
      return stdout.trim()
    }
    // 启动 preflight 与每次发送复核共用同一个窗口就绪能力，避免两份 AX 脚本随时间漂移。
    this.wechatReadiness = new MacOsWeChatReadiness({ platform: process.platform, runAppleScript })
    const adapter = new MacOsWeChatTextAdapter({
      platform: process.platform,
      clipboard,
      runAppleScript
    }, this.wechatReadiness)
    const diagnosticPath = path.join(settingsDirectory, 'delivery-diagnostics.json')
    const diagnostics = new DeliveryDiagnosticStore(createAtomicDiagnosticFile(diagnosticPath))
    registerClosedStreamDiagnosticSink((event) => diagnostics.recordRuntimeStreamClosure(event))
    this.sender = new UnifiedSender({
      cancelForManualSend: (accountId, sessionId) => this.controller.cancelForManualSend(accountId, sessionId),
      adapter,
      verifier: new WcdbOutboundVerifier(chatService),
      recordDiagnostic: (entry) => diagnostics.record(entry)
    })
    this.deliveryLoop = new OpenRecoveryDeliveryLoop({
      client: new OpenChannelDeliveryClient(),
      journal: this.deliveryJournal,
      send: async (input, control) => {
        let sessions: Awaited<ReturnType<typeof chatService.getSessions>>
        try { sessions = await chatService.getSessions() } catch {
          return { result: 'not_sent', failureCode: 'conversation_title_unavailable' }
        }
        const title = sessions.success && Array.isArray(sessions.sessions)
          ? String(sessions.sessions.find((candidate) => candidate.username === input.sessionId)?.displayName || '').trim()
          : ''
        if (!title) return { result: 'not_sent', failureCode: 'conversation_title_unavailable' }
        return this.sender.sendRecoveryDelivery({ ...input, conversationTitle: title }, control)
      },
      authorize: (accountId, sessionId) => this.authorizeRecoveryDelivery(accountId, sessionId)
    })
    this.controller = new OmniMindController({
      hub: normalizedMessageEventHub,
      accountId: () => String(this.config.get('myWxid') || '').trim() || undefined,
      managedScope: () => this.managedScope,
      autoSend: () => this.autoSend,
      authorizeIngress: () => this.ingressEnabled && this.permissions.isReady(),
      batchDelayMs: () => this.batchWindowMs,
      generate: async (task) => {
        const settings = await this.store.getRendererSettings()
        const apiKey = await this.store.getApiKey()
        if (!apiKey) return { kind: 'auth' }
        // chat 的生成预算由 Python 统一管理；OmniMindWeChat 客户端只使用不向设置暴露的传输挂死保护。
        return this.python.chat({
          baseUrl: settings.pythonBaseUrl,
          apiKey,
          accountId: task.accountId,
          sessionId: task.sessionId,
          sessionName: task.sessionName,
          sessionType: task.sessionType,
          messages: task.inboundMessages,
          // 单元测试或受限 Electron 壳可能不提供 getVersion；版本字段本身是可选能力，
          // 缺失时直接省略，不能让一次正常生成退化为 generation_exception。
          clientVersion: typeof app.getVersion === 'function' ? app.getVersion() : undefined,
          // 该值只用于链路追踪，不参与幂等键；真正的幂等真源由来源、会话和消息摘要派生。
          clientRequestId: task.id
        })
      },
      send: (task, text, control) => this.sender.sendAutomatic(
        { accountId: task.accountId, sessionId: task.sessionId, conversationTitle: task.sessionName, text },
        { ...control, authorize: () => this.authorizeGeneratedReply(task) }
      ),
      onSnapshotChanged: (snapshot) => this.snapshotBroadcaster?.({ ...snapshot, runtimeState: this.runtime?.getState() ?? snapshot.runtimeState })
    })
    this.runtime = new OmniMindRuntime({
      validateStart: () => this.validateStart(),
      cancelAllCancellable: (reason) => { this.controller.getSnapshot().waiting.forEach((task) => this.controller.cancelTask(task.id)); const current = this.controller.getSnapshot().current; if (current && current.status !== 'sending') this.controller.cancelTask(current.id); void reason },
      waitForSending: () => this.sender.whenIdle(),
      saveSettings: async (settings) => {
        await this.store.save(settings)
        this.managedScope = settings.managedScope
        this.autoSend = settings.autoSend
        this.batchWindowMs = settings.batchWindowMs
      },
      onStateChanged: () => this.broadcast()
    })
    this.accountSwitcher = new AccountSwitchCoordinator({
      stopIngress: async () => {
        this.ingressEnabled = false
        await this.stopRecoveryDeliveryLoop()
        this.controller.stop()
        await this.stopActiveSubscriber()
      },
      cancelAndWait: async () => { await this.runtime.disable('account_changed'); await this.sender.whenIdle() },
      resetAndRefresh: async (accountId) => {
        normalizedMessageEventHub.reset()
        if (!accountId) { messagePushService.handleConfigCleared(); return }
        if (!await messagePushService.rebaselineForAccountChange()) throw new Error('account_rebaseline_failed')
      },
      setIdentity: (accountId) => this.runtime.handleAccountIdentity(accountId),
      fail: () => { this.controller.stop(); this.runtime.fail('account_switch_failed'); this.broadcast() }
    })
  }

  setSnapshotBroadcaster(broadcaster: (snapshot: OmniMindSnapshot) => void): void { this.snapshotBroadcaster = broadcaster }
  setPermissionBroadcaster(broadcaster: (event: OmniMindPermissionReturnEvent) => void): void { this.permissionBroadcaster = broadcaster }
  getSnapshot(): OmniMindSnapshot { return { ...this.controller.getSnapshot(), runtimeState: this.runtime.getState(), error: this.runtime.getError() } }
  getSettings(): ReturnType<SecureOmniMindSettingsStore['getRendererSettings']> { return this.store.getRendererSettings() }
  getPermissions(): Promise<OmniMindPermissionSnapshot> { return this.permissions.refreshPassive() }
  requestPermission(permission: OmniMindPermissionKind): Promise<OmniMindPermissionSnapshot> { return this.permissions.request(permission) }
  recheckPermission(permission: OmniMindPermissionKind): Promise<OmniMindPermissionSnapshot> { return this.permissions.recheck(permission) }
  openPermissionSettings(permission: OmniMindPermissionKind): Promise<void> { return this.permissions.openSettings(permission) }
  refreshPermissionsAfterNativeReturn(): Promise<OmniMindPermissionSnapshot> {
    const now = Date.now()
    if (this.nativeReturnRefresh) return this.nativeReturnRefresh
    if (!this.permissions.hasActiveSettingsHandoff() && now - this.lastNativeReturnRefreshAt < 500) return Promise.resolve(this.permissions.getCached())
    this.lastNativeReturnRefreshAt = now
    this.nativeReturnRefresh = this.permissions.handleNativeReturn().finally(() => { this.nativeReturnRefresh = undefined })
    return this.nativeReturnRefresh
  }

  saveSettings(settings: OmniMindSettingsInput): Promise<void> {
    return this.serializeSettingsMutation(() => this.saveSettingsImmediately(settings))
  }

  private async saveSettingsImmediately(settings: OmniMindSettingsInput): Promise<void> {
    const current = await this.store.getRendererSettings()
    const criticalChanged = isCriticalSettingsChange(current, settings)
    await this.stopForCriticalSettingsChange(criticalChanged)
    await this.runtime.saveSettings(settings, criticalChanged)
    this.broadcast()
  }

  async testConnection(payload?: { pythonBaseUrl: string; apiKeyDraft?: string }): Promise<{ success: boolean; kind?: string; latencyMs?: number }> {
    const settings = await this.store.getRendererSettings()
    const apiKey = payload?.apiKeyDraft ?? await this.store.getApiKey()
    if (!apiKey) return { success: false, kind: 'auth' }
    const startedAt = Date.now()
    const result = await this.python.check(payload?.pythonBaseUrl ?? settings.pythonBaseUrl, apiKey)
    return { ...result, latencyMs: Date.now() - startedAt }
  }

  clearApiKey(): Promise<void> {
    return this.serializeSettingsMutation(() => this.clearApiKeyImmediately())
  }

  private async clearApiKeyImmediately(): Promise<void> {
    const settings = await this.store.getRendererSettings()
    // Key 是关键设置；活跃托管必须先完成既有 fail-closed 停止流程，再调用 Store 专用命令。
    // 这里不构造普通 settings payload，因而不会旁路范围/官方策略校验，也不会重写其他设置。
    await this.stopForCriticalSettingsChange(settings.hasApiKey)
    await this.store.clearApiKey()
    this.broadcast()
  }

  private serializeSettingsMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.settingsMutationTail.then(operation)
    // tail 永远收敛为 fulfilled，确保某次 Store/生命周期失败不会毒化后续设置命令；
    // 当前调用者仍拿到原始 result，因此错误不会被吞掉。
    this.settingsMutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async stopForCriticalSettingsChange(criticalChanged: boolean): Promise<void> {
    if (!criticalChanged || !['running', 'paused', 'degraded', 'validating', 'starting'].includes(this.runtime.getState())) return
    // 关键设置变化对 paused 同样 fail closed：先封住新 ingress 和 subscriber，再执行正式停止/取消，
    // 保存完成后保持 stopped，用户之后必须重新显式启动并通过完整预检。
    this.ingressEnabled = false
    await this.stopRecoveryDeliveryLoop()
    this.controller.stop()
    normalizedMessageEventHub.reset()
    await this.stopActiveSubscriber()
    await this.runtime.disable('critical_settings_changed')
  }

  async enable(): Promise<OmniMindSnapshot> {
    return this.runStartCommand(async () => {
      const prepared = await this.runtime.prepareEnable()
      if (prepared) await this.commitPreparedStart()
      return this.getSnapshot()
    })
  }
  async pause(): Promise<OmniMindSnapshot> {
    return this.runLifecycleCommand(async () => {
      if (this.runtime.getState() !== 'running') return this.getSnapshot()
      // 原子意图顺序：先同步关闭 controller 的 ingress 闸门，再关闭专属消息 subscriber，
      // 最后才广播 paused。任何关闭异常都进入 failed，但绝不调用 disable 或取消队列。
      const ingressStopped = await this.stopIngressPreservingQueue()
      if (ingressStopped) this.runtime.pause()
      else this.runtime.fail('subscriber_pause_failed')
      return this.getSnapshot()
    })
  }
  async resume(): Promise<OmniMindSnapshot> {
    return this.runStartCommand(async () => {
      if (this.runtime.getState() !== 'paused') return this.getSnapshot()
      // prepareResume 会复用 validateStart，并停在 starting；只有真实 ingress 全部就绪后才提交 running。
      const prepared = await this.runtime.prepareResume()
      if (prepared) await this.commitPreparedStart()
      return this.getSnapshot()
    })
  }
  async disable(): Promise<OmniMindSnapshot> {
    return this.runLifecycleCommand(async () => {
      this.ingressEnabled = false
      await this.stopRecoveryDeliveryLoop()
      this.controller.stop()
      normalizedMessageEventHub.reset()
      await this.stopActiveSubscriber()
      await this.runtime.disable()
      this.broadcast()
      return this.getSnapshot()
    })
  }
  async sendManual(payload: { sessionId: string; text: string }): Promise<OmniMindSendResult> {
    const permissionFailure = await this.authorizeNativeSend()
    if (permissionFailure) return permissionFailure
    const accountId = String(this.config.get('myWxid') || '').trim()
    if (!accountId || (this.runtime.getAccountId() && this.runtime.getAccountId() !== accountId)) return { success: false, error: 'account_unavailable' }
    let sessions: Awaited<ReturnType<typeof chatService.getSessions>>
    try {
      sessions = await chatService.getSessions()
    } catch {
      // 首次刷新只为取得搜索词；数据库异常不得穿透 IPC，也不能让 sender 在缺少可靠标题时启动事务。
      return { success: false, error: 'conversation_title_unavailable' }
    }
    if (!sessions.success || !Array.isArray(sessions.sessions)) return { success: false, error: 'conversation_title_unavailable' }
    const session = sessions.sessions?.find((candidate) => candidate.username === payload.sessionId)
    const conversationTitle = String(session?.displayName || '').trim()
    return this.sender.sendManual(
      { ...payload, accountId, conversationTitle },
      async () => await this.authorizeNativeSend() ?? await this.authorizeUniqueConversationTarget(payload.sessionId, conversationTitle)
    )
  }
  cancelTask(taskId: string): boolean { const result = this.controller.cancelTask(taskId); this.broadcast(); return result }
  retryTask(taskId: string): boolean { const result = Boolean(this.controller.retryTask(taskId)); this.broadcast(); return result }
  /**
   * 用户在微信中核对后可显式确认“发送结果未确认”的任务已经送达。
   * 队列层负责原子资格检查与唯一一次 changed 广播；这里不再次广播，避免同一命令产生双快照。
   */
  confirmDelivery(taskId: string): OmniMindSnapshot {
    this.controller.confirmDelivery(taskId)
    return this.getSnapshot()
  }
  async sendGeneratedReply(taskId: string): Promise<OmniMindSendResult> {
    const task = this.controller.findTask(taskId)
    if (!task) return { success: false, error: 'task_not_awaiting_manual_send' }
    // mutex 外只做廉价的资格预检；会话标题唯一性必须等 sender 真正取得全局发送权后再读新鲜列表。
    const authorizationFailure = await this.authorizeGeneratedReply(task, false)
    if (authorizationFailure) return authorizationFailure
    const result = await this.controller.sendGeneratedReply(taskId)
    this.broadcast()
    return result
  }
  abandonGeneratedReply(taskId: string): boolean { const result = this.controller.abandonGeneratedReply(taskId); this.broadcast(); return result }

  private async authorizeGeneratedReply(task: OmniMindTask, validateTarget = true): Promise<{ success: false; error: string } | undefined> {
    const permissionFailure = await this.authorizeNativeSend()
    if (permissionFailure) return permissionFailure
    const accountId = String(this.config.get('myWxid') || '').trim()
    if (!accountId || accountId !== task.accountId) return { success: false, error: 'current_account_changed' }
    let settings: Awaited<ReturnType<SecureOmniMindSettingsStore['getRendererSettings']>>
    try { settings = await this.store.getRendererSettings() } catch { return { success: false, error: 'current_settings_unavailable' } }
    if (!isManagedSession(settings.managedScope, task.sessionId)) return { success: false, error: 'managed_scope_changed' }
    // Controller 已阻止新 official ingress；这里仍必须无条件复核，覆盖升级前已经排队、
    // 已生成或等待人工发送的历史任务，确保任何发送路径都不能因旧设置为 false 而放行。
    if (task.sessionType === 'official') return { success: false, error: 'official_account_filtered' }
    try {
      if (!await this.store.getApiKey()) return { success: false, error: 'api_key_unavailable' }
    } catch { return { success: false, error: 'api_key_unavailable' } }
    return validateTarget ? this.authorizeUniqueConversationTarget(task.sessionId, task.sessionName) : undefined
  }

  /**
   * Deferred Delivery 不复用 managedScope 判断：这是坐席已经在工作台明确批准的后续答复，
   * 但仍必须在真正取得 sender mutex 后复核 runtime、账号、系统权限和唯一会话标题。
   */
  private async authorizeRecoveryDelivery(accountId: string, sessionId: string): Promise<{ success: false; error: string } | undefined> {
    if (this.runtime.getState() !== 'running') return { success: false, error: 'runtime_not_running' }
    const currentAccountId = String(this.config.get('myWxid') || '').trim()
    if (!currentAccountId || currentAccountId !== accountId || this.runtime.getAccountId() !== accountId) {
      return { success: false, error: 'current_account_changed' }
    }
    const permissionFailure = await this.permissions.authorizeAction()
    if (permissionFailure) {
      if (permissionFailure.error === 'accessibility_permission_denied' || permissionFailure.error === 'automation_permission_denied') {
        this.runtime.degrade(permissionFailure.error)
        this.ingressEnabled = false
        // stop() 在进入第一个 await 前就递增 epoch 并取消 fetch；此处不能等待自身 inFlight，
        // 否则 sender 授权回调会和 Delivery Loop 形成自等待。
        void this.stopRecoveryDeliveryLoop()
        void this.stopActiveSubscriber()
      }
      return permissionFailure
    }
    let sessions: Awaited<ReturnType<typeof chatService.getSessions>>
    try { sessions = await chatService.getSessions() } catch { return { success: false, error: 'conversation_title_unavailable' } }
    if (!sessions.success || !Array.isArray(sessions.sessions)) return { success: false, error: 'conversation_title_unavailable' }
    const title = String(sessions.sessions.find((candidate) => candidate.username === sessionId)?.displayName || '').trim()
    return this.authorizeUniqueConversationTarget(sessionId, title)
  }

  /**
   * WeChat 4.x 发送采用快捷键搜索后选择首项。因为不能从 AX 子树可靠地识别结果，
   * 必须在共享 sender mutex 已取得后，用新鲜会话列表确认“搜索词 -> sessionId”仍是唯一映射。
   * trim 后使用 locale-aware 小写比较，联系人与群聊不做类型区分；同名一律 fail closed。
   */
  private async authorizeUniqueConversationTarget(sessionId: string, expectedTitle: string): Promise<{ success: false; error: string } | undefined> {
    const normalizedExpectedTitle = expectedTitle.trim().toLocaleLowerCase()
    if (!normalizedExpectedTitle) return { success: false, error: 'conversation_title_unavailable' }
    let sessions: Awaited<ReturnType<typeof chatService.getSessions>>
    try { sessions = await chatService.getSessions() } catch { return { success: false, error: 'conversation_title_unavailable' } }
    if (!sessions.success || !Array.isArray(sessions.sessions)) return { success: false, error: 'conversation_title_unavailable' }
    const targetSession = sessions.sessions.find((candidate) => candidate.username === sessionId)
    const freshTitle = String(targetSession?.displayName || '').trim()
    if (!freshTitle) return { success: false, error: 'conversation_title_unavailable' }
    const normalizedFreshTitle = freshTitle.toLocaleLowerCase()
    if (normalizedFreshTitle !== normalizedExpectedTitle) return { success: false, error: 'target_ambiguous' }
    const matchingSessionIds = new Set(
      sessions.sessions
        .filter((candidate) => String(candidate.displayName || '').trim().toLocaleLowerCase() === normalizedFreshTitle)
        .map((candidate) => candidate.username)
    )
    return matchingSessionIds.size === 1 && matchingSessionIds.has(sessionId)
      ? undefined
      : { success: false, error: 'target_ambiguous' }
  }

  switchAccount<T>(accountId: string, commit: () => T | Promise<T>, isNoOp?: () => boolean): Promise<T | undefined> {
    return this.accountSwitcher.switch(accountId, commit, isNoOp).then((result) => { this.broadcast(); return result })
  }

  patchAccount(patch: AccountConfigPatch, expectedAccountId?: string): Promise<void | undefined> {
    return this.accountSwitcher.switchResolved(() => {
      const current = this.config.getAccountBundle()
      if (expectedAccountId !== undefined && current.myWxid !== expectedAccountId) throw new Error('stale_account_patch')
      const next = parseAccountConfigBundle({ ...current, ...patch })
      const noOp = (Object.keys(next) as Array<keyof typeof next>).every((key) => next[key] === current[key])
      return { accountId: next.myWxid, noOp, commit: () => this.config.setAccountBundle(next) }
    })
  }

  private async validateStart(): Promise<{ success: boolean; accountId?: string; error?: string }> {
    const permissionFailure = await this.authorizeNativeSend()
    if (permissionFailure) return { success: false, error: permissionFailure.error }
    const accountId = String(this.config.get('myWxid') || '').trim()
    if (!accountId || !this.config.get('dbPath') || !this.config.get('decryptKey')) return { success: false, error: 'database_not_ready' }
    const settings = await this.store.getRendererSettings()
    this.validatedPythonBaseUrl = settings.pythonBaseUrl
    this.managedScope = settings.managedScope
    this.autoSend = settings.autoSend
    this.batchWindowMs = settings.batchWindowMs
    if (settings.managedScope.mode === 'selected' && settings.managedScope.conversations.length === 0) return { success: false, error: 'scope_required' }
    if (process.platform !== 'darwin') return { success: false, error: 'sender_unavailable' }
    // 本地平台与设置合同通过后，先确认 WeChat 可操作窗口，再进行 Python 网络连接检查。
    // preflight 只准备窗口；不搜索会话、不读写剪贴板、不点击目标也不发送。
    const readiness = await this.wechatReadiness.checkReadiness({ restoreFocus: true })
    if (!readiness.success) return { success: false, error: readiness.error || 'wechat_window_recovery_failed' }
    const connection = await this.testConnection()
    return connection.success ? { success: true, accountId } : { success: false, error: connection.kind || 'python_unavailable' }
  }

  private broadcast(): void { this.snapshotBroadcaster?.(this.getSnapshot()) }

  private async authorizeNativeSend(): Promise<MacOsAuthorizationFailure | undefined> {
    const failure = await this.permissions.authorizeAction()
    if (failure?.error === 'accessibility_permission_denied' || failure?.error === 'automation_permission_denied') {
      // 只有系统快照明确为 denied 才证明运行期权限被撤销，并将 runtime 降级。
      // probe 异常得到的 permission_status_unknown 仍阻止当前动作，但不改写 running 真值。
      this.runtime.degrade(failure.error)
      // 权限已明确撤销时同步封住 controller，并尽力关闭专属 subscriber；
      // 该路径只保留队列，不走 stop/disable，也不影响待确认回复或正在发送的安全收尾。
      await this.stopIngressPreservingQueue()
    }
    return failure
  }

  /** 将 enable/pause/resume/disable 串行化，避免快速重复点击造成双订阅或交错快照。 */
  private runLifecycleCommand<T>(command: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(command, command)
    this.lifecycleTail = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * enable/resume 共用一条在途启动事务。重复点击直接取得同一个权威结果，不会在首个
   * bootstrap 失败后把同一批并发点击解释成第二次启动，也不会建立双 subscriber。
   */
  private runStartCommand(command: () => Promise<OmniMindSnapshot>): Promise<OmniMindSnapshot> {
    if (this.startOperation) return this.startOperation
    const operation = this.runLifecycleCommand(command)
    this.startOperation = operation
    const clear = (): void => { if (this.startOperation === operation) this.startOperation = undefined }
    operation.then(clear, clear)
    return operation
  }

  /**
   * starting 阶段建立真实 ingress；只有 controller/subscriber 全部成功后才由 Runtime 提交 running。
   * bootstrap 失败不走 disable，不取消既有队列；若异步期间状态已失效，则立即回收刚建立的 ingress。
   */
  private async commitPreparedStart(): Promise<void> {
    if (this.runtime.getState() !== 'starting') return
    if (!await this.startIngressPreservingQueue()) {
      if (this.runtime.getState() === 'starting') this.runtime.fail('subscriber_bootstrap_failed')
      return
    }
    if (!this.runtime.completeStart()) await this.stopIngressPreservingQueue()
    else await this.startRecoveryDeliveryLoop()
  }

  private async startRecoveryDeliveryLoop(): Promise<void> {
    const accountId = this.runtime.getAccountId()
    const baseUrl = this.validatedPythonBaseUrl
    if (this.runtime.getState() !== 'running' || !accountId || !baseUrl) return
    try {
      const apiKey = await this.store.getApiKey()
      if (!apiKey || this.runtime.getState() !== 'running' || this.runtime.getAccountId() !== accountId) return
      this.deliveryLoop.start({ baseUrl, apiKey, accountId })
    } catch {
      // 凭据或安全存储不可用时不启动轮询；既有入站自动托管状态不伪装成 Delivery 成功。
    }
  }

  private stopRecoveryDeliveryLoop(): Promise<void> {
    // 少数既有边界单测用 Object.create 构造只含被测依赖的 Service harness；生产构造器始终
    // 注入 deliveryLoop。这里保持停止命令向后兼容，同时不降低真实实例的生命周期保证。
    return (this.deliveryLoop as OpenRecoveryDeliveryLoop | undefined)?.stop() ?? Promise.resolve()
  }

  /**
   * 启动 ingress 时保持闸门关闭，直到 controller 已订阅且消息 subscriber bootstrap 成功。
   * 失败时 controller 可以保留休眠订阅（authorizeIngress 恒为 false），从而不调用其会取消
   * 队列的 stop；同时关闭 subscriber 并清理接入去重缓存，已有 queue snapshot 不受影响。
   */
  private async startIngressPreservingQueue(): Promise<boolean> {
    if (this.ingressEnabled && this.subscriberActive) return true
    this.ingressEnabled = false
    this.controller.start()
    try {
      const ready = await messagePushService.handleOmniMindSubscriberChanged(true)
      if (!ready) throw new Error('subscriber_bootstrap_failed')
      this.subscriberActive = true
      this.ingressEnabled = true
      return true
    } catch {
      this.ingressEnabled = false
      this.subscriberActive = false
      normalizedMessageEventHub.reset()
      // true bootstrap 尚未成功，因此不存在可证明的 active subscriber；不能发送伪 stop 生命周期通知。
      // controller 的 authorizeIngress 闸门已经同步关闭，休眠订阅不会接入新任务，已有队列也不会被取消。
      return false
    }
  }

  /**
   * pause/degraded 只停止新接入：不调用 controller.stop、queue.cancelAll、runtime.disable，
   * 因此 current/waiting/awaiting/recent 与已在发送 mutex 中的任务均按原安全语义保留。
   */
  private async stopIngressPreservingQueue(): Promise<boolean> {
    this.ingressEnabled = false
    // 权限预检也会复用 authorizeNativeSend。若 runtime 尚未真实建立 subscriber，
    // 这里只需关闭 controller 闸门；不得为“本来就未启动”的订阅额外发送 false 通知。
    // 该判断也使重复权限失败与重复 pause 保持幂等，真实 running/paused 转换仍各通知一次。
    await this.stopRecoveryDeliveryLoop()
    return this.stopActiveSubscriber()
  }

  /**
   * subscriber 生命周期以主进程记录的真实 active 状态为准。正式停止、账号切换、权限回归
   * 和 pause 都复用这一边界，避免 paused/stopped/starting 期间发送并不存在的 false 事件。
   */
  private async stopActiveSubscriber(): Promise<boolean> {
    if (!this.subscriberActive) return true
    try {
      const stopped = await messagePushService.handleOmniMindSubscriberChanged(false)
      this.subscriberActive = false
      return stopped
    } catch {
      this.subscriberActive = false
      return false
    }
  }
}

let service: OmniMindService | undefined
export const getOmniMindService = (): OmniMindService => service ??= new OmniMindService()
