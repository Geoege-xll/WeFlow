import { describe, expect, it, vi } from 'vitest'
import {
  OpenChannelDeliveryClient,
  OpenDeliveryClientError,
  OpenRecoveryDeliveryLoop
} from '../../electron/omnimind/open-channel-delivery-client'
import { PersistentDeliveryJournal } from '../../electron/omnimind/persistent-delivery-journal'

const envelope = (data: unknown): Response => new Response(JSON.stringify({
  code: 200,
  message: 'ok',
  data,
  timestamp: Date.now(),
  trace_id: 'trace'
}), { status: 200, headers: { 'content-type': 'application/json' } })

const context = {
  baseUrl: 'https://example.test/api/v1/open',
  apiKey: 'om_secret',
  sourceApplication: 'weflow' as const,
  sourceChannel: 'wechat' as const,
  sourceInstanceId: 'wx-account'
}

const item = {
  deliveryId: '11111111-1111-1111-1111-111111111111',
  fulfillmentId: '22222222-2222-2222-2222-222222222222',
  attemptNumber: 1,
  sessionReference: '33333333-3333-3333-3333-333333333333',
  routeReference: '44444444-4444-4444-4444-444444444444',
  content: '坐席已审核的回复',
  status: 'queued' as const
}

const claim = {
  deliveryId: item.deliveryId,
  leaseToken: 'lease-token',
  leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  fencingToken: 1
}

const memoryJournal = () => {
  let raw: string | undefined
  let failClaimedWrite = false
  const dependencies = {
    safeStorage: {
      isEncryptionAvailable: () => true,
      // 单元测试使用可逆前缀模拟 safeStorage；测试同时断言磁盘 envelope 不出现明文字段。
      encryptString: (value) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
      decryptString: (value) => Buffer.from(value.toString().replace(/^encrypted:/, ''), 'base64').toString()
    },
    read: async () => raw,
    writeAtomic: async (value: string) => {
      // 故障注入只拦截 claim 响应后的 claimed 原子写；claim_pending 必须已经成功落盘。
      const envelope = JSON.parse(value) as { ciphertext: string }
      const decrypted = Buffer.from(Buffer.from(envelope.ciphertext, 'base64').toString().replace(/^encrypted:/, ''), 'base64').toString()
      const states = Object.values((JSON.parse(decrypted) as { deliveries: Record<string, { state: string }> }).deliveries)
      if (failClaimedWrite && states.some((entry) => entry.state === 'claimed')) throw new Error('injected_claimed_write_failure')
      raw = value
    }
  }
  const createJournal = () => new PersistentDeliveryJournal(dependencies)
  return {
    journal: createJournal(),
    createJournal,
    raw: () => raw,
    failClaimedWrite: (value: boolean) => { failClaimedWrite = value }
  }
}

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('wait_timeout')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('Open Recovery Delivery client', () => {
  it('严格解析最小 DTO，并只用 Open API Key 与固定 weflow/wechat scope 请求', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('/recovery/deliveries?source_application=weflow&source_channel=wechat&source_instance_id=wx-account')
      expect((init?.headers as Record<string, string>)['X-Omni-Api-Key']).toBe('om_secret')
      return envelope({
        items: [{
          delivery_id: item.deliveryId,
          fulfillment_id: item.fulfillmentId,
          attempt_number: 1,
          parent_delivery_id: null,
          session_reference: item.sessionReference,
          route_reference: item.routeReference,
          content: item.content,
          status: 'queued'
        }],
        total: 1
      })
    })
    const result = await new OpenChannelDeliveryClient(fetchMock as typeof fetch).list(context)
    expect(result).toEqual([item])
    expect(JSON.stringify(result)).not.toMatch(/provider_message|external_id|receipt|exception/i)
  })

  it('服务端误加原始渠道字段时拒绝整个响应，非 2xx 正文不进入错误', async () => {
    const leaked = new OpenChannelDeliveryClient(vi.fn(async () => envelope({
      items: [{
        delivery_id: item.deliveryId,
        fulfillment_id: item.fulfillmentId,
        attempt_number: 1,
        parent_delivery_id: null,
        session_reference: item.sessionReference,
        route_reference: item.routeReference,
        content: item.content,
        status: 'queued',
        raw_wechat_id: 'wxid-private'
      }],
      total: 1
    })) as typeof fetch)
    await expect(leaked.list(context)).rejects.toMatchObject({ kind: 'malformed' })

    const conflict = new OpenChannelDeliveryClient(vi.fn(async () => new Response('private server exception body', { status: 409 })) as typeof fetch)
    await expect(conflict.get(context, item.deliveryId)).rejects.toEqual(new OpenDeliveryClientError('conflict'))
  })
})

