import { describe, expect, it, vi } from 'vitest'
import { GlobalAiQueue } from '../../electron/omnimind/global-ai-queue'
import { PrioritySendMutex, UnifiedSender } from '../../electron/omnimind/unified-sender'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('global AI queue and unified sender', () => {
  it('releases the generation slot while preserving replies awaiting manual send', async () => {
    const send = vi.fn(async () => ({ success: true }))
    const generated: string[] = []
    const queue = new GlobalAiQueue({
      autoSend: () => false,
      generate: vi.fn(async (task) => { generated.push(task.sessionId); return { kind: 'reply', text: `reply-${task.sessionId}` } }),
      send
    })
    const first = queue.enqueue({ accountId: 'a', sessionId: 's1', sessionName: 'one', messageKeys: ['m1'], text: 'one' })
    queue.enqueue({ accountId: 'a', sessionId: 's2', sessionName: 'two', messageKeys: ['m2'], text: 'two' })
    await queue.whenIdle()
    expect(generated).toEqual(['s1', 's2'])
    expect(send).not.toHaveBeenCalled()
    expect(queue.getSnapshot().awaitingManualSend).toHaveLength(2)
    expect(queue.findTask(first.id)).toMatchObject({ status: 'awaiting_manual_send', replyText: 'reply-s1' })
  })

  it('requires stale confirmation, then sends through the same queue sender and supports idempotent abandon', async () => {
    const send = vi.fn(async () => ({ success: true }))
    const queue = new GlobalAiQueue({ autoSend: () => false, generate: async () => ({ kind: 'reply', text: 'reply' }), send })
    const task = queue.enqueue({ accountId: 'a', sessionId: 's', sessionName: 'one', messageKeys: ['m1'], text: 'one' })
    await queue.whenIdle()
    queue.noteIncomingMessage('a', 's')
    await expect(queue.sendGeneratedReply(task.id)).resolves.toEqual({ success: false, error: 'stale_reply_confirmation_required' })
    await expect(queue.sendGeneratedReply(task.id)).resolves.toMatchObject({ success: true })
    await expect(queue.sendGeneratedReply(task.id)).resolves.toEqual({ success: false, error: 'task_not_awaiting_manual_send' })
    expect(send).toHaveBeenCalledTimes(1)
    const abandoned = queue.enqueue({ accountId: 'a', sessionId: 'x', sessionName: 'two', messageKeys: ['m2'], text: 'two' })
    await queue.whenIdle()
    expect(queue.abandonGeneratedReply(abandoned.id)).toBe(true)
    expect(queue.abandonGeneratedReply(abandoned.id)).toBe(true)
    expect(queue.findTask(abandoned.id)).toMatchObject({ status: 'cancelled', reason: 'manual_abandoned' })
  })
  it('executes tasks in global FIFO with one generator active', async () => {
    const gates = [deferred<string>(), deferred<string>()]
    let active = 0
    let maxActive = 0
    const generated: string[] = []
    const queue = new GlobalAiQueue({
      generate: vi.fn(async (task) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        generated.push(task.sessionId)
        const value = await gates[generated.length - 1].promise
        active -= 1
        return { kind: 'reply', text: value }
      }),
      send: vi.fn(async () => ({ success: true })),
      now: () => 10
    })
    queue.enqueue({ accountId: 'a', sessionId: 's1', sessionName: 'one', messageKeys: ['m1'], text: 'one' })
    queue.enqueue({ accountId: 'a', sessionId: 's2', sessionName: 'two', messageKeys: ['m2'], text: 'two' })
    await Promise.resolve()
    expect(generated).toEqual(['s1'])
    gates[0].resolve('r1')
    await vi.waitFor(() => expect(generated).toEqual(['s1', 's2']))
    gates[1].resolve('r2')
    await queue.whenIdle()
    expect(maxActive).toBe(1)
    expect(queue.getSnapshot().recent.map((task) => task.sessionId)).toEqual(['s1', 's2'])
  })

  it('manual send cancels only cancellable tasks in the same session', async () => {
    const generation = deferred<{ kind: 'reply'; text: string }>()
    const queue = new GlobalAiQueue({ generate: () => generation.promise, send: async () => ({ success: true }), now: () => 10 })
    const first = queue.enqueue({ accountId: 'a', sessionId: 'same', sessionName: 'same', messageKeys: ['1'], text: 'one' })
    const other = queue.enqueue({ accountId: 'a', sessionId: 'other', sessionName: 'other', messageKeys: ['2'], text: 'two' })
    await Promise.resolve()
    const cancelled = queue.cancelForManualSend('a', 'same')
    expect(cancelled).toEqual([first.id])
    expect(queue.findTask(first.id)?.status).toBe('cancelled')
    expect(queue.findTask(other.id)?.status).toBe('queued')
    generation.resolve({ kind: 'reply', text: 'ignored' })
    await Promise.resolve()
    queue.cancelTask(other.id, 'test cleanup')
    await queue.whenIdle()
  })

  it('manual waiter has priority over future automatic sends without concurrent adapter calls', async () => {
    const mutex = new PrioritySendMutex()
    const firstGate = deferred<void>()
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const run = (name: string, gate?: Promise<void>) => async () => {
      active += 1; maxActive = Math.max(maxActive, active); order.push(name)
      if (gate) await gate
      active -= 1
      return name
    }
    const first = mutex.run('auto', run('auto-1', firstGate.promise))
    const manual = mutex.run('manual', run('manual'))
    const futureAuto = mutex.run('auto', run('auto-2'))
    firstGate.resolve()
    await Promise.all([first, manual, futureAuto])
    expect(order).toEqual(['auto-1', 'manual', 'auto-2'])
    expect(maxActive).toBe(1)
  })

  it('reauthorizes an automatic send only after it acquires the shared mutex', async () => {
    const firstGate = deferred<void>()
    let authorized = false
    const adapter = { sendText: vi.fn(async ({ text }: { text: string }) => { if (text === 'manual') await firstGate.promise; return { success: true, sentAt: 1 } }) }
    const sender = new UnifiedSender({ cancelForManualSend: () => [], adapter, verifier: { captureBaseline: async () => undefined, verify: async () => ({ success: true }) } })
    const manual = sender.sendManual({ accountId: 'a', sessionId: 'other', text: 'manual' })
    const automatic = sender.sendAutomatic({ accountId: 'a', sessionId: 'target', text: 'reply' }, {
      onAcquire: vi.fn(), isCancelled: () => false,
      authorize: async () => authorized ? undefined : { success: false as const, error: 'current_account_changed' }
    })
    await Promise.resolve()
    authorized = false
    firstGate.resolve()
    await manual
    await expect(automatic).resolves.toEqual({ success: false, stage: 'authorization', error: 'current_account_changed' })
    expect(adapter.sendText).toHaveBeenCalledTimes(1)
  })

  it('reauthorizes a manual send after mutex acquisition and before baseline or adapter', async () => {
    const blocker = deferred<void>()
    const captureBaseline = vi.fn(async () => undefined)
    const adapter = { sendText: vi.fn(async ({ text }: { text: string }) => { if (text === 'blocker') await blocker.promise; return { success: true, sentAt: 1 } }) }
    const cancelForManualSend = vi.fn(() => [] as string[])
    const sender = new UnifiedSender({ cancelForManualSend, adapter, verifier: { captureBaseline, verify: async () => ({ success: true }) } })
    const first = sender.sendManual({ accountId: 'a', sessionId: 'one', text: 'blocker' })
    await vi.waitFor(() => expect(adapter.sendText).toHaveBeenCalledTimes(1))
    const denied = sender.sendManual(
      { accountId: 'a', sessionId: 'two', text: 'denied' },
      async () => ({ success: false as const, error: 'automation_permission_denied' })
    )
    blocker.resolve()

    await first
    await expect(denied).resolves.toEqual({ success: false, stage: 'authorization', error: 'automation_permission_denied' })
    expect(captureBaseline).toHaveBeenCalledTimes(1)
    expect(adapter.sendText).toHaveBeenCalledTimes(1)
    expect(cancelForManualSend).toHaveBeenCalledTimes(1)
    expect(cancelForManualSend).not.toHaveBeenCalledWith('a', 'two')
  })

  it('rechecks cancellation after async authorization before baseline and adapter', async () => {
    const authorization = deferred<{ success: false; error: string } | undefined>()
    const authorizationStarted = deferred<void>()
    const adapterTexts: string[] = []
    const captureBaseline = vi.fn(async () => undefined)
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter: { sendText: async ({ text }) => { adapterTexts.push(text); return { success: true, sentAt: 1 } } },
      verifier: { captureBaseline, verify: async () => ({ success: true, verifiedMessageKey: 'verified' }) }
    })
    const automatic = sender.sendAutomatic({ accountId: 'a', sessionId: 'same', text: 'automatic' }, {
      onAcquire: vi.fn(), isCancelled: () => false,
      authorize: async () => { authorizationStarted.resolve(); return authorization.promise }
    })
    await authorizationStarted.promise

    const manual = sender.sendManual({ accountId: 'a', sessionId: 'same', text: 'manual' })
    authorization.resolve(undefined)

    await expect(automatic).resolves.toEqual({ success: false, error: 'cancelled_before_sending' })
    await expect(manual).resolves.toEqual({ success: true })
    expect(adapterTexts).toEqual(['manual'])
    expect(captureBaseline).toHaveBeenCalledTimes(1)
  })

  it('manual sender cancels before waiting for the shared gateway and does not restore failures', async () => {
    const calls: string[] = []
    const sender = new UnifiedSender({
      cancelForManualSend: () => { calls.push('cancel'); return ['task'] },
      adapter: { sendText: async () => { calls.push('send'); return { success: false, error: 'failed' } } },
      verifier: { captureBaseline: async () => undefined, verify: async () => ({ success: false, error: 'not sent' }) }
    })
    const result = await sender.sendManual({ accountId: 'a', sessionId: 's', text: 'hello' })
    expect(calls).toEqual(['cancel', 'send'])
    expect(result.success).toBe(false)
  })

  it('converts thrown generation and send failures to terminal states and continues draining', async () => {
    const queue = new GlobalAiQueue({
      generate: vi.fn(async (task) => {
        if (task.sessionId === 'generation-throws') throw new Error('secret generation failure')
        return { kind: 'reply' as const, text: 'reply' }
      }),
      send: vi.fn(async (task) => {
        if (task.sessionId === 'send-throws') throw new Error('secret send failure')
        return { success: true }
      })
    })
    queue.enqueue({ accountId: 'a', sessionId: 'generation-throws', sessionName: 'one', messageKeys: ['1'], text: 'one' })
    queue.enqueue({ accountId: 'a', sessionId: 'send-throws', sessionName: 'two', messageKeys: ['2'], text: 'two' })
    queue.enqueue({ accountId: 'a', sessionId: 'success', sessionName: 'three', messageKeys: ['3'], text: 'three' })
    await queue.whenIdle()
    expect(queue.getSnapshot().recent.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: 'generation_failed', reason: 'generation_exception' },
      { status: 'send_failed', reason: 'send_exception' },
      { status: 'sent', reason: undefined }
    ])
    expect(queue.getSnapshot().recent[0].failureStage).toBe('generation')
  })

  it('keeps a pre-send Accessibility denial retryable as send_failed instead of delivery_unconfirmed', async () => {
    const queue = new GlobalAiQueue({
      autoSend: () => true,
      generate: async () => ({ kind: 'reply', text: 'reply' }),
      send: async () => ({ success: false, stage: 'automation', error: 'accessibility_permission_denied' })
    })
    const task = queue.enqueue({ accountId: 'a', sessionId: 's', sessionName: 'contact', messageKeys: ['message'], text: 'customer text' })

    await queue.whenIdle()

    expect(queue.findTask(task.id)).toMatchObject({
      status: 'send_failed',
      failureStage: 'automation',
      reason: 'accessibility_permission_denied'
    })
  })

  it('retries a failed send with the preserved generated reply without generating again', async () => {
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'preserved reply' }))
    const send = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'network' })
      .mockResolvedValueOnce({ success: true, verifiedMessageKey: 'sent' })
    const queue = new GlobalAiQueue({ generate, send })
    const task = queue.enqueue({ accountId: 'a', sessionId: 's', sessionName: 'one', messageKeys: ['1'], text: 'private input' })
    await queue.whenIdle()
    expect(queue.findTask(task.id)).toMatchObject({ status: 'send_failed', replyText: 'preserved reply' })

    expect(queue.retry(task.id)?.id).toBe(task.id)
    await queue.whenIdle()

    expect(generate).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][1]).toBe('preserved reply')
    expect(queue.findTask(task.id)).toMatchObject({ status: 'sent', replyText: 'preserved reply' })
  })

  it('preserves a delivery-unconfirmed reply and prohibits blind retry', async () => {
    const generate = vi.fn(async () => ({ kind: 'reply' as const, text: 'preserved reply' }))
    const send = vi.fn(async () => ({
      success: false,
      stage: 'verification_postsend' as const,
      error: 'outbound_not_verified'
    }))
    const queue = new GlobalAiQueue({ generate, send })
    const task = queue.enqueue({ accountId: 'private-account', sessionId: 'private-session', sessionName: 'Private Contact', messageKeys: ['private-key'], text: 'private customer text' })

    await queue.whenIdle()

    expect(queue.findTask(task.id)).toMatchObject({
      status: 'delivery_unconfirmed',
      failureStage: 'verification_postsend',
      reason: 'outbound_not_verified',
      replyText: 'preserved reply'
    })
    expect(queue.retry(task.id)).toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
