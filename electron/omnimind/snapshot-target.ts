export interface SnapshotWindowTarget {
  isDestroyed(): boolean
  webContents: { send(channel: string, payload: unknown): void }
}

export const sendOmniMindSnapshotToMainWindow = (
  mainWindow: SnapshotWindowTarget | null,
  snapshot: unknown
): boolean => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  mainWindow.webContents.send('omnimind:snapshotChanged', snapshot)
  return true
}
