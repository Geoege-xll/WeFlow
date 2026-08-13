import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'

const electronPath = String(await import('electron').then((module) => module.default))
let fixturePath = ''
let fixtureWithoutBoundaryPath = ''

beforeAll(async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'weflow-closed-pipe-'))
  fixturePath = join(outputDirectory, 'electron-child.cjs')
  fixtureWithoutBoundaryPath = join(outputDirectory, 'electron-child-without-boundary.cjs')
  await Promise.all([
    build({
      entryPoints: [resolve(process.cwd(), 'tests/fixtures/closed-pipe/electron-child.ts')],
      outfile: fixturePath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22'
    }),
    build({
      entryPoints: [resolve(process.cwd(), 'tests/fixtures/closed-pipe/electron-child-without-boundary.ts')],
      outfile: fixtureWithoutBoundaryPath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22'
    })
  ])
})

const runFixture = async (
  streamName: 'stdout' | 'stderr',
  errorCode?: string,
  boundaryInstalled = true
): Promise<{ control: string; code: number | null; signal: NodeJS.Signals | null }> => {
  const child = spawn(electronPath, [
    boundaryInstalled ? fixturePath : fixtureWithoutBoundaryPath,
    `probe-stream:${streamName}`,
    ...(errorCode ? [`probe-error:${errorCode}`] : [])
  ], {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe']
  })
  const closedStream = streamName === 'stdout' ? child.stdout : child.stderr

  let control = ''
  const controlChannel = child.stdio[3] as Duplex
  controlChannel.setEncoding('utf8')
  controlChannel.on('data', (chunk) => {
    control += String(chunk)
    if (control.includes('READY\n') && !closedStream.destroyed) {
      closedStream.once('close', () => controlChannel.write('PROBE\n'))
      closedStream.destroy()
    }
    if (/SURVIVED\n|EXPECTED_EPIPE\n|UNKNOWN_(?:EXPOSED|SWALLOWED)\n/.test(control)) {
      controlChannel.end()
    }
  })

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, rejectExit) => {
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 10_000)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      if (timedOut) {
        rejectExit(new Error(`Electron fixture was killed and reaped for ${streamName}/${errorCode || 'closed-pipe'}; control=${JSON.stringify(control)}`))
        return
      }
      resolveExit({ code, signal })
    })
  })
  return { control, ...exit }
}

describe('Electron closed-pipe boundary', () => {
  it.each(['stdout', 'stderr'] as const)('survives a real closed %s pipe using control fd 3', async (streamName) => {
    const result = await runFixture(streamName)

    expect(result).toEqual({ control: 'READY\nSURVIVED\n', code: 0, signal: null })
  }, 15_000)

  it('still fails when Electron emits an unknown stream error', async () => {
    const result = await runFixture('stdout', 'EIO')

    expect(result).toEqual({ control: 'READY\nUNKNOWN_EXPOSED\n', code: 70, signal: null })
  }, 15_000)

  it.each(['stdout', 'stderr'] as const)('fails with a real closed %s pipe when the boundary is absent', async (streamName) => {
    const result = await runFixture(streamName, undefined, false)

    expect(result).toEqual({ control: 'READY\nEXPECTED_EPIPE\n', code: 71, signal: null })
  }, 15_000)

  it('uses the installed Electron 43 executable', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'node_modules/electron/package.json'), 'utf8'))
    expect(packageJson.version).toMatch(/^43\./)
  })
})
