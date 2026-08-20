import { describe, expect, it, vi } from 'vitest'
import { GlobalAiQueue } from '../../electron/omnimind/global-ai-queue'
import { NormalizedMessageEventHub } from '../../electron/omnimind/normalized-message-event-hub'
import { OmniMindController } from '../../electron/omnimind/omnimind-controller'
import { OmniMindPythonClient } from '../../electron/omnimind/omnimind-python-client'
import { UnifiedSender } from '../../electron/omnimind/unified-sender'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Phase 4 QA regressions', () => {
  it('rejects an unrelated successful HTTP response as an incompatible Open Channel service', async () => {
    const client = new OmniMindPythonClient({
      fetch: vi.fn(async () => new Response('<html>not OmniMind</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })),
      authCheckTimeoutMs: 100
    })

    await expect(client.check('https://api.example.com/api/v1/open', 'secret')).resolves.toEqual({
      success: false,
      kind: 'incompatible'
    })
  })

  it('decodes the production Open Channel response and fails closed on handoff', async () => {
    const responses = [
      new Response(JSON.stringify({
        code: 200,
        data: {
          operation_id: 'operation-1', status: 'completed', reply: { content: 'production reply', format: 'text' },
          handoff: { required: false, status: 'none', reason: null }
        }
      }), { status: 200 }),
      new Response(JSON.stringify({
        code: 200,
        data: {
          operation_id: 'operation-2', status: 'completed', reply: { content: 'must not send', format: 'text' },
          handoff: { required: true, status: 'recommended', reason: 'identity_unproven' }
        }
      }), { status: 200 })
    ]
    const client = new OmniMindPythonClient({ fetch: vi.fn(async () => responses.shift()!), chatTransportGuardMs: 100 })
    const input = {
      baseUrl: 'http://127.0.0.1:8000/api/v1/open',
      apiKey: 'secret',
      accountId: 'account-a',
      sessionId: 'session',
      sessionName: 'Contact',
      sessionType: 'private' as const,
      messages: [{
        accountId: 'account-a', sessionId: 'session', sessionName: 'Contact', sessionType: 'private' as const,
        messageKey: 'local-message-key', direction: 'inbound' as const, text: 'hello', timestamp: 1,
        messageType: 1, contentType: 'text' as const, senderExternalId: 'contact'
      }]
    }

    await expect(client.chat(input)).resolves.toEqual({ kind: 'reply', text: 'production reply' })
    await expect(client.chat(input)).resolves.toEqual({ kind: 'handoff' })
  })

  it('lets a same-session manual send cancel an automatic send still waiting for the mutex', async () => {
    const firstManualGate = deferred<void>()
    const adapterTexts: string[] = []
    let queue!: GlobalAiQueue
    const sender = new UnifiedSender({
      cancelForManualSend: (accountId, sessionId) => queue.cancelForManualSend(accountId, sessionId),
      adapter: {
        sendText: async ({ text }) => {
          adapterTexts.push(text)
          if (text === 'manual-other') await firstManualGate.promise
          return { success: true, sentAt: 1_000 }
        }
      },
      verifier: { captureBaseline: async () => undefined, verify: async () => ({ success: true, verifiedMessageKey: 'verified' }) }
    })
    queue = new GlobalAiQueue({
      generate: async () => ({ kind: 'reply', text: 'stale-ai-reply' }),
      send: (task, text) => sender.sendAutomatic({
        accountId: task.accountId,
        sessionId: task.sessionId,
        conversationTitle: task.sessionName,
        text
      })
    })

    const firstManual = sender.sendManual({ accountId: 'a', sessionId: 'other', text: 'manual-other' })
    const aiTask = queue.enqueue({
      accountId: 'a', sessionId: 'target', sessionName: 'Target', messageKeys: ['m1'], text: 'inbound'
    })
    await vi.waitFor(() => expect(queue.findTask(aiTask.id)?.status).toBe('waiting_to_send'))

    const targetManual = sender.sendManual({ accountId: 'a', sessionId: 'target', text: 'manual-target' })
    firstManualGate.resolve()
    await Promise.all([firstManual, targetManual, queue.whenIdle()])

    expect(queue.findTask(aiTask.id)?.status).toBe('cancelled')
    expect(adapterTexts).toEqual(['manual-other', 'manual-target'])
  })

  it('evicts terminal tasks beyond the recent-history cap', async () => {
    const queue = new GlobalAiQueue({
      generate: async () => ({ kind: 'network' }),
      send: async () => ({ success: true })
    })
    const first = queue.enqueue({
      accountId: 'a', sessionId: 's-0', sessionName: 'zero', messageKeys: ['m-0'], text: 'zero'
    })
    for (let index = 1; index < 21; index += 1) {
      queue.enqueue({
        accountId: 'a', sessionId: `s-${index}`, sessionName: String(index), messageKeys: [`m-${index}`], text: String(index)
      })
    }
    await queue.whenIdle()

    expect(queue.getSnapshot().recent).toHaveLength(20)
    expect(queue.findTask(first.id)).toBeUndefined()
    expect(queue.retry(first.id)).toBeUndefined()
  })

  it('does not expose the active WeChat account in the public snapshot', () => {
    const controller = new OmniMindController({
      hub: new NormalizedMessageEventHub(),
      generate: async () => ({ kind: 'network' }),
      send: async () => ({ success: false }),
      batchDelayMs: 2_000,
      accountId: () => 'wxid-private',
      scope: () => []
    })

    expect(controller.getSnapshot()).not.toHaveProperty('activeAccountId')
  })

  it('projects a confirmed delivery as one sanitized sent snapshot without resending', async () => {
    vi.useFakeTimers()
    try {
      const hub = new NormalizedMessageEventHub()
      const send = vi.fn(async () => ({
        success: false,
        stage: 'verification_postsend' as const,
        error: 'private-verifier-reason'
      }))
      const onSnapshotChanged = vi.fn()
      const controller = new OmniMindController({
        hub,
        generate: async () => ({ kind: 'reply', text: '保留回复' }),
        send,
        batchDelayMs: 500,
        accountId: () => 'private-account-id',
        scope: () => ['private-session-id'],
        onSnapshotChanged
      })
      controller.start()
      hub.publish({
        accountId: 'private-account-id', sessionId: 'private-session-id', sessionName: '可见会话',
        messageKey: 'private-message-key', direction: 'inbound', text: 'private input', timestamp: 1,
        sessionType: 'private', messageType: 1, contentType: 'text'
      })
      await vi.advanceTimersByTimeAsync(500)
      await controller.whenIdle()
      const uncertain = controller.getSnapshot().recent[0]
      expect(uncertain.status).toBe('delivery_unconfirmed')
      onSnapshotChanged.mockClear()

      expect(controller.confirmDelivery(uncertain.id)).toBe(true)
      expect(controller.confirmDelivery(uncertain.id)).toBe(false)

      expect(send).toHaveBeenCalledOnce()
      expect(onSnapshotChanged).toHaveBeenCalledOnce()
      const snapshot = controller.getSnapshot()
      expect(snapshot.recent[0]).toMatchObject({ id: uncertain.id, status: 'sent', reason: undefined, failureStage: undefined })
      expect(snapshot.recent[0]).not.toHaveProperty('accountId')
      expect(snapshot.recent[0]).not.toHaveProperty('messageKeys')
      expect(snapshot.recent[0]).not.toHaveProperty('text')
      expect(JSON.stringify(snapshot)).not.toContain('private-verifier-reason')
      expect(JSON.stringify(snapshot)).not.toContain('private-account-id')
      expect(JSON.stringify(snapshot)).not.toContain('private-message-key')
      controller.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
