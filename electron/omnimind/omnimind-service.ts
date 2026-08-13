import { app, clipboard, safeStorage, shell, systemPreferences } from 'electron'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { isCriticalSettingsChange, isManagedSession, type ManagedScope, type OmniMindPermissionKind, type OmniMindPermissionReturnEvent, type OmniMindPermissionSnapshot, type OmniMindSendResult, type OmniMindSettingsInput, type OmniMindSnapshot, type OmniMindTask } from '../../shared/omnimind/contracts'
import { ConfigService } from '../services/config'
import { chatService } from '../services/chatService'
import { messagePushService } from '../services/messagePushService'
import { buildOsascriptArguments, MacOsWeChatTextAdapter, WcdbOutboundVerifier } from './macos-wechat-text-adapter'
import { normalizedMessageEventHub } from './normalized-message-event-hub'
import { OmniMindController } from './omnimind-controller'
import { OmniMindPythonClient } from './omnimind-python-client'
import { OmniMindRuntime } from './omnimind-runtime'
import { SecureOmniMindSettingsStore } from './secure-settings-store'
import { UnifiedSender } from './unified-sender'
import { AccountSwitchCoordinator } from './account-switch-coordinator'
import { parseAccountConfigBundle, type AccountConfigPatch } from '../../shared/omnimind/account-bundle'
import { createAtomicDiagnosticFile, DeliveryDiagnosticStore } from './delivery-diagnostics'
import { registerClosedStreamDiagnosticSink } from '../safe-console'
import { MacOsPermissionService, SYSTEM_EVENTS_PERMISSION_PROBE_SCRIPT } from './macos-permission-service'

const execFileAsync = promisify(execFile)

export class OmniMindService {
  private readonly config = ConfigService.getInstance()
  private readonly python = new OmniMindPythonClient()
  private readonly store: SecureOmniMindSettingsStore
  private readonly sender: UnifiedSender
  private readonly controller: OmniMindController
  private readonly runtime: OmniMindRuntime
  private snapshotBroadcaster?: (snapshot: OmniMindSnapshot) => void
  private permissionBroadcaster?: (event: OmniMindPermissionReturnEvent) => void
  private readonly permissions: MacOsPermissionService
  private managedScope: ManagedScope = { mode: 'selected', conversations: [] }
  private autoSend = true
  private ignoreOfficial = true
  private batchWindowMs = 2000
  private readonly accountSwitcher: AccountSwitchCoordinator
  private nativeReturnRefresh?: Promise<OmniMindPermissionSnapshot>
  private lastNativeReturnRefreshAt = 0

