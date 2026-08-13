import crypto from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../electron/services/config', () => ({ ConfigService: class {} }))
vi.mock('../electron/services/wcdbService', () => ({ wcdbService: {} }))

import { ImageDecryptService } from '../electron/services/imageDecryptService'

const V1_FIXED_KEY = 'cfcd208495d565ef'
const V2_TEST_KEY = '0123456789abcdef'
const PNG_PAYLOAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x48, 0x44, 0x52])
const directories: string[] = []

const buildAesDat = (version: 1 | 2, key: string | Buffer): Buffer => {
  const header = Buffer.alloc(0x0f)
  Buffer.from(version === 1 ? [0x07, 0x08, 0x56, 0x31, 0x08, 0x07] : [0x07, 0x08, 0x56, 0x32, 0x08, 0x07]).copy(header)
  header.writeInt32LE(PNG_PAYLOAD.length, 6)
  header.writeInt32LE(0, 10)
  const keyBytes = Buffer.isBuffer(key) ? key : Buffer.from(key, 'ascii')
  const cipher = crypto.createCipheriv('aes-128-ecb', keyBytes, null)
  return Buffer.concat([header, cipher.update(PNG_PAYLOAD), cipher.final()])
}

const buildXorDat = (xorKey: number): Buffer => Buffer.from(PNG_PAYLOAD.map((byte) => byte ^ xorKey))

const decryptFixture = async (fixture: Buffer, xorKey: number, configuredAesKey?: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'weflow-image-dat-version-'))
  directories.push(directory)
  const datPath = join(directory, 'fixture.dat')
  await writeFile(datPath, fixture)
  const service = new ImageDecryptService()
  return (service as unknown as {
    tryDecryptDatWithJs: (path: string, xor: number, aes?: string) => Promise<{ data: Buffer; ext: string } | null>
  }).tryDecryptDatWithJs(datPath, xorKey, configuredAesKey)
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('JavaScript DAT fallback version contract', () => {
  it('decrypts V1 with the legacy fixed ASCII AES key without any configured user key', async () => {
    const result = await decryptFixture(buildAesDat(1, V1_FIXED_KEY), 0x5a)
    expect(result?.ext).toBe('.png')
    expect(result?.data).toEqual(PNG_PAYLOAD)
  })

  it('decrypts V2 with only the configured AES key', async () => {
    const fixture = buildAesDat(2, V2_TEST_KEY)
    await expect(decryptFixture(fixture, 0x5a, V2_TEST_KEY)).resolves.toMatchObject({ ext: '.png' })
    await expect(decryptFixture(fixture, 0x5a, 'fedcba9876543210')).resolves.toBeNull()
  })

  it('decrypts V2 when the memory helper returns a raw 16-byte key as 32 hex characters', async () => {
    const rawKey = Buffer.from([0x02, 0x91, 0xfe, 0x44, 0x18, 0xa3, 0x00, 0x7d, 0xb2, 0x61, 0x99, 0x0c, 0xee, 0x53, 0x17, 0x80])
    const fixture = buildAesDat(2, rawKey)
    await expect(decryptFixture(fixture, 0x5a, rawKey.toString('hex'))).resolves.toMatchObject({ ext: '.png' })
  })

  it('keeps V0 on the XOR-only path', async () => {
    const result = await decryptFixture(buildXorDat(0x5a), 0x5a, V2_TEST_KEY)
    expect(result?.ext).toBe('.png')
    expect(result?.data).toEqual(PNG_PAYLOAD)
  })
})
