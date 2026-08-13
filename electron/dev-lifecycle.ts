export type ElectronStartOptions = {
  startup: () => Promise<boolean>
  reload: () => void
}

type ElectronRestartCoordinatorOptions = {
  stopOwnedChild: () => void
  reportError?: (error: unknown) => void
}

export const createElectronRestartCoordinator = ({
  stopOwnedChild,
  reportError
}: ElectronRestartCoordinatorOptions) => {
  let pendingRestart: ElectronStartOptions | undefined
  let restartRun: Promise<void> | undefined
  let closing = false
  let lastError: unknown

  const observeError = (error: unknown): void => {
    lastError = error
    try {
      reportError?.(error)
    } catch {
      // A reporting hook must not turn an observed lifecycle failure into an unhandled rejection.
    }
  }

  const runPendingRestarts = async (): Promise<void> => {
    await Promise.resolve()
    try {
      while (!closing && pendingRestart) {
        const options = pendingRestart
        pendingRestart = undefined
        try {
          await options.startup()
        } catch (error) {
          observeError(error)
        }
      }
    } finally {
      // Clear ownership before this async run settles. A restart queued by a promise
      // reaction after the final pending check will then create and return a new drain.
      restartRun = undefined
    }
  }

  return {
    restart(options: ElectronStartOptions): Promise<void> {
      if (closing) return Promise.resolve()
      pendingRestart = options
      if (!restartRun) {
        restartRun = runPendingRestarts()
      }
      return restartRun
    },
    async close(): Promise<void> {
      closing = true
      pendingRestart = undefined
      try {
        await restartRun
      } catch (error) {
        observeError(error)
      } finally {
        try {
          stopOwnedChild()
        } catch (error) {
          observeError(error)
        }
      }
    },
    getLastError(): unknown {
      return lastError
    }
  }
}
