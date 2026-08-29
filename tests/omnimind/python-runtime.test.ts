import { createHash } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHAT_TRANSPORT_GUARD_MS, OmniMindPythonClient } from '../../electron/omnimind/omnimind-python-client'

afterEach(() => vi.useRealTimers())

const authData = {
  authenticated: true,
  contract_version: '2026-08-15',
  capabilities: {
    response_modes: ['sync', 'async'],
    content_types: ['text'],
    conversation_types: ['direct', 'group', 'thread', 'support_ticket', 'anonymous_session', 'other'],
    profile_patch: true,
    idempotent_replay: true
  },
  limits: {
    max_actors: 50,
    max_messages: 50,
    max_content_parts_per_message: 8,
    max_text_chars_per_part: 8000,
    max_extensions_bytes: 8192,
    max_extension_depth: 4,
    idempotency_key_max_length: 200
  }
}

const completed = (content = 'reply') => ({
  code: 200,
  message: 'success',
  timestamp: 1,
  trace_id: 'trace',
  data: {
    operation_id: 'operation-1',
    status: 'completed',
    canonical_session_id: 'session-1',
    canonical_conversation_id: 'conversation-1',
    lead_id: 'lead-1',
    customer_id: 'lead-1',
    accepted_message_ids: ['sha256:digest'],
    reply: { content, format: 'text' },
    intent: { score: 0, level: 'low', data: {} },
    handoff: { required: false, status: 'none', reason: null },
    profile_revision: 1
  }
})

const failed = (status: number, errorCode: string, overrides: Record<string, unknown> = {}) => ({
  code: status,
  message: '安全公开失败',
  timestamp: '2026-08-15T00:00:00Z',
  trace_id: 'trace-failure',
  data: {
    operation_id: 'operation-failed',
    status: 'failed',
    canonical_session_id: null,
    canonical_conversation_id: null,
    lead_id: null,
    customer_id: null,
    accepted_message_ids: [],
    reply: null,
    intent: null,
    handoff: { required: true, status: 'recommended', reason: errorCode },
    profile_revision: null,
    error_code: errorCode
  },
  ...overrides
})

const privateInput = {
  baseUrl: 'http://127.0.0.1:8000/api/v1/open',
  apiKey: 'secret',
  accountId: 'wxid-owner',
  sessionId: 'wxid-customer',
  sessionName: 'Alice',
  sessionType: 'private' as const,
  clientVersion: '5.0.0',
  clientRequestId: 'task-1',
  messages: [{
    accountId: 'wxid-owner',
    sessionId: 'wxid-customer',
    sessionName: 'Alice',
    sessionType: 'private' as const,
    messageKey: 'local:/private/db/message_0:123',
    direction: 'inbound' as const,
    text: '你家有没有洗地机',
    timestamp: 1_700_000_000,
    messageType: 1,
    contentType: 'text' as const,
    senderExternalId: 'wxid-customer',
    senderDisplayName: 'Alice'
  }]
}

