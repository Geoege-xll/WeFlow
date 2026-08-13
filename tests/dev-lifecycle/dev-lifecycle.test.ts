import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startup as pluginStartup } from 'vite-plugin-electron'
import { createElectronRestartCoordinator } from '../../electron/dev-lifecycle'

const waitForExit = async (child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 3_000
  while (child.exitCode === null && child.signalCode === null) {
    if (Date.now() >= deadline) throw new Error(`child ${child.pid} was not reaped`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  }
}

afterEach(() => {
  pluginStartup.exit()
})

describe('repository-controlled Electron dev lifecycle', () => {
  it('coalesces concurrent restart promises into one active startup', async () => {
    let releaseStartup: (() => void) | undefined
    let activeStartups = 0
    let maxActiveStartups = 0
    const startup = vi.fn(async () => {
      activeStartups += 1
      maxActiveStartups = Math.max(maxActiveStartups, activeStartups)
      await new Promise<void>((resolveStartup) => {
        releaseStartup = resolveStartup
      })
      activeStartups -= 1
      return true
    })
    const coordinator = createElectronRestartCoordinator({ stopOwnedChild: vi.fn() })

    const first = coordinator.restart({ startup, reload: vi.fn() })
    const second = coordinator.restart({ startup, reload: vi.fn() })
    const third = coordinator.restart({ startup, reload: vi.fn() })
    await vi.waitFor(() => expect(startup).toHaveBeenCalledOnce())
    releaseStartup?.()
    await Promise.all([first, second, third])

    expect(maxActiveStartups).toBe(1)
    expect(startup).toHaveBeenCalledOnce()
  })

  it('serializes one trailing restart requested while startup is active', async () => {
    const releases: Array<() => void> = []
    let activeStartups = 0
    let maxActiveStartups = 0
    const startup = vi.fn(async () => {
      activeStartups += 1
      maxActiveStartups = Math.max(maxActiveStartups, activeStartups)
      await new Promise<void>((resolveStartup) => releases.push(resolveStartup))
      activeStartups -= 1
      return true
    })
    const coordinator = createElectronRestartCoordinator({ stopOwnedChild: vi.fn() })

    const first = coordinator.restart({ startup, reload: vi.fn() })
    await vi.waitFor(() => expect(startup).toHaveBeenCalledOnce())
    const second = coordinator.restart({ startup, reload: vi.fn() })
    const third = coordinator.restart({ startup, reload: vi.fn() })
    releases.shift()?.()
    await vi.waitFor(() => expect(startup).toHaveBeenCalledTimes(2))
    releases.shift()?.()
    await Promise.all([first, second, third])

    expect(maxActiveStartups).toBe(1)
    expect(startup).toHaveBeenCalledTimes(2)
  })

  it('drains a restart requested in the active run settlement gap', async () => {
    const events: string[] = []
    let releaseFirst: ((started: boolean) => void) | undefined
    let releaseSecond: (() => void) | undefined
    const coordinator = createElectronRestartCoordinator({ stopOwnedChild: vi.fn() })
    let second: Promise<void> | undefined
    let markSecondRequested: (() => void) | undefined
    const secondRequested = new Promise<void>((resolveRequest) => {
      markSecondRequested = resolveRequest
    })
    const firstStartupCompletion = new Promise<boolean>((resolveStartup) => {
      releaseFirst = resolveStartup
    })
    void firstStartupCompletion.then(() => {
      queueMicrotask(() => {
        events.push('request-second')
        second = coordinator.restart({
          reload: vi.fn(),
          startup: async () => {
            events.push('second')
            await new Promise<void>((resolveStartup) => {
              releaseSecond = resolveStartup
            })
            events.push('second-complete')
            return true
          }
        })
        markSecondRequested?.()
      })
    })
    const first = coordinator.restart({
      reload: vi.fn(),
      startup: () => {
        events.push('first')
        return firstStartupCompletion
      }
    })
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'))

    releaseFirst?.(true)
    await secondRequested
    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual(['first', 'request-second', 'second'])
    let secondCallerSettled = false
    void second?.then(() => {
      secondCallerSettled = true
    })
    await Promise.resolve()
    expect(secondCallerSettled).toBe(false)

    releaseSecond?.()
    await Promise.all([first, second])
    expect(events).toEqual(['first', 'request-second', 'second', 'second-complete'])
    expect(secondCallerSettled).toBe(true)
  })

  it('observes startup rejection without producing an unhandled rejection', async () => {
    const startupError = new Error('startup failed')
    const reportError = vi.fn()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const coordinator = createElectronRestartCoordinator({
      stopOwnedChild: vi.fn(),
      reportError
    })

    coordinator.restart({ startup: async () => { throw startupError }, reload: vi.fn() })
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(startupError))
    await new Promise((resolveTurn) => setImmediate(resolveTurn))
    process.removeListener('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
    expect(coordinator.getLastError()).toBe(startupError)
  })

  it('stops the exact owned child when close races with a rejected active startup', async () => {
    const startupError = new Error('active startup failed')
    let rejectStartup: ((error: Error) => void) | undefined
    const stopOwnedChild = vi.fn()
    const reportError = vi.fn()
    const coordinator = createElectronRestartCoordinator({ stopOwnedChild, reportError })
    coordinator.restart({
      reload: vi.fn(),
      startup: () => new Promise<boolean>((_resolveStartup, reject) => {
        rejectStartup = reject
      })
    })
    await vi.waitFor(() => expect(rejectStartup).toBeTypeOf('function'))

    const close = coordinator.close()
    rejectStartup?.(startupError)
    await close

    expect(reportError).toHaveBeenCalledWith(startupError)
    expect(stopOwnedChild).toHaveBeenCalledOnce()
  })

  it('starts a fresh bundle revision and reaps the exact owned child through the close seam', async () => {
    const childScript = resolve(process.cwd(), 'tests/dev-lifecycle/controller-child.cjs')
    const electronPackage = resolve(process.cwd(), 'tests/dev-lifecycle/electron-package.cjs')
    const revisions: string[] = []
    const coordinator = createElectronRestartCoordinator({ stopOwnedChild: () => pluginStartup.exit() })
    const startRevision = (revision: string) => coordinator.restart({
      reload: vi.fn(),
      startup: async () => {
        await pluginStartup([childScript, `revision:${revision}`], {
          stdio: ['ignore', 'ignore', 'ignore', 'pipe']
        }, electronPackage)
        const child = process.electronApp
        const control = child?.stdio[3] as Readable | null | undefined
        control?.setEncoding('utf8')
        await new Promise<void>((resolveRevision, rejectRevision) => {
          const timeout = setTimeout(() => rejectRevision(new Error(`missing revision ${revision}`)), 3_000)
          control?.once('data', (chunk) => {
            clearTimeout(timeout)
            revisions.push(String(chunk).trim())
            resolveRevision()
          })
        })
        return true
      }
    })

    await startRevision('one')
    const firstChild = process.electronApp
    expect(firstChild?.pid).toBeTypeOf('number')

    const firstExit = waitForExit(firstChild!)
    await startRevision('two')
    const secondChild = process.electronApp
    await firstExit

    expect(secondChild?.pid).not.toBe(firstChild?.pid)
    const secondExit = waitForExit(secondChild!)
    await coordinator.close()
    await secondExit
    expect(revisions).toEqual(['REVISION:one', 'REVISION:two'])
    expect(firstChild?.signalCode).toBe('SIGTERM')
    expect(secondChild?.signalCode).toBe('SIGTERM')
  })
})
