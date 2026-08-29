import { describe, expect, it, vi } from 'vitest'
import { PersistentDeliveryJournal } from '../../electron/omnimind/persistent-delivery-journal'

const sessionReference = '33333333-3333-3333-3333-333333333333'
const routeReference = '44444444-4444-4444-4444-444444444444'

describe('Persistent Delivery Journal', () => {
  it('加密保存认领意图与租约状态，原子重载后仍能恢复 claimed', async () => {
    let disk: string | undefined
    const writes: string[] = []
    const dependencies = {
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value: string) => Buffer.from(`cipher:${Buffer.from(value).toString('base64')}`),
        decryptString: (value: Buffer) => Buffer.from(value.toString().replace(/^cipher:/, ''), 'base64').toString()
      },
      read: async () => disk,
      writeAtomic: async (value: string) => { writes.push(value); disk = value }
    }
    const journal = new PersistentDeliveryJournal(dependencies)
    await journal.recordRoute(sessionReference, 'wx-account-private', 'wx-session-private')
    const route = (await journal.getRoute(sessionReference, 'wx-account-private'))!
    const delivery = {
      deliveryId: 'delivery-id', fulfillmentId: 'fulfillment-id', attemptNumber: 1,
      sessionReference, routeReference, content: '审核后的客户正文', status: 'queued'
    } as const
    await journal.recordClaimIntent(delivery, route, 'stable-private-owner')
    await journal.recordClaimed('delivery-id', {
      deliveryId: 'delivery-id', leaseToken: 'private-lease',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), fencingToken: 1
    })

    expect(writes).toHaveLength(3)
    expect(disk).not.toContain('wx-account-private')
    expect(disk).not.toContain('wx-session-private')
    expect(disk).not.toContain('审核后的客户正文')
    expect(disk).not.toContain('private-lease')
    expect(disk).not.toContain('stable-private-owner')

    const reloaded = new PersistentDeliveryJournal(dependencies)
    expect(await reloaded.getDelivery('delivery-id')).toMatchObject({ state: 'claimed', accountId: 'wx-account-private' })
  })

  it('claimed 原子写失败时使用 copy-on-write 保留磁盘与内存中的 claim_pending', async () => {
    let disk: string | undefined
    let rejectClaimed = false
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`cipher:${Buffer.from(value).toString('base64')}`),
      decryptString: (value: Buffer) => Buffer.from(value.toString().replace(/^cipher:/, ''), 'base64').toString()
    }
    const dependencies = {
      safeStorage,
      read: async () => disk,
      writeAtomic: async (value: string) => {
        const envelope = JSON.parse(value) as { ciphertext: string }
        const state = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'))) as {
          deliveries: Record<string, { state: string }>
        }
        if (rejectClaimed && Object.values(state.deliveries).some((entry) => entry.state === 'claimed')) {
          throw new Error('injected_atomic_write_failure')
        }
        disk = value
      }
    }
    const journal = new PersistentDeliveryJournal(dependencies)
    await journal.recordRoute(sessionReference, 'wx-account', 'wx-session')
    const route = (await journal.getRoute(sessionReference, 'wx-account'))!
    await journal.recordClaimIntent({
      deliveryId: 'delivery-id', fulfillmentId: 'fulfillment-id', attemptNumber: 1,
      sessionReference, routeReference, content: '审核正文', status: 'queued'
    }, route, 'stable-owner')
    rejectClaimed = true

    await expect(journal.recordClaimed('delivery-id', {
      deliveryId: 'delivery-id', leaseToken: 'private-lease',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), fencingToken: 1
    })).rejects.toThrow('injected_atomic_write_failure')
    expect((await journal.getDelivery('delivery-id'))?.state).toBe('claim_pending')

    const reloaded = new PersistentDeliveryJournal(dependencies)
    expect(await reloaded.getDelivery('delivery-id')).toMatchObject({
      state: 'claim_pending',
      leaseOwner: 'stable-owner'
    })
  })

  it('损坏或明文 journal 会被隔离并 fail closed，不把旧内容当作待发送任务', async () => {
    let disk = JSON.stringify({ schemaVersion: 1, ciphertext: 'not-decryptable' })
    const quarantine = vi.fn(async () => { disk = '' })
    const journal = new PersistentDeliveryJournal({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: () => { throw new Error('decrypt failed with private details') }
      },
      read: async () => disk,
      writeAtomic: async (value) => { disk = value },
      quarantine
    })
    expect(await journal.listRecoverable('wx-account')).toEqual([])
    expect(quarantine).toHaveBeenCalledTimes(1)
  })

  it('安全存储不可用时拒绝读写，不回退到明文文件', async () => {
    const writeAtomic = vi.fn()
    const journal = new PersistentDeliveryJournal({
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString()
      },
      read: async () => undefined,
      writeAtomic
    })
    await expect(journal.recordRoute(sessionReference, 'wx-account', 'wx-session')).rejects.toThrow('delivery_secure_storage_unavailable')
    expect(writeAtomic).not.toHaveBeenCalled()
  })
})
