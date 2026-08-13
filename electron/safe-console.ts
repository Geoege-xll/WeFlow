import type { EventEmitter } from 'node:events'

type WriteCallback = (error?: Error | null) => void
type StreamWrite = {
  (chunk: string | Uint8Array, callback?: WriteCallback): boolean
  (chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: WriteCallback): boolean
}

type ConsoleStream = EventEmitter & {
  write: StreamWrite
}

type SafeConsoleStreams = {
  stdout?: ConsoleStream
  stderr?: ConsoleStream
}

export type ClosedStreamDiagnostic = {
  stream: 'stdout' | 'stderr'
  code: 'EPIPE' | 'ERR_STREAM_DESTROYED'
}

type ClosedStreamDiagnosticSink = (event: ClosedStreamDiagnostic) => void | Promise<void>

export const CLOSED_STREAM_DIAGNOSTIC_BUFFER_LIMIT = 16

const installedStreams = new WeakSet<ConsoleStream>()
const pendingDiagnostics: ClosedStreamDiagnostic[] = []
let diagnosticSink: ClosedStreamDiagnosticSink | undefined

const closedStreamErrorCode = (error: unknown): ClosedStreamDiagnostic['code'] | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' ? code : undefined
}

const dispatchDiagnostic = (event: ClosedStreamDiagnostic): void => {
  if (!diagnosticSink) {
    pendingDiagnostics.push(event)
    if (pendingDiagnostics.length > CLOSED_STREAM_DIAGNOSTIC_BUFFER_LIMIT) pendingDiagnostics.shift()
    return
  }
  try {
    void Promise.resolve(diagnosticSink(event)).catch(() => undefined)
  } catch {
    // Diagnostics must never write to the closed console or crash the stream boundary.
  }
}

export const registerClosedStreamDiagnosticSink = (sink: ClosedStreamDiagnosticSink): (() => void) => {
  diagnosticSink = sink
  const buffered = pendingDiagnostics.splice(0)
  for (const event of buffered) dispatchDiagnostic(event)
  return () => {
    if (diagnosticSink === sink) diagnosticSink = undefined
  }
}

const installStreamBoundary = (stream: ConsoleStream, streamName: ClosedStreamDiagnostic['stream']): void => {
  if (installedStreams.has(stream)) return
  installedStreams.add(stream)

  const originalWrite = stream.write.bind(stream)
  let closed = false
  const markClosed = (code: ClosedStreamDiagnostic['code']): void => {
    if (closed) return
    closed = true
    dispatchDiagnostic({ stream: streamName, code })
  }

  stream.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    trailingCallback?: WriteCallback
  ): boolean => {
    const callback = typeof encodingOrCallback === 'function' ? encodingOrCallback : trailingCallback
    if (closed) {
      if (callback) queueMicrotask(() => callback())
      return true
    }

    try {
      if (typeof encodingOrCallback === 'function') return originalWrite(chunk, encodingOrCallback)
      return originalWrite(chunk, encodingOrCallback, trailingCallback)
    } catch (error) {
      const code = closedStreamErrorCode(error)
      if (!code) throw error
      markClosed(code)
      if (callback) queueMicrotask(() => callback())
      return true
    }
  }) as StreamWrite

  stream.on('error', (error: unknown) => {
    const code = closedStreamErrorCode(error)
    if (!code) throw error
    markClosed(code)
  })
}

export const installSafeConsole = ({
  stdout = process.stdout,
  stderr = process.stderr
}: SafeConsoleStreams = {}): void => {
  installStreamBoundary(stdout, 'stdout')
  installStreamBoundary(stderr, 'stderr')
}

if (process.versions.electron) installSafeConsole()
