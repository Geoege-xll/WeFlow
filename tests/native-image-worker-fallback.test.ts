import { describe, expect, it, vi } from 'vitest'
import { resolveNativeWorkerAttempt } from '../electron/services/nativeImageDecrypt'

const nativeResult = (label: string) => ({
  data: Buffer.from(label),
  ext: '.jpg',
  isWxgf: false,
  meta: {}
})

describe('native image worker direct fallback contract', () => {
  it.each([
    ['worker returned null', async () => null],
    ['worker returned ok:false', async () => null],
    ['worker disappeared', async () => { throw new Error('worker gone') }]
  ])('calls direct native exactly once when %s', async (_label, workerAttempt) => {
    const directAttempt = vi.fn(() => nativeResult('direct'))
    await expect(resolveNativeWorkerAttempt(workerAttempt, directAttempt)).resolves.toEqual(nativeResult('direct'))
    expect(directAttempt).toHaveBeenCalledTimes(1)
  })

  it('does not call direct native when the worker succeeds', async () => {
    const directAttempt = vi.fn(() => nativeResult('direct'))
    await expect(resolveNativeWorkerAttempt(async () => nativeResult('worker'), directAttempt)).resolves.toEqual(nativeResult('worker'))
    expect(directAttempt).not.toHaveBeenCalled()
  })

  it('returns null when the single direct native fallback also fails', async () => {
    const directAttempt = vi.fn(() => null)
    await expect(resolveNativeWorkerAttempt(async () => null, directAttempt)).resolves.toBeNull()
    expect(directAttempt).toHaveBeenCalledTimes(1)
  })

  it('shares one worker attempt and one direct fallback without retry loops', async () => {
    const workerAttempt = vi.fn(async () => null)
    const directAttempt = vi.fn(() => null)
    await resolveNativeWorkerAttempt(workerAttempt, directAttempt)
    expect(workerAttempt).toHaveBeenCalledTimes(1)
    expect(directAttempt).toHaveBeenCalledTimes(1)
  })
})
