import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionTextBatcher } from '../../electron/omnimind/session-text-batcher'

describe('SessionTextBatcher', () => {
  afterEach(() => vi.useRealTimers())

  it('batches same-session inbound text for two seconds', async () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new SessionTextBatcher(2000, async (batch) => { flushed.push(batch.messages.map((message) => message.text)) })
    batcher.accept({ accountId: 'a', sessionId: 's', messageKey: '1', direction: 'inbound', text: 'one', timestamp: 1, sessionType: 'private' })
    await vi.advanceTimersByTimeAsync(1000)
    batcher.accept({ accountId: 'a', sessionId: 's', messageKey: '2', direction: 'inbound', text: 'two', timestamp: 2, sessionType: 'private' })
    await vi.advanceTimersByTimeAsync(1999)
    expect(flushed).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(flushed).toEqual([['one', 'two']])
  })

  it('creates a later batch when generation has already started', async () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = new SessionTextBatcher(2000, async (batch) => { flushed.push(batch.messages.map((message) => message.text)) })
    batcher.accept({ accountId: 'a', sessionId: 's', messageKey: '1', direction: 'inbound', text: 'one', timestamp: 1, sessionType: 'private' })
    await vi.advanceTimersByTimeAsync(2000)
    batcher.accept({ accountId: 'a', sessionId: 's', messageKey: '2', direction: 'inbound', text: 'two', timestamp: 2, sessionType: 'private' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(flushed).toEqual([['one'], ['two']])
  })

  it('按时间稳定排序并完整保留每条消息的群聊发送者身份', async () => {
    vi.useFakeTimers()
    const flushed: Array<Array<{ key: string; sender?: string; timestamp: number }>> = []
    const batcher = new SessionTextBatcher(100, async (batch) => {
      flushed.push(batch.messages.map((message) => ({ key: message.messageKey, sender: message.senderExternalId, timestamp: message.timestamp })))
    })
    batcher.accept({
      accountId: 'a', sessionId: 'room@chatroom', messageKey: 'later', direction: 'inbound', text: 'later', timestamp: 20,
      sessionType: 'group', messageType: 1, contentType: 'text', senderExternalId: 'wxid-bob', senderDisplayName: 'Bob'
    })
    batcher.accept({
      accountId: 'a', sessionId: 'room@chatroom', messageKey: 'earlier', direction: 'inbound', text: 'earlier', timestamp: 10,
      sessionType: 'group', messageType: 1, contentType: 'text', senderExternalId: 'wxid-alice', senderDisplayName: 'Alice'
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(flushed).toEqual([[
      { key: 'earlier', sender: 'wxid-alice', timestamp: 10 },
      { key: 'later', sender: 'wxid-bob', timestamp: 20 }
    ]])
  })
})
