import { describe, expect, it, vi } from 'vitest'
import { AccountSwitchCoordinator } from '../../electron/omnimind/account-switch-coordinator'

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }

describe('account switch orchestration', () => {
  it('stops ingress before waiting for an active send and serializes the new identity baseline', async () => {
    const sending = deferred()
    let ingressActive = true
    const order: string[] = []
    const autoAdapter = vi.fn()
    const coordinator = new AccountSwitchCoordinator({
      stopIngress: () => { ingressActive = false; order.push('stop-ingress') },
      cancelAndWait: async () => { order.push('wait-sending'); await sending.promise },
      resetAndRefresh: async () => { order.push('new-baseline') },
      setIdentity: async (accountId) => { order.push(`identity:${accountId}`) },
      fail: vi.fn()
    })
    const switching = coordinator.switch('new-account', () => { order.push('commit-config'); return 'saved' })
    await vi.waitFor(() => expect(ingressActive).toBe(false))
    if (ingressActive) autoAdapter('new-ingress')
    expect(autoAdapter).not.toHaveBeenCalled()
    sending.resolve()
    await expect(switching).resolves.toBe('saved')
    expect(order).toEqual(['stop-ingress', 'wait-sending', 'commit-config', 'new-baseline', 'identity:new-account'])
  })

  it('rechecks same-bundle no-op inside the serialized switch boundary', async () => {
    let current = false
    const stopIngress = vi.fn()
    const coordinator = new AccountSwitchCoordinator({
      stopIngress,
      cancelAndWait: vi.fn(async () => undefined),
      resetAndRefresh: vi.fn(async () => undefined),
      setIdentity: vi.fn(async () => undefined),
      fail: vi.fn()
    })
    const first = coordinator.switch('a', () => { current = true })
    const duplicate = coordinator.switch('a', vi.fn(), () => current)
    await Promise.all([first, duplicate])
    expect(stopIngress).toHaveBeenCalledTimes(1)
  })

  it('holds cleanup behind stop and sender idle before awaiting file work', async () => {
    const cleanupGate = deferred()
    const order: string[] = []
    const coordinator = new AccountSwitchCoordinator({
      stopIngress: () => { order.push('stop') },
      cancelAndWait: async () => { order.push('idle') },
      resetAndRefresh: async () => { order.push('reset') },
      setIdentity: () => { order.push('identity') }, fail: vi.fn()
    })
    const clearing = coordinator.switch('', async () => { order.push('cleanup'); await cleanupGate.promise; order.push('commit') })
    await vi.waitFor(() => expect(order).toEqual(['stop', 'idle', 'cleanup']))
    cleanupGate.resolve()
    await clearing
    expect(order).toEqual(['stop', 'idle', 'cleanup', 'commit', 'reset', 'identity'])
  })

  it('serializes resolved patches so different fields merge and the same field is last-write-wins', async () => {
    const coordinator = new AccountSwitchCoordinator({ stopIngress: vi.fn(), cancelAndWait: vi.fn(async () => undefined), resetAndRefresh: vi.fn(async () => undefined), setIdentity: vi.fn(), fail: vi.fn() })
    const state = { dbPath: 'old', decryptKey: 'old' }
    const patch = (next: Partial<typeof state>) => coordinator.switchResolved(() => ({ accountId: 'a', commit: () => Object.assign(state, next) }))
    await Promise.all([patch({ dbPath: 'db-1' }), patch({ decryptKey: 'key-1' }), patch({ dbPath: 'db-2' })])
    expect(state).toEqual({ dbPath: 'db-2', decryptKey: 'key-1' })
  })

  it('preserves invocation order for patch then full and full then patch around sender idle', async () => {
    const idle = deferred()
    let waits = 0
    const coordinator = new AccountSwitchCoordinator({ stopIngress: vi.fn(), cancelAndWait: async () => { if (waits++ === 0) await idle.promise }, resetAndRefresh: vi.fn(async () => undefined), setIdentity: vi.fn(), fail: vi.fn() })
    let state = { accountId: 'old', key: 'old' }
    const patchFirst = coordinator.switchResolved(() => ({ accountId: state.accountId, commit: () => { state = { ...state, key: 'patch' } } }))
    const fullSecond = coordinator.switch('account-a', () => { state = { accountId: 'account-a', key: 'full-a' } })
    idle.resolve(); await Promise.all([patchFirst, fullSecond])
    expect(state).toEqual({ accountId: 'account-a', key: 'full-a' })

    const fullFirst = coordinator.switch('account-b', () => { state = { accountId: 'account-b', key: 'full-b' } })
    const patchSecond = coordinator.switchResolved(() => ({ accountId: state.accountId, commit: () => { state = { ...state, key: 'patch-b' } } }))
    await Promise.all([fullFirst, patchSecond])
    expect(state).toEqual({ accountId: 'account-b', key: 'patch-b' })
  })
})