  constructor(permissionService?: MacOsPermissionService) {
    const settingsDirectory = path.join(app.getPath('userData'), 'omnimind')
    this.store = new SecureOmniMindSettingsStore({
      safeStorage,
      read: async (key) => {
        try { return await fs.readFile(path.join(settingsDirectory, `${key}.json`), 'utf8') } catch { return undefined }
      },
      writeAtomic: async (key, value) => {
        await fs.mkdir(settingsDirectory, { recursive: true })
        const target = path.join(settingsDirectory, `${key}.json`)
        const temporary = path.join(settingsDirectory, `.${key}.${process.pid}.tmp`)
        await fs.writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temporary, target)
      }
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
    const adapter = new MacOsWeChatTextAdapter({
      platform: process.platform,
      clipboard,
      runAppleScript: async (script, args) => {
        const { stdout } = await execFileAsync('/usr/bin/osascript', buildOsascriptArguments(script, args), { timeout: 15_000 })
        return stdout.trim()
      }
    })
    const diagnosticPath = path.join(settingsDirectory, 'delivery-diagnostics.json')
    const diagnostics = new DeliveryDiagnosticStore(createAtomicDiagnosticFile(diagnosticPath))
    registerClosedStreamDiagnosticSink((event) => diagnostics.recordRuntimeStreamClosure(event))
    this.sender = new UnifiedSender({
      cancelForManualSend: (accountId, sessionId) => this.controller.cancelForManualSend(accountId, sessionId),
      adapter,
      verifier: new WcdbOutboundVerifier(chatService),
      recordDiagnostic: (entry) => diagnostics.record(entry)
    })
    this.controller = new OmniMindController({
      hub: normalizedMessageEventHub,
      accountId: () => String(this.config.get('myWxid') || '').trim() || undefined,
      managedScope: () => this.managedScope,
      autoSend: () => this.autoSend,
      ignoreOfficial: () => this.ignoreOfficial,
      authorizeIngress: () => this.permissions.isReady(),
      batchDelayMs: () => this.batchWindowMs,
      generate: async (task) => {
        const settings = await this.store.getRendererSettings()
        const apiKey = await this.store.getApiKey()
        if (!apiKey) return { kind: 'auth' }
        return this.python.chat({ baseUrl: settings.pythonBaseUrl, apiKey, sessionId: task.sessionId, externalUserId: task.sessionId, message: task.text, timeoutMs: settings.requestTimeoutMs })
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
        this.ignoreOfficial = settings.ignoreOfficial
        this.batchWindowMs = settings.batchWindowMs
      },
      onStateChanged: () => this.broadcast()
    })
    this.accountSwitcher = new AccountSwitchCoordinator({
      stopIngress: async () => { this.controller.stop(); await messagePushService.handleOmniMindSubscriberChanged(false) },
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

  async saveSettings(settings: OmniMindSettingsInput): Promise<void> {
    const current = await this.store.getRendererSettings()
    const criticalChanged = isCriticalSettingsChange(current, settings)
    if (criticalChanged && this.runtime.getState() === 'running') {
      this.controller.stop()
      normalizedMessageEventHub.reset()
      await messagePushService.handleOmniMindSubscriberChanged(false)
    }
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

  async clearApiKey(): Promise<void> {
    const settings = await this.store.getRendererSettings()
    await this.saveSettings({ ...settings, clearApiKey: true })
  }

  async enable(): Promise<OmniMindSnapshot> {
    await this.runtime.enable()
    if (this.runtime.getState() === 'running') {
      this.controller.start()
      const ingressReady = await messagePushService.handleOmniMindSubscriberChanged(true)
      if (!ingressReady) {
        this.controller.stop()
        normalizedMessageEventHub.reset()
        await messagePushService.handleOmniMindSubscriberChanged(false)
        await this.runtime.disable('subscriber_bootstrap_failed')
        this.runtime.fail('subscriber_bootstrap_failed')
      }
    }
    this.broadcast()
    return this.getSnapshot()
  }
  async disable(): Promise<OmniMindSnapshot> {
    this.controller.stop()
    normalizedMessageEventHub.reset()
    await messagePushService.handleOmniMindSubscriberChanged(false)
    await this.runtime.disable()
    this.broadcast()
    return this.getSnapshot()
  }
  async sendManual(payload: { sessionId: string; text: string }): Promise<OmniMindSendResult> {
    const permissionFailure = await this.authorizeNativeSend()
    if (permissionFailure) return permissionFailure
    const accountId = String(this.config.get('myWxid') || '').trim()
    if (!accountId || (this.runtime.getAccountId() && this.runtime.getAccountId() !== accountId)) return { success: false, error: 'account_unavailable' }
    const sessions = await chatService.getSessions()
    const session = sessions.sessions?.find((candidate) => candidate.username === payload.sessionId)
    const conversationTitle = String(session?.displayName || '').trim()
    if (!conversationTitle) return { success: false, error: 'conversation_title_unavailable' }
    return this.sender.sendManual({ ...payload, accountId, conversationTitle }, () => this.authorizeNativeSend())
  }
  cancelTask(taskId: string): boolean { const result = this.controller.cancelTask(taskId); this.broadcast(); return result }
  retryTask(taskId: string): boolean { const result = Boolean(this.controller.retryTask(taskId)); this.broadcast(); return result }
  async sendGeneratedReply(taskId: string): Promise<OmniMindSendResult> {
    const task = this.controller.findTask(taskId)
    if (!task) return { success: false, error: 'task_not_awaiting_manual_send' }
    const authorizationFailure = await this.authorizeGeneratedReply(task)
    if (authorizationFailure) return authorizationFailure
    const result = await this.controller.sendGeneratedReply(taskId)
    this.broadcast()
    return result
  }
  abandonGeneratedReply(taskId: string): boolean { const result = this.controller.abandonGeneratedReply(taskId); this.broadcast(); return result }

  private async authorizeGeneratedReply(task: OmniMindTask): Promise<{ success: false; error: string } | undefined> {
    const permissionFailure = await this.authorizeNativeSend()
    if (permissionFailure) return permissionFailure
    const accountId = String(this.config.get('myWxid') || '').trim()
    if (!accountId || accountId !== task.accountId) return { success: false, error: 'current_account_changed' }
    let settings: Awaited<ReturnType<SecureOmniMindSettingsStore['getRendererSettings']>>
    try { settings = await this.store.getRendererSettings() } catch { return { success: false, error: 'current_settings_unavailable' } }
    if (!isManagedSession(settings.managedScope, task.sessionId)) return { success: false, error: 'managed_scope_changed' }
    if (settings.ignoreOfficial && task.sessionType === 'official') return { success: false, error: 'official_account_filtered' }
    try {
      if (!await this.store.getApiKey()) return { success: false, error: 'api_key_unavailable' }
    } catch { return { success: false, error: 'api_key_unavailable' } }
    return undefined
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
    this.managedScope = settings.managedScope
    this.autoSend = settings.autoSend
    this.ignoreOfficial = settings.ignoreOfficial
    this.batchWindowMs = settings.batchWindowMs
    if (settings.managedScope.mode === 'selected' && settings.managedScope.conversations.length === 0) return { success: false, error: 'scope_required' }
    if (process.platform !== 'darwin') return { success: false, error: 'sender_unavailable' }
    const connection = await this.testConnection()
    return connection.success ? { success: true, accountId } : { success: false, error: connection.kind || 'python_unavailable' }
  }

  private broadcast(): void { this.snapshotBroadcaster?.(this.getSnapshot()) }

  private async authorizeNativeSend(): Promise<{ success: false; error: 'accessibility_permission_denied' | 'automation_permission_denied' } | undefined> {
    return this.permissions.authorizeAction()
  }
}

let service: OmniMindService | undefined
export const getOmniMindService = (): OmniMindService => service ??= new OmniMindService()
