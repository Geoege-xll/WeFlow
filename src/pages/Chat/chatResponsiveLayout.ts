export interface ChatResponsiveLayout {
  sessionWidth: number
  messageWidth: number
  queueWidth: number
  compactHeader: boolean
}

const GRID_GAP = 12
const GRID_GAP_COUNT = 1
// Six 44px actions need 264px; the remaining 136px preserves avatar/identity context.
// Identity text already truncates, so compacting above this floor needlessly hides the actions.
const DESKTOP_HEADER_FIT_WIDTH = 400
const BASE_DESKTOP_ACTION_COUNT = 6
const ACTION_TARGET_WIDTH = 44

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(Math.max(value, minimum), maximum)
)

export const computeChatResponsiveLayout = (
  measuredAvailableWidth?: number,
  measuredPreferredSessionWidth?: number,
  desktopActionCount = BASE_DESKTOP_ACTION_COUNT
): ChatResponsiveLayout => {
  const availableWidth = Math.max(0, Math.round(
    Number.isFinite(measuredAvailableWidth) ? measuredAvailableWidth! : 0
  ))
  const preferredSessionWidth = Math.round(
    Number.isFinite(measuredPreferredSessionWidth) ? measuredPreferredSessionWidth! : 260
  )
  const narrow = availableWidth < 800
  const queueWidth = 0
  const sessionWidth = narrow
    ? clamp(preferredSessionWidth, 240, 260)
    : clamp(preferredSessionWidth, 250, 260)
  const messageWidth = Math.max(0, availableWidth - sessionWidth - queueWidth - (GRID_GAP * GRID_GAP_COUNT))
  const normalizedActionCount = Number.isFinite(desktopActionCount)
    ? Math.max(BASE_DESKTOP_ACTION_COUNT, Math.round(desktopActionCount))
    : BASE_DESKTOP_ACTION_COUNT
  const desktopHeaderFitWidth = DESKTOP_HEADER_FIT_WIDTH
    + ((normalizedActionCount - BASE_DESKTOP_ACTION_COUNT) * ACTION_TARGET_WIDTH)

  return {
    sessionWidth,
    messageWidth,
    queueWidth,
    compactHeader: messageWidth < desktopHeaderFitWidth
  }
}
