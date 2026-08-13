import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLOSED_STREAM_DIAGNOSTIC_BUFFER_LIMIT,
  installSafeConsole,
  registerClosedStreamDiagnosticSink
} from '../electron/safe-console'

type WriteCallback = (error?: Error | null) => void

class TestStream extends EventEmitter {
  writes: string[] = []
  writeImplementation: (chunk: unknown, callback?: WriteCallback) => boolean = (chunk) => {
    this.writes.push(String(chunk))
    return true
  }

  write(chunk: unknown, callback?: WriteCallback): boolean {
    return this.writeImplementation(chunk, callback)
  }
}

const streamError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

describe('installSafeConsole', () => {
  let stopDiscardingDiagnostics: () => void

  beforeEach(() => {
    stopDiscardingDiagnostics = registerClosedStreamDiagnosticSink(() => undefined)
  })

  afterEach(() => {
    stopDiscardingDiagnostics()
  })

  it.each(['EPIPE', 'ERR_STREAM_DESTROYED'])('stops later stdout writes after async %s', (code) => {
    const stdout = new TestStream()
    const stderr = new TestStream()
    installSafeConsole({ stdout, stderr })

    stdout.emit('error', streamError(code))

    expect(stdout.write('after-close')).toBe(true)
    expect(stdout.writes).toEqual([])
  })

  it('keeps stdout and stderr closure state independent', () => {
    const stdout = new TestStream()
    const stderr = new TestStream()
    installSafeConsole({ stdout, stderr })

    stdout.emit('error', streamError('EPIPE'))
    stdout.write('hidden')
    stderr.write('visible')

    expect(stdout.writes).toEqual([])
    expect(stderr.writes).toEqual(['visible'])
  })

  it('is idempotent and retains listeners installed by the application', () => {
    const stdout = new TestStream()
    const stderr = new TestStream()
    const existingListener = vi.fn()
    stdout.on('error', existingListener)

    installSafeConsole({ stdout, stderr })
    const listenerCount = stdout.listenerCount('error')
    installSafeConsole({ stdout, stderr })
    stdout.emit('error', streamError('EPIPE'))

    expect(stdout.listenerCount('error')).toBe(listenerCount)
    expect(existingListener).toHaveBeenCalledOnce()
  })

  it('suppresses later writes when the first write throws a closed-stream error synchronously', () => {
    const stdout = new TestStream()
    const stderr = new TestStream()
    const thrownWrite = vi.fn(() => {
      throw streamError('ERR_STREAM_DESTROYED')
    })
    stdout.writeImplementation = thrownWrite
    installSafeConsole({ stdout, stderr })

    expect(stdout.write('first')).toBe(true)
    expect(stdout.write('second')).toBe(true)
    expect(thrownWrite).toHaveBeenCalledOnce()
  })

  it('invokes callbacks for writes suppressed after closure', async () => {
    const stdout = new TestStream()
    const stderr = new TestStream()
    const callback = vi.fn()
    installSafeConsole({ stdout, stderr })
    stdout.emit('error', streamError('EPIPE'))

    stdout.write('hidden', callback)
    await Promise.resolve()

    expect(callback).toHaveBeenCalledWith()
  })

  it('continues to expose unknown stream errors', () => {
    const stdout = new TestStream()
    const stderr = new TestStream()
    installSafeConsole({ stdout, stderr })
    const error = streamError('EIO')

    expect(() => stdout.emit('error', error)).toThrow(error)
  })

  it('rethrows unknown synchronous write failures', () => {
    const stdout = new TestStream()
    const stderr = new TestStream()
    const error = streamError('EIO')
    stdout.writeImplementation = () => {
      throw error
    }
    installSafeConsole({ stdout, stderr })

    expect(() => stdout.write('still-broken')).toThrow(error)
  })

  it('reports async and synchronous stream closure once while keeping streams independent', () => {
    const diagnostics: Array<Record<string, unknown>> = []
    stopDiscardingDiagnostics()
    const unregister = registerClosedStreamDiagnosticSink((event) => { diagnostics.push(event) })
    const stdout = new TestStream()
    const stderr = new TestStream()
    stderr.writeImplementation = () => { throw streamError('ERR_STREAM_DESTROYED') }
    installSafeConsole({ stdout, stderr })

    stdout.emit('error', streamError('EPIPE'))
    stdout.emit('error', streamError('EPIPE'))
    stderr.write('first')
    stderr.write('second')

    expect(diagnostics).toEqual([
      { stream: 'stdout', code: 'EPIPE' },
      { stream: 'stderr', code: 'ERR_STREAM_DESTROYED' }
    ])
    unregister()
  })

  it('flushes only the bounded tail accumulated before sink registration', () => {
    stopDiscardingDiagnostics()
    for (let index = 0; index < CLOSED_STREAM_DIAGNOSTIC_BUFFER_LIMIT + 5; index += 1) {
      const stdout = new TestStream()
      const stderr = new TestStream()
      installSafeConsole({ stdout, stderr })
      const stream = index % 2 === 0 ? stdout : stderr
      stream.emit('error', streamError('EPIPE'))
    }

    const diagnostics: Array<Record<string, unknown>> = []
    const unregister = registerClosedStreamDiagnosticSink((event) => { diagnostics.push(event) })

    expect(diagnostics).toHaveLength(CLOSED_STREAM_DIAGNOSTIC_BUFFER_LIMIT)
    expect(diagnostics.at(-1)).toEqual({ stream: 'stdout', code: 'EPIPE' })
    unregister()
  })

  it('isolates throwing and rejecting sinks without console recursion or unhandled rejection', async () => {
    stopDiscardingDiagnostics()
    const stdout = new TestStream()
    const stderr = new TestStream()
    installSafeConsole({ stdout, stderr })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    const unregisterThrowing = registerClosedStreamDiagnosticSink(() => { throw new Error('sink failed') })
    expect(() => stdout.emit('error', streamError('EPIPE'))).not.toThrow()
    unregisterThrowing()
    const unregisterRejecting = registerClosedStreamDiagnosticSink(async () => { throw new Error('sink rejected') })
    expect(() => stderr.emit('error', streamError('ERR_STREAM_DESTROYED'))).not.toThrow()
    await new Promise((resolveTurn) => setImmediate(resolveTurn))

    process.removeListener('unhandledRejection', unhandled)
    unregisterRejecting()
    expect(unhandled).not.toHaveBeenCalled()
    expect(stdout.writes).toEqual([])
    expect(stderr.writes).toEqual([])
  })

  it('does not record or swallow unknown EIO errors', () => {
    const diagnostics: Array<Record<string, unknown>> = []
    stopDiscardingDiagnostics()
    const unregister = registerClosedStreamDiagnosticSink((event) => { diagnostics.push(event) })
    const stdout = new TestStream()
    const stderr = new TestStream()
    installSafeConsole({ stdout, stderr })
    const error = streamError('EIO')

    expect(() => stdout.emit('error', error)).toThrow(error)
    expect(diagnostics).toEqual([])
    unregister()
  })
})
