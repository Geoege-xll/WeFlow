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
})
