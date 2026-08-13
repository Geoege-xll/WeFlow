import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerSink: vi.fn(),
  recordRuntimeStreamClosure: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/weflow-runtime-logging-service' },
  clipboard: { readText: () => '', writeText: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

vi.mock('../../electron/safe-console', () => ({
  registerClosedStreamDiagnosticSink: mocks.registerSink
}))

vi.mock('../../electron/omnimind/delivery-diagnostics', () => ({
  createAtomicDiagnosticFile: vi.fn(() => ({})),
  DeliveryDiagnosticStore: class {
    record = vi.fn(async () => undefined)
    recordRuntimeStreamClosure = mocks.recordRuntimeStreamClosure
  }
}))

vi.mock('../../electron/services/config', () => ({
  ConfigService: { getInstance: () => ({ get: vi.fn() }) }
}))

vi.mock('../../electron/services/chatService', () => ({
  chatService: { getMessages: vi.fn(), getSessions: vi.fn(async () => ({ success: true, sessions: [] })) }
}))

vi.mock('../../electron/services/messagePushService', () => ({
  messagePushService: {
    handleOmniMindSubscriberChanged: vi.fn(async () => true),
    handleConfigCleared: vi.fn(),
    rebaselineForAccountChange: vi.fn(async () => true)
  }
}))

describe('OmniMind runtime logging registration', () => {
  beforeEach(() => {
    mocks.registerSink.mockReset()
    mocks.recordRuntimeStreamClosure.mockClear()
  })

  it('registers the early stream boundary with the ready diagnostic store', async () => {
    const { OmniMindService } = await import('../../electron/omnimind/omnimind-service')
    new OmniMindService()
    expect(mocks.registerSink).toHaveBeenCalledOnce()
    const sink = mocks.registerSink.mock.calls[0]?.[0] as (event: { stream: 'stdout'; code: 'EPIPE' }) => Promise<void>

    await sink({ stream: 'stdout', code: 'EPIPE' })

    expect(mocks.recordRuntimeStreamClosure).toHaveBeenCalledWith({ stream: 'stdout', code: 'EPIPE' })
  })
})
