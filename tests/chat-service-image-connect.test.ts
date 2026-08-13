import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/private/tmp/weflow-chat-image-test', isPackaged: false },
  BrowserWindow: class {},
  dialog: { showMessageBox: vi.fn() }
}))
vi.mock('../electron/services/config', () => ({ ConfigService: class { getCacheBasePath() { return '/private/tmp/weflow-chat-image-test' } } }))
vi.mock('../electron/services/wcdbService', () => ({ wcdbService: { isReady: () => false } }))
vi.mock('../electron/services/messageCacheService', () => ({ MessageCacheService: class {} }))
vi.mock('../electron/services/contactCacheService', () => ({ ContactCacheService: class { getAllEntries() { return {} } } }))
vi.mock('../electron/services/sessionStatsCacheService', () => ({ SessionStatsCacheService: class {} }))
vi.mock('../electron/services/groupMyMessageCountCacheService', () => ({ GroupMyMessageCountCacheService: class {} }))
vi.mock('../electron/services/voiceTranscribeService', () => ({ voiceTranscribeService: {} }))
vi.mock('../electron/services/imageDecryptService', () => ({ ImageDecryptService: class { decryptImage = vi.fn() } }))

describe('ChatService image fallback connection guard', () => {
  it('returns the safe connection error before message lookup or decrypt work', async () => {
    const source = readFileSync('electron/services/chatService.ts', 'utf8')
    const method = source.slice(source.indexOf('async getImageData('), source.indexOf('\n  /**\n   * getVoiceData', source.indexOf('async getImageData(')))
    expect(method).toContain('const connectResult = await this.connect()')
    expect(method).toContain("if (!connectResult.success) return { success: false, error: connectResult.error || '数据库连接失败' }")
    expect(method.indexOf('if (!connectResult.success)')).toBeLessThan(method.indexOf('this.getMessageByLocalId'))
    expect(method.indexOf('if (!connectResult.success)')).toBeLessThan(method.indexOf('this.imageDecryptService.decryptImage'))

    const { chatService } = await import('../electron/services/chatService')
    const service = chatService as unknown as {
      connected: boolean
      connect: () => Promise<{ success: boolean; error?: string }>
      getMessageByLocalId: (...args: unknown[]) => Promise<unknown>
      imageDecryptService: { decryptImage: (...args: unknown[]) => Promise<unknown> }
      getImageData: (sessionId: string, msgId: string) => Promise<{ success: boolean; error?: string }>
    }
    service.connected = false
    service.connect = vi.fn().mockResolvedValue({ success: false, error: '请先在设置页面配置数据库路径' })
    service.getMessageByLocalId = vi.fn()
    service.imageDecryptService.decryptImage = vi.fn()

    await expect(service.getImageData('session', '1')).resolves.toEqual({
      success: false,
      error: '请先在设置页面配置数据库路径'
    })
    expect(service.getMessageByLocalId).not.toHaveBeenCalled()
    expect(service.imageDecryptService.decryptImage).not.toHaveBeenCalled()
  })
})
