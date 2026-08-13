import { describe, expect, it, vi } from 'vitest'
import { assertNoImageKeyRequestArguments, ConfigService } from '../../electron/services/config'

describe('ConfigService atomic account store', () => {
  it('rejects legacy paths, unknown objects, and extra positional arguments for image-key IPC', () => {
    expect(() => assertNoImageKeyRequestArguments('key:autoGetImageKey', [])).not.toThrow()
    expect(() => assertNoImageKeyRequestArguments('key:autoGetImageKey', ['/tmp/untrusted'])).toThrow()
    expect(() => assertNoImageKeyRequestArguments('key:scanImageKeyFromMemory', [{ userDir: '/tmp/untrusted' }])).toThrow()
    expect(() => assertNoImageKeyRequestArguments('key:scanImageKeyFromMemory', [undefined])).toThrow()
  })
  it('keeps lock-mode getters on the old bundle when the atomic store write throws', () => {
    const service = Object.create(ConfigService.prototype) as ConfigService & Record<string, unknown>
    const old = { myWxid: 'old', dbPath: '/old', decryptKey: 'old-key', imageXorKey: 3, imageAesKey: 'old-aes', cachePath: '/cache', lastOpenedDb: '/old' }
    const raw = new Map<string, unknown>(Object.entries({ ...old, decryptKey: 'lock:old', imageXorKey: 'lock:old', imageAesKey: 'lock:old' }))
    service.store = { get: (key: string) => raw.get(key), set: vi.fn(() => { throw new Error('disk_full') }) }
    service.unlockPassword = 'password'
    service.unlockedKeys = new Map([['decryptKey', old.decryptKey], ['imageXorKey', old.imageXorKey], ['imageAesKey', old.imageAesKey]])

    expect(() => service.setAccountBundle({ ...old, decryptKey: 'secret-new' })).toThrow('disk_full')
    expect(service.getAccountBundle()).toEqual(old)
    expect(JSON.stringify([...service.unlockedKeys as Map<string, unknown>])).not.toContain('secret-new')
  })

  it('updates the global bundle and current wxid image keys through one service action', () => {
    const service = Object.create(ConfigService.prototype) as ConfigService & Record<string, any>
    const bundle = { myWxid: 'wxid_current', dbPath: '/db', decryptKey: 'db-key', imageXorKey: 1, imageAesKey: 'oldoldoldoldold1', cachePath: '/cache', lastOpenedDb: '/db' }
    const wxidConfigs = { wxid_current: { decryptKey: 'db-key', imageXorKey: 1, imageAesKey: 'oldoldoldoldold1' } }
    service.get = vi.fn((key: string) => key === 'myWxid' ? bundle.myWxid : key === 'wxidConfigs' ? wxidConfigs : undefined)
    service.getAccountBundle = vi.fn(() => bundle)
    service.isLockMode = vi.fn(() => false)
    service.safeEncrypt = vi.fn((value: string) => `safe:${value}`)
    service.encryptWxidConfigs = vi.fn((value: unknown) => value)
    service.store = { set: vi.fn() }

    service.setImageKeysForCurrentWxid(0x44, '0123456789abcdef')

    expect(service.store.set).toHaveBeenCalledTimes(1)
    expect(service.store.set).toHaveBeenCalledWith(expect.objectContaining({
      imageXorKey: 'safe:68',
      imageAesKey: 'safe:0123456789abcdef',
      wxidConfigs: expect.objectContaining({
        wxid_current: expect.objectContaining({ imageXorKey: 0x44, imageAesKey: '0123456789abcdef' })
      })
    }))
  })

  it('keeps both global and current-wxid image keys unchanged when the single persistence write fails', () => {
    const service = Object.create(ConfigService.prototype) as ConfigService & Record<string, any>
    const old = { myWxid: 'wxid_current', dbPath: '/db', decryptKey: 'db-key', imageXorKey: 1, imageAesKey: 'oldoldoldoldold1', cachePath: '/cache', lastOpenedDb: '/db' }
    const oldWxidConfigs = { wxid_current: { decryptKey: 'db-key', imageXorKey: 1, imageAesKey: 'oldoldoldoldold1' } }
    service.get = vi.fn((key: string) => key === 'myWxid' ? old.myWxid : key === 'wxidConfigs' ? oldWxidConfigs : undefined)
    service.getAccountBundle = vi.fn(() => old)
    service.isLockMode = vi.fn(() => false)
    service.safeEncrypt = vi.fn((value: string) => `safe:${value}`)
    service.encryptWxidConfigs = vi.fn((value: unknown) => value)
    service.unlockedKeys = new Map([['imageXorKey', old.imageXorKey], ['imageAesKey', old.imageAesKey]])
    service.store = { set: vi.fn(() => { throw new Error('disk_full') }) }

    expect(() => service.setImageKeysForCurrentWxid(0x44, '0123456789abcdef')).toThrow('disk_full')
    expect(service.store.set).toHaveBeenCalledTimes(1)
    expect(service.unlockedKeys).toEqual(new Map([['imageXorKey', 1], ['imageAesKey', 'oldoldoldoldold1']]))
  })
})
