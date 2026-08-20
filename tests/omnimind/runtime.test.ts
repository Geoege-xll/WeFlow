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

  it('degrades a running runtime without cancelling preserved queue work', async () => {
    const cancel = vi.fn()
    const stateChanges: Array<{ state: string; error?: string }> = []
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: true, accountId: 'a' }),
      cancelAllCancellable: cancel,
      waitForSending: async () => undefined,
      saveSettings: async () => undefined,
      onStateChanged: (state, error) => { stateChanges.push({ state, error }) }
    })

    await runtime.enable()
    runtime.degrade('automation_permission_denied')
    runtime.degrade('accessibility_permission_denied')

    expect(runtime.getState()).toBe('degraded')
    expect(runtime.getError()).toBe('automation_permission_denied')
    expect(cancel).not.toHaveBeenCalled()
    expect(stateChanges).toContainEqual({ state: 'degraded', error: 'automation_permission_denied' })
    expect(stateChanges.filter(({ state }) => state === 'degraded')).toHaveLength(1)
  })

  it('pauses without cancelling or waiting, then resumes through the same real validation path', async () => {
    const cancel = vi.fn()
    const wait = vi.fn(async () => undefined)
    const validateStart = vi.fn(async () => ({ success: true, accountId: 'a' }))
    const states: string[] = []
    const runtime = new OmniMindRuntime({
      validateStart,
      cancelAllCancellable: cancel,
      waitForSending: wait,
      saveSettings: vi.fn(),
      onStateChanged: (state) => { states.push(state) }
    })

    await runtime.enable()
    runtime.pause()
    runtime.pause()
    expect(runtime.getState()).toBe('paused')
    expect(cancel).not.toHaveBeenCalled()
    expect(wait).not.toHaveBeenCalled()

    await Promise.all([runtime.resume(), runtime.resume()])
    expect(runtime.getState()).toBe('running')
    expect(validateStart).toHaveBeenCalledTimes(2)
    expect(states.slice(-3)).toEqual(['validating', 'starting', 'running'])
    expect(cancel).not.toHaveBeenCalled()
  })

  it('keeps production start prepared at starting until an explicit bootstrap commit', async () => {
    const states: string[] = []
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: true, accountId: 'a' }),
      cancelAllCancellable: vi.fn(), waitForSending: vi.fn(), saveSettings: vi.fn(),
      onStateChanged: (state) => { states.push(state) }
    })

    expect(await runtime.prepareEnable()).toBe(true)
    expect(runtime.getState()).toBe('starting')
    expect(states).toEqual(['validating', 'starting'])
    expect(runtime.completeStart()).toBe(true)
    expect(runtime.getState()).toBe('running')
    expect(runtime.completeStart()).toBe(false)
    expect(states).toEqual(['validating', 'starting', 'running'])
  })

  it('fails closed when resume validation fails and keeps cancellation reserved for explicit disable', async () => {
    const cancel = vi.fn()
    const wait = vi.fn(async () => undefined)
    const validateStart = vi.fn()
      .mockResolvedValueOnce({ success: true, accountId: 'a' })
      .mockResolvedValueOnce({ success: false, error: 'automation_permission_denied' })
    const runtime = new OmniMindRuntime({ validateStart, cancelAllCancellable: cancel, waitForSending: wait, saveSettings: vi.fn(), onStateChanged: vi.fn() })

    await runtime.enable()
    runtime.pause()
    await runtime.resume()

    expect(runtime.getState()).toBe('failed')
    expect(runtime.getError()).toBe('automation_permission_denied')
    expect(cancel).not.toHaveBeenCalled()
    expect(wait).not.toHaveBeenCalled()

    await runtime.disable()
    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith('hosting_disabled')
    expect(wait).toHaveBeenCalledOnce()
    expect(runtime.getState()).toBe('stopped')
  })

  it('rejects pause and resume from illegal states without inventing transitions', async () => {
    const onStateChanged = vi.fn()
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: true, accountId: 'a' }),
      cancelAllCancellable: vi.fn(), waitForSending: vi.fn(), saveSettings: vi.fn(), onStateChanged
    })

    runtime.pause()
    await runtime.resume()
    expect(runtime.getState()).toBe('stopped')
    expect(onStateChanged).not.toHaveBeenCalled()

    await runtime.enable()
    runtime.degrade('automation_permission_denied')
    runtime.pause()
    await runtime.resume()
    expect(runtime.getState()).toBe('degraded')
  })

  it('does not turn startup or stopped states into degraded', async () => {
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: false, error: 'automation_permission_denied' }),
      cancelAllCancellable: vi.fn(),
      waitForSending: async () => undefined,
      saveSettings: async () => undefined,
      onStateChanged: vi.fn()
    })

    runtime.degrade('automation_permission_denied')
    await runtime.enable()
    runtime.degrade('accessibility_permission_denied')

    expect(runtime.getState()).toBe('failed')
    expect(runtime.getError()).toBe('automation_permission_denied')
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
    await runtime.saveSettings({ pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', scope: ['s'], batchWindowMs: 2500 }, false)
    expect(runtime.getState()).toBe('running')
    expect(cancel).not.toHaveBeenCalled()
    expect(wait).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('critical settings saved while paused use formal stop semantics and never auto-resume', async () => {
    const cancel = vi.fn()
    const wait = vi.fn(async () => undefined)
    const save = vi.fn(async () => undefined)
    const runtime = new OmniMindRuntime({
      validateStart: async () => ({ success: true, accountId: 'a' }),
      cancelAllCancellable: cancel, waitForSending: wait, saveSettings: save, onStateChanged: vi.fn()
    })
    await runtime.enable()
    runtime.pause()

    await runtime.saveSettings({ pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', scope: ['s'] } as never, true)

    expect(cancel).toHaveBeenCalledWith('critical_settings_changed')
    expect(wait).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
    expect(runtime.getState()).toBe('stopped')
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