describe('Open Recovery Delivery runtime loop', () => {
  it('正常路径只发送一次，渠道确认先入 journal，再 ACK 服务端', async () => {
    const { journal } = memoryJournal()
    await journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    const events: string[] = []
    let listed = false
    const client = {
      list: vi.fn(async () => listed ? [] : (listed = true, [item])),
      claim: vi.fn(async () => claim),
      acknowledge: vi.fn(async () => {
        events.push((await journal.getDelivery(item.deliveryId))?.state ?? 'missing')
        return { ...item, status: 'acknowledged', result: 'confirmed_sent' }
      }),
      notSent: vi.fn(), resultUnknown: vi.fn(), get: vi.fn()
    }
    const send = vi.fn(async () => ({ result: 'confirmed_sent' as const, providerMessageId: 'sha256:provider' }))
    const loop = new OpenRecoveryDeliveryLoop({
      client: client as unknown as OpenChannelDeliveryClient,
      journal,
      send,
      authorize: async () => undefined,
      pollIntervalMs: 1_000
    })
    loop.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => client.acknowledge.mock.calls.length === 1)
    await loop.stop()

    expect(send).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['ack_pending'])
    expect((await journal.getDelivery(item.deliveryId))?.state).toBe('acked')
  })

  it('ACK 网络丢失只重放 ACK，不再次调用微信 sender', async () => {
    const { journal } = memoryJournal()
    await journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    let listed = false
    const acknowledge = vi.fn()
      .mockRejectedValueOnce(new OpenDeliveryClientError('network'))
      .mockResolvedValue({ ...item, status: 'acknowledged', result: 'confirmed_sent' })
    const client = {
      list: vi.fn(async () => listed ? [] : (listed = true, [item])),
      claim: vi.fn(async () => claim), acknowledge,
      notSent: vi.fn(), resultUnknown: vi.fn(), get: vi.fn()
    }
    const send = vi.fn(async () => ({ result: 'confirmed_sent' as const, providerMessageId: 'sha256:provider' }))
    const first = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    first.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => acknowledge.mock.calls.length === 1)
    await first.stop()
    expect((await journal.getDelivery(item.deliveryId))?.state).toBe('ack_pending')

    const second = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    second.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => acknowledge.mock.calls.length === 2)
    await second.stop()
    expect(send).toHaveBeenCalledTimes(1)
    expect((await journal.getDelivery(item.deliveryId))?.state).toBe('acked')
  })

  it('旧 fence/409 只查询服务端事实并收敛，不循环 ACK 或重发微信消息', async () => {
    const { journal } = memoryJournal()
    await journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    let listed = false
    const client = {
      list: vi.fn(async () => listed ? [] : (listed = true, [item])),
      claim: vi.fn(async () => claim),
      acknowledge: vi.fn(async () => { throw new OpenDeliveryClientError('conflict') }),
      get: vi.fn(async () => ({ ...item, status: 'acknowledged', result: 'confirmed_sent' })),
      notSent: vi.fn(), resultUnknown: vi.fn()
    }
    const send = vi.fn(async () => ({ result: 'confirmed_sent' as const, providerMessageId: 'sha256:provider' }))
    const loop = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    loop.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => client.get.mock.calls.length === 1)
    await loop.stop()
    expect(send).toHaveBeenCalledTimes(1)
    expect(client.acknowledge).toHaveBeenCalledTimes(1)
    expect((await journal.getDelivery(item.deliveryId))?.state).toBe('acked')
  })

  it('sending 崩溃恢复只上报 result_unknown，且 stop 后迟到 list 不会 claim 或发送', async () => {
    const { journal } = memoryJournal()
    await journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    await journal.recordClaimIntent(item, (await journal.getRoute(item.sessionReference, 'wx-account'))!, 'stable-owner')
    await journal.recordClaimed(item.deliveryId, claim)
    await journal.markSending(item.deliveryId)
    const resultUnknown = vi.fn(async () => ({ ...item, status: 'result_unknown', result: 'result_unknown' }))
    let releaseList: ((items: typeof item[]) => void) | undefined
    const delayedList = new Promise<typeof item[]>((resolve) => { releaseList = resolve })
    const client = {
      list: vi.fn(async () => delayedList), claim: vi.fn(), acknowledge: vi.fn(), notSent: vi.fn(), resultUnknown, get: vi.fn()
    }
    const send = vi.fn()
    const loop = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    loop.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => resultUnknown.mock.calls.length === 1)
    const stopping = loop.stop()
    releaseList?.([item])
    await stopping
    expect(send).not.toHaveBeenCalled()
    expect(client.claim).not.toHaveBeenCalled()
    expect((await journal.getDelivery(item.deliveryId))?.state).toBe('result_unknown')
  })

  it('明确未发送只提交 not-sent；缺少本地 route 时不认领', async () => {
    const { journal } = memoryJournal()
    await journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    let listed = false
    const client = {
      list: vi.fn(async () => listed ? [] : (listed = true, [item])), claim: vi.fn(async () => claim), acknowledge: vi.fn(),
      notSent: vi.fn(async () => ({ ...item, status: 'failed', result: 'not_sent' })), resultUnknown: vi.fn(), get: vi.fn()
    }
    const loop = new OpenRecoveryDeliveryLoop({
      client: client as unknown as OpenChannelDeliveryClient,
      journal,
      send: vi.fn(async () => ({ result: 'not_sent' as const, failureCode: 'target_unavailable' })),
      authorize: async () => undefined,
      pollIntervalMs: 1_000
    })
    loop.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => client.notSent.mock.calls.length === 1)
    await loop.stop()
    expect((await journal.getDelivery(item.deliveryId))?.state).toBe('not_sent')

    const withoutRoute = memoryJournal()
    const noClaimClient = { ...client, list: vi.fn(async () => [item]), claim: vi.fn() }
    const noClaimLoop = new OpenRecoveryDeliveryLoop({ client: noClaimClient as unknown as OpenChannelDeliveryClient, journal: withoutRoute.journal, send: vi.fn(), authorize: async () => undefined, pollIntervalMs: 1_000 })
    noClaimLoop.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => noClaimClient.list.mock.calls.length === 1)
    await noClaimLoop.stop()
    expect(noClaimClient.claim).not.toHaveBeenCalled()
  })

  it('账户切换后的新 instance 不消费旧账户 route 或旧 journal', async () => {
    const { journal } = memoryJournal()
    await journal.recordRoute(item.sessionReference, 'wx-account-old', 'wx-session-old')
    let listed = false
    const client = {
      list: vi.fn(async () => listed ? [] : (listed = true, [item])), claim: vi.fn(),
      acknowledge: vi.fn(), notSent: vi.fn(), resultUnknown: vi.fn(), get: vi.fn()
    }
    const send = vi.fn()
    const loop = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    loop.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account-new' })
    await waitFor(() => client.list.mock.calls.length === 1)
    await loop.stop()
    expect(client.claim).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('claim 响应丢失后保留认领意图，并以同一 lease owner 恢复且只发送一次', async () => {
    const storage = memoryJournal()
    await storage.journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    let listed = false
    const owners: string[] = []
    const claimRequest = vi.fn(async (_context, _deliveryId, owner: string) => {
      owners.push(owner)
      if (owners.length === 1) throw new OpenDeliveryClientError('network')
      return claim
    })
    const acknowledge = vi.fn(async () => ({ ...item, status: 'acknowledged', result: 'confirmed_sent' }))
    const client = {
      list: vi.fn(async () => listed ? [] : (listed = true, [item])),
      claim: claimRequest,
      acknowledge,
      notSent: vi.fn(), resultUnknown: vi.fn(), get: vi.fn()
    }
    const send = vi.fn(async () => ({ result: 'confirmed_sent' as const, providerMessageId: 'sha256:provider' }))

    const first = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal: storage.journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    first.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => claimRequest.mock.calls.length === 1)
    await first.stop()
    expect((await storage.journal.getDelivery(item.deliveryId))?.state).toBe('claim_pending')
    expect(send).not.toHaveBeenCalled()

    // 用新 journal 实例模拟进程重启，证明恢复依赖的是已加密落盘意图，而不是内存对象。
    const restartedJournal = storage.createJournal()
    const second = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal: restartedJournal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    second.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => acknowledge.mock.calls.length === 1)
    await second.stop()

    expect(owners).toHaveLength(2)
    expect(owners[1]).toBe(owners[0])
    expect(send).toHaveBeenCalledTimes(1)
    expect((await restartedJournal.getDelivery(item.deliveryId))?.state).toBe('acked')
  })

  it('claim 成功但 claimed 原子落盘失败时仍保留意图，重启后不会丢 identity 或重复发送', async () => {
    const storage = memoryJournal()
    await storage.journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    storage.failClaimedWrite(true)
    let listed = false
    const owners: string[] = []
    const claimRequest = vi.fn(async (_context, _deliveryId, owner: string) => {
      owners.push(owner)
      return claim
    })
    const acknowledge = vi.fn(async () => ({ ...item, status: 'acknowledged', result: 'confirmed_sent' }))
    const client = {
      list: vi.fn(async () => listed ? [] : (listed = true, [item])), claim: claimRequest, acknowledge,
      notSent: vi.fn(), resultUnknown: vi.fn(), get: vi.fn()
    }
    const send = vi.fn(async () => ({ result: 'confirmed_sent' as const, providerMessageId: 'sha256:provider' }))
    const first = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal: storage.journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    first.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => claimRequest.mock.calls.length === 1)
    await first.stop()

    // copy-on-write 保证磁盘写失败不会把内存缓存假装推进到 claimed。
    expect((await storage.journal.getDelivery(item.deliveryId))?.state).toBe('claim_pending')
    expect(send).not.toHaveBeenCalled()

    storage.failClaimedWrite(false)
    const restartedJournal = storage.createJournal()
    const second = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal: restartedJournal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    second.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => acknowledge.mock.calls.length === 1)
    await second.stop()
    expect(owners[1]).toBe(owners[0])
    expect(send).toHaveBeenCalledTimes(1)
    expect((await restartedJournal.getDelivery(item.deliveryId))?.state).toBe('acked')
  })

  it('租约过期、409/404 与服务端 pending 都只保留对账；只有权威终态才归档', async () => {
    const storage = memoryJournal()
    await storage.journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    let listed = false
    const get = vi.fn()
      .mockRejectedValueOnce(new OpenDeliveryClientError('not_found'))
      .mockResolvedValueOnce({ ...item, status: 'claimed', result: 'pending' })
      .mockResolvedValueOnce({ ...item, status: 'result_unknown', result: 'result_unknown' })
    const claimRequest = vi.fn(async () => { throw new OpenDeliveryClientError('conflict') })
    const client = {
      list: vi.fn(async () => listed ? [] : (listed = true, [item])), claim: claimRequest, get,
      acknowledge: vi.fn(), notSent: vi.fn(), resultUnknown: vi.fn()
    }
    const send = vi.fn()
    const runUntilGet = async (expectedCalls: number): Promise<PersistentDeliveryJournal> => {
      const journal = storage.createJournal()
      const loop = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
      loop.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
      await waitFor(() => get.mock.calls.length === expectedCalls)
      await loop.stop()
      return journal
    }

    const after404 = await runUntilGet(1)
    expect((await after404.getDelivery(item.deliveryId))?.state).toBe('reconcile_pending')
    const afterPending = await runUntilGet(2)
    expect((await afterPending.getDelivery(item.deliveryId))?.state).toBe('reconcile_pending')
    const afterTerminal = await runUntilGet(3)
    expect((await afterTerminal.getDelivery(item.deliveryId))?.state).toBe('result_unknown')

    expect(claimRequest).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('已认领但租约过期时不发送，只 GET 对账并保留服务端 pending', async () => {
    const storage = memoryJournal()
    await storage.journal.recordRoute(item.sessionReference, 'wx-account', 'wx-session')
    const route = (await storage.journal.getRoute(item.sessionReference, 'wx-account'))!
    await storage.journal.recordClaimIntent(item, route, 'stable-owner')
    await storage.journal.recordClaimed(item.deliveryId, {
      ...claim,
      leaseExpiresAt: new Date(Date.now() - 1_000).toISOString()
    })
    const get = vi.fn(async () => ({ ...item, status: 'claimed', result: 'pending' }))
    const client = {
      list: vi.fn(async () => []), claim: vi.fn(), get,
      acknowledge: vi.fn(), notSent: vi.fn(), resultUnknown: vi.fn()
    }
    const send = vi.fn()
    const loop = new OpenRecoveryDeliveryLoop({ client: client as unknown as OpenChannelDeliveryClient, journal: storage.journal, send, authorize: async () => undefined, pollIntervalMs: 1_000 })
    loop.start({ baseUrl: context.baseUrl, apiKey: context.apiKey, accountId: 'wx-account' })
    await waitFor(() => get.mock.calls.length === 1)
    await loop.stop()
    expect(send).not.toHaveBeenCalled()
    expect((await storage.journal.getDelivery(item.deliveryId))?.state).toBe('reconcile_pending')
  })
})
