export const OMNIMIND_OPEN_SETTINGS_EVENT = 'omnimind:open-settings'

export const focusCurrentConversation = (): boolean => {
  const target = document.getElementById('chat-message-area')
  target?.focus()
  return Boolean(target)
}

import type { OmniMindPermissionKind } from '../../../shared/omnimind/contracts'

export interface OmniMindOpenSettingsDetail { opener?: HTMLElement; tab?: 'permissions'; permissionKind?: OmniMindPermissionKind }

/**
 * 从队列、手动发送失败卡片等非中心组件请求统一中心。
 *
 * 权限恢复只携带真实触发源和准确权限类型。所有入口都复用同一权限中心，
 * 不再维护进程级的临时说明步骤，避免应用重启后重复要求用户确认相同信息。
 */
export const requestOmniMindSettings = (opener?: HTMLElement, permissionKind?: OmniMindPermissionKind): void => {
  window.dispatchEvent(new CustomEvent<OmniMindOpenSettingsDetail>(OMNIMIND_OPEN_SETTINGS_EVENT, {
    detail: { opener, ...(permissionKind ? { tab: 'permissions' as const, permissionKind } : {}) }
  }))
}