describe('OmniMindPythonClient', () => {
  it('只接受声明完整 Open Chat 能力的 auth/check 合同', async () => {
    const valid = { code: 200, message: 'success', data: authData, timestamp: 1, trace_id: 'trace' }
    const responses = [
      new Response(JSON.stringify(valid), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ ...valid, data: { ...authData, contract_version: 'legacy' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ ...valid, data: { ...authData, capabilities: { ...authData.capabilities, idempotent_replay: false } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    ]
    const fetchMock = vi.fn(async () => responses.shift()!)
    const client = new OmniMindPythonClient({ fetch: fetchMock, authCheckTimeoutMs: 10 })
    await expect(client.check('https://api.example.com/api/v1/open', 'secret')).resolves.toEqual({ success: true })
    await expect(client.check('https://api.example.com/api/v1/open', 'secret')).resolves.toEqual({ success: false, kind: 'incompatible' })
    await expect(client.check('https://api.example.com/api/v1/open', 'secret')).resolves.toEqual({ success: false, kind: 'incompatible' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/v1/open/auth/check', expect.objectContaining({
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'X-Omni-Api-Key': 'secret'
      }
    }))
  })

  it.each([
    [401, 'auth'], [403, 'auth'], [408, 'timeout'], [500, 'network'], [503, 'network'], [504, 'timeout']
  ] as const)('classifies HTTP %s as %s and never returns sendable text', async (status, kind) => {
    const client = new OmniMindPythonClient({ fetch: vi.fn(async () => new Response('{}', { status })), chatTransportGuardMs: 10 })
    expect(await client.chat(privateInput)).toEqual(expect.objectContaining({ kind }))
  })

  it.each([
    [503, 'execution_result_unknown', 'execution_result_unknown'],
    [401, 'credential_revoked', 'auth'],
    [503, 'retry_exhausted', 'retry_exhausted'],
    [422, 'invalid_persisted_request', 'invalid_persisted_request'],
    [409, 'duplicate_external_message', 'conflict'],
    [504, 'generation_timeout', 'timeout'],
    [503, 'service_unavailable', 'service_unavailable']
  ] as const)('严格解析 HTTP %s 的公开失败码 %s，并映射为 %s', async (status, errorCode, kind) => {
    const response = new Response(JSON.stringify(failed(status, errorCode)), {
      status,
      headers: { 'content-type': 'application/json' }
    })
    const client = new OmniMindPythonClient({ fetch: vi.fn(async () => response), chatTransportGuardMs: 10 })

    await expect(client.chat(privateInput)).resolves.toEqual({ kind, error: errorCode })
  })

  it('拒绝非标准或被扩展的失败正文，且不传播 message/detail/原始网络异常', async () => {
    const privateFailure = failed(503, 'execution_result_unknown', {
      message: 'secret customer text and profile',
      extensions: { secret: 'must-not-leak' }
    })
    const responses: Array<Response | Error> = [
      new Response(JSON.stringify(privateFailure), { status: 503, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ detail: 'private API detail' }), { status: 409, headers: { 'content-type': 'application/json' } }),
      new Error('fetch failed for secret-url?api_key=secret')
    ]
    const client = new OmniMindPythonClient({
      fetch: vi.fn(async () => {
        const next = responses.shift()!
        if (next instanceof Error) throw next
        return next
      }),
      chatTransportGuardMs: 10
    })

    const invalidEnvelope = await client.chat(privateInput)
    const ordinaryConflict = await client.chat(privateInput)
    const transportFailure = await client.chat(privateInput)

    expect(invalidEnvelope).toEqual({ kind: 'network' })
    expect(ordinaryConflict).toEqual({ kind: 'conflict' })
    expect(transportFailure).toEqual({ kind: 'network' })
    const serialized = JSON.stringify([invalidEnvelope, ordinaryConflict, transportFailure])
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('fetch failed')
  })

  it('区分 malformed、empty、handoff 与 202 processing', async () => {
    const handoff = completed('do not send')
    handoff.data.handoff = { required: true, status: 'recommended', reason: null }
    const responses = [
      new Response('bad', { status: 200 }),
      new Response(JSON.stringify(completed('')), { status: 200 }),
      new Response(JSON.stringify(handoff), { status: 200 }),
      new Response(JSON.stringify({ code: 202, message: 'accepted', timestamp: 1, trace_id: 'trace', data: { operation_id: 'operation-1', status: 'processing' } }), { status: 202 })
    ]
    const client = new OmniMindPythonClient({ fetch: vi.fn(async () => responses.shift()!), chatTransportGuardMs: 10 })
    expect((await client.chat(privateInput)).kind).toBe('malformed')
    expect((await client.chat(privateInput)).kind).toBe('empty')
    expect((await client.chat(privateInput)).kind).toBe('handoff')
    expect((await client.chat(privateInput)).kind).toBe('processing')
  })

  it('建议真人关注时继续回复，只有明确阻断或已接管才停止自动发送', async () => {
    const recommended = completed('继续由 AI 自动回复')
    recommended.data.handoff = { required: false, status: 'recommended', reason: null }
    const takenOver = completed('这段文本不得被发送')
    takenOver.data.handoff = { required: true, status: 'taken_over', reason: null }
    const inconsistentTakenOver = completed('即使 required 错误也不得发送')
    inconsistentTakenOver.data.handoff = { required: false, status: 'taken_over', reason: null }
    const responses = [recommended, takenOver, inconsistentTakenOver]
    const client = new OmniMindPythonClient({
      fetch: vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })),
      chatTransportGuardMs: 10
    })

    await expect(client.chat(privateInput)).resolves.toEqual({
      kind: 'reply',
      text: '继续由 AI 自动回复'
    })
    await expect(client.chat(privateInput)).resolves.toEqual({ kind: 'handoff' })
    await expect(client.chat(privateInput)).resolves.toEqual({ kind: 'handoff' })
  })

  it('把 canonical_conversation_id 旁路写入本地路由回调，但阻断正文绝不成为可发送 reply', async () => {
    const blocked = completed('抱歉，当前信息不足以安全回答，已为您转交人工处理。')
    blocked.data.operation_id = 'operation-for-recovery'
    blocked.data.handoff = { required: true, status: 'none', reason: null }
    const onRouteObserved = vi.fn(async () => undefined)
    const client = new OmniMindPythonClient({
      fetch: vi.fn(async () => new Response(JSON.stringify(blocked), { status: 200 })),
      chatTransportGuardMs: 10,
      onRouteObserved
    })

    await expect(client.chat(privateInput)).resolves.toEqual({ kind: 'handoff' })
    expect(onRouteObserved).toHaveBeenCalledWith({
      sessionReference: 'conversation-1',
      accountId: 'wxid-owner',
      sessionId: 'wxid-customer'
    })
  })

  it('发送渠道中立信封、逐消息事实和稳定幂等头，且绝不传原始 messageKey', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(completed()), { status: 200 }))
    const client = new OmniMindPythonClient({ fetch: fetchMock, chatTransportGuardMs: 10 })
    await expect(client.chat({ ...privateInput, baseUrl: `${privateInput.baseUrl}/` })).resolves.toEqual({ kind: 'reply', text: 'reply' })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    const bodyText = String(init?.body)
    const body = JSON.parse(bodyText)
    const expectedMessageDigest = createHash('sha256').update(privateInput.messages[0].messageKey).digest('hex')
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/v1/open/chat')
    expect(headers).toMatchObject({
      'content-type': 'application/json',
      'X-Omni-Api-Key': 'secret',
      'X-Client-Request-Id': 'task-1'
    })
    expect(headers['Idempotency-Key']).toMatch(/^weflow:[a-f0-9]{64}$/)
    expect(headers).not.toHaveProperty('authorization')
    expect(body).toEqual({
      source: { application: 'weflow', channel: 'wechat', instance_id: 'wxid-owner', client_version: '5.0.0' },
      conversation: { external_id: 'wxid-customer', type: 'direct', display_name: 'Alice' },
      actors: [{
        ref: 'customer_1', role: 'customer', external_id: 'wxid-customer', identity_namespace: 'wechat_user',
        display_name: 'Alice', profile_observed_at: '2023-11-14T22:13:20.000Z'
      }],
      messages: [{
        external_id: `sha256:${expectedMessageDigest}`,
        actor_ref: 'customer_1',
        occurred_at: '2023-11-14T22:13:20.000Z',
        content: [{ type: 'text', text: '你家有没有洗地机' }]
      }],
      context: { surface: 'automatic_hosting' },
      response: { mode: 'sync', formats: ['text'] },
      extensions: {}
    })
    expect(bodyText).not.toContain(privateInput.messages[0].messageKey)
    expect(bodyText).not.toContain('/private/db')

    // clientRequestId 不参与幂等键：同一批消息只改变链路 ID，仍然对账到同一 operation。
    await client.chat({ ...privateInput, clientRequestId: 'task-2' })
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>
    expect(secondHeaders['Idempotency-Key']).toBe(headers['Idempotency-Key'])
  })

  it('群聊传播真实 sender；缺 sender 时使用匿名 actor，绝不把 room 绑定为客户', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(completed()), { status: 200 }))
    const client = new OmniMindPythonClient({ fetch: fetchMock, chatTransportGuardMs: 10 })
    const groupInput = {
      ...privateInput,
      sessionId: 'room@chatroom',
      sessionName: '产品交流群',
      sessionType: 'group' as const,
      messages: [
        { ...privateInput.messages[0], sessionId: 'room@chatroom', sessionType: 'group' as const, messageKey: 'group-key-1', senderExternalId: 'wxid-bob', senderDisplayName: 'Bob' },
        { ...privateInput.messages[0], sessionId: 'room@chatroom', sessionType: 'group' as const, messageKey: 'group-key-2', senderExternalId: undefined, senderDisplayName: '不可信回退名' },
        // 即使绕过 MessagePush 规范化层，DTO builder 仍必须大小写不敏感地拒绝 room-as-sender。
        { ...privateInput.messages[0], sessionId: 'room@chatroom', sessionType: 'group' as const, messageKey: 'group-key-3', senderExternalId: 'ROOM@CHATROOM', senderDisplayName: '错误房间回退' }
      ]
    }
    await client.chat(groupInput)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(body.conversation).toMatchObject({ external_id: 'room@chatroom', type: 'group' })
    expect(body.actors).toEqual([
      expect.objectContaining({ ref: 'customer_1', external_id: 'wxid-bob', identity_namespace: 'wechat_user', display_name: 'Bob' }),
      { ref: 'customer_2', role: 'customer', profile_observed_at: '2023-11-14T22:13:20.000Z' }
    ])
    expect(body.messages.map((message: { actor_ref: string }) => message.actor_ref)).toEqual(['customer_1', 'customer_2', 'customer_2'])
    expect(JSON.stringify(body.actors)).not.toContain('room@chatroom')
    expect(JSON.stringify(body.actors)).not.toContain('ROOM@CHATROOM')
    expect(JSON.stringify(body.actors)).not.toContain('不可信回退名')
    expect(JSON.stringify(body)).not.toContain('group-key-1')
    expect(JSON.stringify(body)).not.toContain('group-key-2')
    expect(JSON.stringify(body)).not.toContain('group-key-3')

    await client.chat({ ...groupInput, clientRequestId: 'another-trace-id' })
    const replayHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>
    expect(replayHeaders['Idempotency-Key']).toBe(headers['Idempotency-Key'])
  })

  it('按 capability 限制切分长文本，并在超过单请求消息上限时 fail closed', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(completed()), { status: 200 }))
    const client = new OmniMindPythonClient({ fetch: fetchMock, chatTransportGuardMs: 10 })
    const longText = `${'文'.repeat(8_000)}🙂`
    await client.chat({ ...privateInput, messages: [{ ...privateInput.messages[0], text: longText }] })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: '文'.repeat(8_000) },
      { type: 'text', text: '🙂' }
    ])

    const tooManyMessages = Array.from({ length: 51 }, (_, index) => ({
      ...privateInput.messages[0], messageKey: `message-${index}`
    }))
    await expect(client.chat({ ...privateInput, messages: tooManyMessages })).resolves.toEqual({ kind: 'malformed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows a 29-second Python reply and does not reuse the removed 15-second user timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(completed('slow reply')), { status: 200 })), 29_000)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })) as typeof fetch
    const client = new OmniMindPythonClient({ fetch: fetchMock })
    const result = client.chat(privateInput)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14_000)
    await expect(result).resolves.toEqual({ kind: 'reply', text: 'slow reply' })
    expect(CHAT_TRANSPORT_GUARD_MS).toBe(330_000)
  })

  it('maps only the hidden chat transport guard expiry to timeout without a real wait', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as typeof fetch
    const client = new OmniMindPythonClient({ fetch: fetchMock, chatTransportGuardMs: 1_000 })
    const result = client.chat(privateInput)

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).resolves.toEqual({ kind: 'timeout' })
  })
})
