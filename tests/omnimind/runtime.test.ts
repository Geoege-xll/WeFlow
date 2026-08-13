import { describe, expect, it, vi } from 'vitest'
import { OmniMindRuntime } from '../../electron/omnimind/omnimind-runtime'

describe('OmniMindRuntime', () => {
  it('retains a sanitized validation failure reason for the renderer snapshot', async () => {
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: false, error: 'database_not_ready' }),
      cancelAllCancellable: vi.fn(), waitForSending: vi.fn(), saveSettings: vi.fn(), onStateChanged: vi.fn()
    })
    await runtime.enable()
    expect(runtime.getState()).toBe('failed')
    expect(runtime.getError()).toBe('database_not_ready')
  })

  it('fails closed instead of remaining validating when validation throws', async () => {
    const runtime = new OmniMindRuntime({ validateStart: async () => { throw new Error('raw secret') }, cancelAllCancellable: vi.fn(), waitForSending: vi.fn(), saveSettings: vi.fn(), onStateChanged: vi.fn() })
    await runtime.enable()
    expect(runtime.getState()).toBe('failed')
    expect(runtime.getError()).toBe('validation_failed')
  })

  it('critical settings save stops, cancels, waits for sending, saves, and stays stopped', async () => {
    const order: string[] = []
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: true, accountId: 'a' }),
      cancelAllCancellable: () => { order.push('cancel') },
      waitForSending: async () => { order.push('wait') },
      saveSettings: async () => { order.push('save') },
      onStateChanged: () => undefined
    })
    await runtime.enable()
    await runtime.saveSettings({ pythonBaseUrl: 'http://127.0.0.1:8000', scope: ['s'] }, true)
    expect(order).toEqual(['cancel', 'wait', 'save'])
    expect(runtime.getState()).toBe('stopped')
  })

  it('general settings save remains running without cancellation or sender wait', async () => {
    const cancel = vi.fn()
    const wait = vi.fn(async () => undefined)
    const save = vi.fn(async () => undefined)
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: true, accountId: 'a' }),
      cancelAllCancellable: cancel,
      waitForSending: wait,
      saveSettings: save,
      onStateChanged: vi.fn()
    })
    await runtime.enable()
    await runtime.saveSettings({ pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', scope: ['s'], batchWindowMs: 2500, requestTimeoutMs: 30000 }, false)
    expect(runtime.getState()).toBe('running')
    expect(cancel).not.toHaveBeenCalled()
    expect(wait).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('account identity change stops and cancels old account work', async () => {
    const cancel = vi.fn()
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: true, accountId: 'a' }),
      cancelAllCancellable: cancel,
      waitForSending: async () => undefined,
      saveSettings: async () => undefined,
      onStateChanged: () => undefined
    })
    await runtime.enable()
    await runtime.handleAccountIdentity('b')
    expect(cancel).toHaveBeenCalledWith('account_changed')
    expect(runtime.getState()).toBe('stopped')
  })
})
