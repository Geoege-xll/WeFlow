export const OMNIMIND_OPEN_SETTINGS_EVENT = 'omnimind:open-settings'

export const focusCurrentConversation = (): boolean => {
  const target = document.getElementById('chat-message-area')
  target?.focus()
  return Boolean(target)
}

import type { OmniMindPermissionKind } from '../../../shared/omnimind/contracts'

export interface OmniMindOpenSettingsDetail { opener?: HTMLElement; tab?: 'permissions'; permissionKind?: OmniMindPermissionKind; jit?: boolean }

export const requestOmniMindSettings = (opener?: HTMLElement, permissionKind?: OmniMindPermissionKind): void => {
  window.dispatchEvent(new CustomEvent<OmniMindOpenSettingsDetail>(OMNIMIND_OPEN_SETTINGS_EVENT, { detail: { opener, ...(permissionKind ? { tab: 'permissions' as const, permissionKind } : {}) } }))
}
