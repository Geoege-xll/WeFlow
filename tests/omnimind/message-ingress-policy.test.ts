import { describe, expect, it } from 'vitest'
import { bootstrapWatermark, failedFetchResult, nextInspectedWatermark } from '../../electron/omnimind/message-ingress-policy'

describe('message ingress watermark policy', () => {
  it('uses current session timestamps as baseline so initial history is not replayed', () => {
    expect(bootstrapWatermark(120, 999)).toBe(120)
    expect(bootstrapWatermark(0, 999)).toBe(999)
  })

  it('does not advance the watermark when fetching messages fails', () => {
    const failed = failedFetchResult(120, 1)
    expect(failed.retry).toBe(true)
    expect(nextInspectedWatermark(120, 200, failed.maxFetchedTimestamp, failed.retry)).toBe(120)
  })

  it('advances only after a successful fetch', () => {
    expect(nextInspectedWatermark(120, 150, 160, false)).toBe(160)
  })
})
