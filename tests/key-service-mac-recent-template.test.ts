import crypto from 'node:crypto'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() }, shell: {} }))

import {
  KeyServiceMac,
  collectRecentV2TemplateCandidates,
  normalizeScannedAesKey,
  scanRecentTemplateCandidates,
  selectImageScanProcessCandidates
} from '../electron/services/keyServiceMac'

const roots: string[] = []
const V2_MAGIC = Buffer.from([0x07, 0x08, 0x56, 0x32, 0x08, 0x07])

const templateDat = (key: string, xorKey: number): Buffer => {
  return templateDatWithKeyBytes(Buffer.from(key, 'ascii'), xorKey)
}

const templateDatWithKeyBytes = (key: Buffer, xorKey: number): Buffer => {
  const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8])
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(false)
  const header = Buffer.alloc(0x0f)
  V2_MAGIC.copy(header)
  header.writeInt32LE(16, 6)
  header.writeInt32LE(0, 10)
  return Buffer.concat([header, cipher.update(plain), cipher.final(), Buffer.from([xorKey ^ 0xff, xorKey ^ 0xd9])])
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('macOS image-key recent template selection', () => {
  it('retains the newest V2 candidates even when traversal encounters the old directory first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weflow-key-template-'))
    roots.push(root)
    const oldDir = join(root, 'a-old')
    const newDir = join(root, 'z-new')
    await mkdir(oldDir); await mkdir(newDir)
    for (let index = 0; index < 6; index += 1) {
      const path = join(oldDir, `${index}_t.dat`)
      await writeFile(path, templateDat('oldoldoldoldold1', 0x33))
      await utimes(path, 100 + index, 100 + index)
    }
    const newest = join(newDir, 'new_t.dat')
    await writeFile(newest, templateDat('newnewnewnewnew1', 0x44))
    await utimes(newest, 999, 999)

    const result = collectRecentV2TemplateCandidates(root, 3)
    expect(result.templates).toHaveLength(3)
    expect(result.templates[0].mtimeMs).toBeGreaterThan(result.templates[1].mtimeMs)
    expect(result.templates[0].ciphertext).toEqual(templateDat('newnewnewnewnew1', 0x44).subarray(0x0f, 0x1f))
    expect(result.xorKey).toBe(0x33)
  })

  it('keeps a hard candidate cap and ignores unreadable shapes and symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weflow-key-template-cap-'))
    roots.push(root)
    for (let index = 0; index < 20; index += 1) {
      await writeFile(join(root, `${index}_t.dat`), templateDat('0123456789abcdef', 0x55))
    }
    await writeFile(join(root, 'not-v2_t.dat'), Buffer.from('not-v2'))
    await expect(collectRecentV2TemplateCandidates(root, 4).templates).toHaveLength(4)
  })

  it('rejects a helper false positive and continues to the next recent template', async () => {
    const newestKey = 'newnewnewnewnew1'
    const olderKey = 'oldoldoldoldold1'
    const candidates = [
      { ciphertext: templateDat(newestKey, 0x44).subarray(0x0f, 0x1f), mtimeMs: 20, xorTail: [0xbb, 0x9d] as [number, number] },
      { ciphertext: templateDat(olderKey, 0x33).subarray(0x0f, 0x1f), mtimeMs: 10, xorTail: [0xcc, 0xea] as [number, number] }
    ]
    const scan = vi.fn().mockResolvedValue(`${olderKey}trailing-garbage`)
    await expect(scanRecentTemplateCandidates(candidates, scan)).resolves.toEqual({ aesKey: olderKey, xorKey: 0x33 })
    expect(scan).toHaveBeenCalledTimes(1)
  })

  it('returns the XOR key from the exact newest template whose AES key verified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weflow-key-template-pair-'))
    roots.push(root)
    const newestKey = 'newnewnewnewnew1'
    for (let index = 0; index < 3; index += 1) {
      const path = join(root, `old-${index}_t.dat`)
      await writeFile(path, templateDat('oldoldoldoldold1', 0x33))
      await utimes(path, 100 + index, 100 + index)
    }
    const newest = join(root, 'new_t.dat')
    await writeFile(newest, templateDat(newestKey, 0x44))
    await utimes(newest, 999, 999)

    const result = collectRecentV2TemplateCandidates(root, 4)
    expect(result.xorKey).toBe(0x33)
    await expect(
      scanRecentTemplateCandidates(result.templates, async () => newestKey, result.xorKey)
    ).resolves.toEqual({ aesKey: newestKey, xorKey: 0x44 })
  })

  it('normalizes only a candidate verified against its exact template', () => {
    const key = '0123456789abcdef'
    const ciphertext = templateDat(key, 0x55).subarray(0x0f, 0x1f)
    expect(normalizeScannedAesKey(`${key}trailing-garbage`, ciphertext)).toBe(key)
    expect(normalizeScannedAesKey('fedcba9876543210trailing-garbage', ciphertext)).toBeNull()
  })

  it('accepts the helper protocol raw 16-byte key encoded as 32 hex characters', () => {
    const rawKey = Buffer.from([0x02, 0x91, 0xfe, 0x44, 0x18, 0xa3, 0x00, 0x7d, 0xb2, 0x61, 0x99, 0x0c, 0xee, 0x53, 0x17, 0x80])
    const ciphertext = templateDatWithKeyBytes(rawKey, 0x55).subarray(0x0f, 0x1f)
    expect(normalizeScannedAesKey(rawKey.toString('hex'), ciphertext)).toBe(rawKey.toString('hex'))
  })

  it('starts the authorization scan at most once for one request even when candidates and time remain', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T00:00:00Z'))
    const root = await mkdtemp(join(tmpdir(), 'weflow-key-template-single-auth-'))
    roots.push(root)
    for (let index = 0; index < 6; index += 1) {
      await writeFile(join(root, `${index}_t.dat`), templateDat('0123456789abcdef', 0x55))
    }
    const service = new KeyServiceMac()
    const findPids = vi.fn().mockResolvedValue([100, 200])
    const authorizeAndScan = vi.fn().mockResolvedValue(null)
    ;(service as any).getImageScanProcessCandidates = findPids
    ;(service as any)._scanMemoryForAesKeyCandidates = authorizeAndScan

    await expect(service.autoGetImageKeyByMemoryScan(root)).resolves.toMatchObject({ success: false })
    expect(authorizeAndScan).toHaveBeenCalledTimes(1)
    expect(findPids).toHaveBeenCalledTimes(1)
  })

  it('stops safely after the administrator prompt is cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weflow-key-template-cancel-'))
    roots.push(root)
    await writeFile(join(root, 'current_t.dat'), templateDat('0123456789abcdef', 0x55))
    const service = new KeyServiceMac()
    const authorizeAndScan = vi.fn().mockRejectedValue(new Error('User canceled'))
    ;(service as any).getImageScanProcessCandidates = vi.fn().mockResolvedValue([100])
    ;(service as any)._scanMemoryForAesKeyCandidates = authorizeAndScan

    await expect(service.autoGetImageKeyByMemoryScan(root)).resolves.toEqual({
      success: false,
      error: '已取消内存扫描，图片密钥未更改'
    })
    expect(authorizeAndScan).toHaveBeenCalledTimes(1)
  })

  it('selects a bounded strict main-first set including AppEx renderers but excluding helpers', () => {
    const lines = [
      '25505 /Applications/WeChat.app/Contents/MacOS/WeChat /Applications/WeChat.app/Contents/MacOS/WeChat',
      '25531 /Applications/WeChat.app/Contents/Frameworks/WeChatAppEx.app/Contents/MacOS/WeChatAppEx /Applications/WeChat.app/Contents/Frameworks/WeChatAppEx.app/Contents/MacOS/WeChatAppEx',
      '61006 /Applications/WeChat.app/Contents/Frameworks/WeChatAppEx Framework.framework/Versions/A/Helpers/WeChatAppEx Helper (Renderer).app/Contents/MacOS/WeChatAppEx Helper (Renderer) --type=renderer',
      '61005 /Applications/WeChat.app/Contents/Frameworks/WeChatAppEx Framework.framework/Versions/A/Helpers/WeChatAppEx Helper (Renderer).app/Contents/MacOS/WeChatAppEx Helper (Renderer) --type=renderer',
      '61004 /Applications/WeChat.app/Contents/Frameworks/WeChatAppEx Framework.framework/Versions/A/Helpers/WeChatAppEx Helper (GPU).app/Contents/MacOS/WeChatAppEx Helper (GPU) --type=gpu-process',
      '61003 /Applications/WeChat.app/Contents/Frameworks/WeChatAppEx Framework.framework/Versions/A/Helpers/WeChatAppEx Helper.app/Contents/MacOS/WeChatAppEx Helper --type=utility',
      '99999 /Applications/WeChat.app/Contents/Frameworks/WeChatAppEx.app/Contents/Helpers/crashpad_handler crashpad_handler',
      '88888 /private/tmp/image_scan_helper image_scan_helper',
      '77777 /Applications/Other.app/Contents/MacOS/WeChat WeChat'
    ]
    expect(selectImageScanProcessCandidates(lines.join('\n'), 3)).toEqual([25505, 61006, 61005])
  })

  it('scans the fixed main and renderer candidates in one helper authorization and accepts a renderer match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weflow-key-template-renderer-'))
    roots.push(root)
    const key = '0123456789abcdef'
    await writeFile(join(root, 'current_t.dat'), templateDat(key, 0x55))
    const service = new KeyServiceMac()
    const scanOnce = vi.fn().mockResolvedValue(key)
    ;(service as any).getImageScanProcessCandidates = vi.fn().mockResolvedValue([100, 200, 300])
    ;(service as any)._scanMemoryForAesKeyCandidates = scanOnce

    await expect(service.autoGetImageKeyByMemoryScan(root)).resolves.toEqual({
      success: true,
      aesKey: key,
      xorKey: 0x55
    })
    expect(scanOnce).toHaveBeenCalledTimes(1)
    expect(scanOnce).toHaveBeenCalledWith([100, 200, 300], expect.any(Buffer), undefined)
  })

  it('finishes progress on miss without writing a key or starting another authorization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weflow-key-template-final-status-'))
    roots.push(root)
    await writeFile(join(root, 'current_t.dat'), templateDat('0123456789abcdef', 0x55))
    const service = new KeyServiceMac()
    const statuses: string[] = []
    const scanOnce = vi.fn().mockResolvedValue(null)
    ;(service as any).getImageScanProcessCandidates = vi.fn().mockResolvedValue([100, 200])
    ;(service as any)._scanMemoryForAesKeyCandidates = scanOnce

    const result = await service.autoGetImageKeyByMemoryScan(root, (status) => statuses.push(status))
    expect(result.success).toBe(false)
    expect(result).not.toHaveProperty('aesKey')
    expect(scanOnce).toHaveBeenCalledTimes(1)
    expect(statuses.at(-1)).toBe(result.error)
  })
})
