import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  resolveChatImageFailure,
  type ChatImageFailureInput
} from '../src/pages/Chat/chatImageFailureViewModel'

describe('ordinary chat image failure recovery', () => {
  it('keeps a known primary configuration cause when the fallback cannot find the message', () => {
    expect(resolveChatImageFailure({
      primary: { error: '未配置账号或数据库路径', failureKind: 'not_found' },
      fallbackError: '未找到消息'
    })).toEqual({ reason: '未配置账号或数据库路径', failureKind: 'not_found' })
    expect(resolveChatImageFailure({
      primary: { error: '未配置账号或数据库路径', failureKind: 'not_found' },
      caughtError: 'Error: fallback exploded at /Users/private/main.js:2'
    }).reason).toBe('未配置账号或数据库路径')
  })

  it.each<[ChatImageFailureInput, string]>([
    [{ fallbackError: '未找到账号目录' }, '未找到账号目录，请检查数据库路径和账号配置'],
    [{ fallbackError: '未找到图片文件，请在微信中点开该图片后重试' }, '未找到图片文件，请在微信中点开后重试'],
    [{ fallbackError: '图片缺少 md5/datName，无法定位原文件' }, '图片标识缺失，无法定位原文件'],
    [{ fallbackError: '未配置图片解密密钥' }, '未配置图片解密密钥'],
    [{ fallbackError: 'Rust原生解密不可用或解密失败，请检查 native 模块与密钥配置' }, '原生图片解密不可用，请检查组件与密钥配置'],
    [{ fallbackError: '路径无效' }, '图片内容或缓存路径无效'],
    [{ rendererLoadError: true }, '图片已解密，但渲染加载失败']
  ])('maps known causes to a stable safe explanation', (input, reason) => {
    expect(resolveChatImageFailure(input).reason).toBe(reason)
  })

  it('never exposes raw paths, stack traces, or arbitrary exception strings', () => {
    for (const unsafe of [
      'ENOENT: /Users/private/secret/image.dat',
      'Error: boom\n    at decrypt (/app/main.js:10:2)',
      'token=super-secret unexpected native panic'
    ]) {
      const result = resolveChatImageFailure({ primary: { error: unsafe }, fallbackError: unsafe, caughtError: unsafe })
      expect(result.reason).toBe('图片解密失败，请重试或检查图片配置')
      expect(result.reason).not.toContain('/Users')
      expect(result.reason).not.toContain('super-secret')
      expect(result.reason).not.toContain('at decrypt')
    }
  })

  it('wires renderer load failures through the stable reason and clears all failure state on load', () => {
    const source = readFileSync('src/pages/ChatPage.tsx', 'utf8')
    expect(source).toContain("resolveChatImageFailure({ rendererLoadError: true })")
    expect(source).toMatch(/onLoad=\{\(\) => \{[^}]*setImageError\(false\)[^}]*setImageErrorReason\(undefined\)[^}]*setImageFailureKind\(undefined\)/s)
  })
})

describe('latest account bundle selection', () => {
  it('awaits the authoritative latest db path before atomically applying an account bundle', async () => {
    const pendingPath = Promise.withResolvers<string | null>()
    const setAccountBundle = vi.fn()
    const config = {
      getDbPath: vi.fn(() => pendingPath.promise),
      getCachePath: vi.fn().mockResolvedValue('/latest-cache'),
      setAccountBundle
    }
    const { applyLatestWxidConfig } = await import('../src/pages/AccountManagementPage')
    const applying = applyLatestWxidConfig(config, 'wxid_next', { decryptKey: 'key', imageXorKey: 7, imageAesKey: 'aes' })
    expect(setAccountBundle).not.toHaveBeenCalled()
    pendingPath.resolve('/latest-db')
    await applying
    expect(setAccountBundle).toHaveBeenCalledWith(expect.objectContaining({
      myWxid: 'wxid_next', dbPath: '/latest-db', lastOpenedDb: '/latest-db', cachePath: '/latest-cache'
    }))
  })
})
