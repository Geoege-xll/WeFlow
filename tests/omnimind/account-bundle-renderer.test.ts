// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { AccountConfigBundle } from '../../shared/omnimind/account-bundle'
import { patchAccountBundle, setDbPath, setDecryptKey } from '../../src/services/config'

describe('renderer account bundle writes', () => {
  let stored: AccountConfigBundle

  beforeEach(() => {
    stored = {
      myWxid: 'account-a',
      dbPath: '/old-db',
      decryptKey: 'old-key',
      imageXorKey: 1,
      imageAesKey: 'old-aes',
      cachePath: '/cache',
      lastOpenedDb: '/old-db'
    }
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { config: {
        get: async (key: keyof AccountConfigBundle) => stored[key],
        setAccountBundle: async (bundle: AccountConfigBundle) => { stored = { ...bundle } },
        patchAccountBundle: async ({ expectedAccountId: _expectedAccountId, ...patch }: Partial<AccountConfigBundle> & { expectedAccountId?: string }) => { stored = { ...stored, ...patch } }
      } }
    })
  })

  it('does not lose one field when independent identity edits build bundles concurrently', async () => {
    await Promise.all([
      setDbPath('/new-db'),
      setDecryptKey('new-key')
    ])

    expect(stored.dbPath).toBe('/new-db')
    expect(stored.decryptKey).toBe('new-key')
  })

  it('carries expected account identity as a guard without writing it into the bundle', async () => {
    await patchAccountBundle({ decryptKey: 'guarded' }, 'account-a')
    expect(stored).toEqual(expect.objectContaining({ myWxid: 'account-a', decryptKey: 'guarded' }))
    expect(stored).not.toHaveProperty('expectedAccountId')
  })
})
