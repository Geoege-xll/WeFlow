import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('image key apply and retry contract', () => {
  it('atomically applies successful keys in main, invalidates caches, and emits no key material', async () => {
    const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
    expect(source).toContain('setImageKeysForCurrentWxid(result.xorKey, result.aesKey)')
    expect(source).toContain('imageDecryptService.invalidateRuntimeCaches()')
    expect(source).toContain("window.webContents.send('image:keysChanged', { reason: 'updated' })")
    expect(source).not.toMatch(/image:keysChanged[^\n]+(?:aesKey|xorKey|wxid)/)
  })

  it('uses trusted config paths and rejects renderer-supplied image-key scan arguments', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
    expect(main).toContain("assertNoImageKeyRequestArguments('key:autoGetImageKey', args)")
    expect(main).toContain("assertNoImageKeyRequestArguments('key:scanImageKeyFromMemory', args)")
    expect(main).toContain("const trustedDbPath = String(configService!.get('dbPath') || '').trim()")
    expect(main).toContain("const trustedWxid = String(configService!.get('myWxid') || '').trim()")
    expect(preload).toContain("autoGetImageKey: () => ipcRenderer.invoke('key:autoGetImageKey')")
    expect(preload).toContain("scanImageKeyFromMemory: () => ipcRenderer.invoke('key:scanImageKeyFromMemory')")
    expect(preload).not.toContain("scanImageKeyFromMemory: (userDir")
  })

  it('routes both generic account write IPC handlers through strict bundle parsers', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
    expect(main).toMatch(/ipcMain\.handle\('account:setBundle'[\s\S]*?parseAccountConfigBundle\(payload\)/)
    expect(main).toMatch(/ipcMain\.handle\('account:patchBundle'[\s\S]*?parseAccountConfigPatch\(payload\)/)
  })

  it('keeps current-account keys ahead of global fallback', async () => {
    const source = await readFile(new URL('../electron/services/config.ts', import.meta.url), 'utf8')
    expect(source).toContain('cfg.imageXorKey ?? this.get(\'imageXorKey\')')
    expect(source).toContain('cfg.imageAesKey ?? this.get(\'imageAesKey\')')
    expect(source).toContain('setImageKeysForCurrentWxid')
  })

  it('retries only failed visible chat images once after a key change', async () => {
    const source = await readFile(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
    expect(source).toContain('if (!isImage || !imageError || !imageInView) return')
    expect(source).toContain('imageKeysRetryGenerationRef.current >= 1')
    expect(source).toContain('void requestImageDecrypt(true)')
  })

  it('does not leave Settings or Welcome stuck on the scanning status after failure', async () => {
    for (const page of ['SettingsPage.tsx', 'WelcomePage.tsx']) {
      const source = await readFile(new URL(`../src/pages/${page}`, import.meta.url), 'utf8')
      expect(source).toContain("setImageKeyStatus(result.error || '内存扫描获取图片密钥失败')")
      expect(source).toContain('setImageKeyStatus(`内存扫描失败: ${e}`)')
    }
  })

  it('does not log raw chat or image identifiers from the image click path', async () => {
    const source = await readFile(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain("console.info('[UI] image decrypt click")
    expect(source).not.toMatch(/console\.(?:log|info|debug)\([^\n]*(?:sessionId|imageMd5|imageDatName|localId)/)
  })
})
