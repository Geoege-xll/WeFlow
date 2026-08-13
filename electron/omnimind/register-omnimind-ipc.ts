import { parseCancelTaskPayload, parseEnablePayload, parseManualSendPayload, parsePermissionKindPayload, parseSettingsPayload, parseTaskActionPayload, parseTestConnectionPayload, type OmniMindPermissionSnapshot, type OmniMindSendResult } from '../../shared/omnimind/contracts'

interface IpcMainPort { handle(channel: string, listener: (...args: unknown[]) => unknown): void; removeHandler(channel: string): void }
export interface IpcController {
  getSnapshot(): unknown
  getSettings(): Promise<unknown>
  saveSettings(settings: ReturnType<typeof parseSettingsPayload>): unknown
  testConnection(payload: ReturnType<typeof parseTestConnectionPayload>): unknown
  clearApiKey(): unknown
  enable(): unknown
  disable(): unknown
  sendManual(payload: ReturnType<typeof parseManualSendPayload>): Promise<OmniMindSendResult>
  cancelTask(taskId: string): unknown
  retryTask(taskId: string): unknown
  sendGeneratedReply(taskId: string): Promise<OmniMindSendResult>
  abandonGeneratedReply(taskId: string): unknown
  getPermissions(): Promise<OmniMindPermissionSnapshot> | OmniMindPermissionSnapshot
  requestPermission(permission: ReturnType<typeof parsePermissionKindPayload>['permission']): Promise<OmniMindPermissionSnapshot>
  recheckPermission(permission: ReturnType<typeof parsePermissionKindPayload>['permission']): Promise<OmniMindPermissionSnapshot>
  openPermissionSettings(permission: ReturnType<typeof parsePermissionKindPayload>['permission']): Promise<void>
}

export const OMNIMIND_IPC_CHANNELS = [
  'omnimind:getSnapshot', 'omnimind:getSettings', 'omnimind:saveSettings', 'omnimind:testConnection',
  'omnimind:clearApiKey', 'omnimind:enable', 'omnimind:disable', 'omnimind:sendManual', 'omnimind:cancelTask', 'omnimind:retryTask',
  'omnimind:sendGeneratedReply', 'omnimind:abandonGeneratedReply', 'omnimind:getPermissions', 'omnimind:requestPermission',
  'omnimind:recheckPermission', 'omnimind:openPermissionSettings'
] as const

export function registerOmniMindIpc(ipcMain: IpcMainPort, controller: IpcController): () => void {
  const handlers: Record<typeof OMNIMIND_IPC_CHANNELS[number], (...args: unknown[]) => unknown> = {
    'omnimind:getSnapshot': () => controller.getSnapshot(),
    'omnimind:getSettings': () => controller.getSettings(),
    'omnimind:saveSettings': (_event, payload) => controller.saveSettings(parseSettingsPayload(payload)),
    'omnimind:testConnection': (_event, payload) => controller.testConnection(parseTestConnectionPayload(payload)),
    'omnimind:clearApiKey': (_event, payload = {}) => { parseEnablePayload(payload); return controller.clearApiKey() },
    'omnimind:enable': (_event, payload = {}) => { parseEnablePayload(payload); return controller.enable() },
    'omnimind:disable': (_event, payload = {}) => { parseEnablePayload(payload); return controller.disable() },
    'omnimind:sendManual': (_event, payload) => controller.sendManual(parseManualSendPayload(payload)),
    'omnimind:cancelTask': (_event, payload) => controller.cancelTask(parseCancelTaskPayload(payload).taskId),
    'omnimind:retryTask': (_event, payload) => controller.retryTask(parseCancelTaskPayload(payload).taskId),
    'omnimind:sendGeneratedReply': (_event, payload) => controller.sendGeneratedReply(parseTaskActionPayload(payload).taskId),
    'omnimind:abandonGeneratedReply': (_event, payload) => controller.abandonGeneratedReply(parseTaskActionPayload(payload).taskId),
    'omnimind:getPermissions': (_event, payload = {}) => { parseEnablePayload(payload); return controller.getPermissions() },
    'omnimind:requestPermission': (_event, payload) => controller.requestPermission(parsePermissionKindPayload(payload).permission),
    'omnimind:recheckPermission': (_event, payload) => controller.recheckPermission(parsePermissionKindPayload(payload).permission),
    'omnimind:openPermissionSettings': (_event, payload) => controller.openPermissionSettings(parsePermissionKindPayload(payload).permission)
  }
  for (const channel of OMNIMIND_IPC_CHANNELS) ipcMain.handle(channel, handlers[channel])
  return () => { for (const channel of OMNIMIND_IPC_CHANNELS) ipcMain.removeHandler(channel) }
}
