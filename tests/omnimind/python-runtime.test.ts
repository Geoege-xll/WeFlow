import { describe, expect, it, vi } from 'vitest'
import { OmniMindPythonClient } from '../../electron/omnimind/omnimind-python-client'

describe('OmniMindPythonClient', () => {
  it('accepts only the production auth/check JSON envelope', async () => {
    const valid = { code: 200, message: 'success', data: { authenticated: true }, timestamp: 1, trace_id: 'trace' }
    const responses = [
      new Response(JSON.stringify(valid), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ code: 200, data: { authenticated: true } }), { status: 200, headers: { 'content-type': 'application/json' } })
    ]
    const client = new OmniMindPythonClient({ fetch: vi.fn(async () => responses.shift()!), timeoutMs: 10 })
    await expect(client.check('https://api.example.com/api/v1/open', 'secret')).resolves.toEqual({ success: true })
    await expect(client.check('https://api.example.com/api/v1/open', 'secret')).resolves.toEqual({ success: false, kind: 'incompatible' })
  })
  it.each([
    [401, 'auth'], [403, 'auth'], [500, 'network']
  ] as const)('classifies HTTP %s as %s and never returns sendable text', async (status, kind) => {
    const client = new OmniMindPythonClient({ fetch: vi.fn(async () => new Response('{}', { status })), timeoutMs: 10 })
    expect(await client.chat({ baseUrl: 'http://127.0.0.1:8000', apiKey: 'secret', sessionId: 's', externalUserId: 'u', message: 'raw' })).toEqual(expect.objectContaining({ kind }))
  })

  it('distinguishes malformed, empty, and handoff responses', async () => {
    const responses = [
      new Response('bad', { status: 200 }),
      new Response(JSON.stringify({ code: 200, data: { content: '', is_human_required: false, handoff_status: 'none' } }), { status: 200 }),
      new Response(JSON.stringify({ code: 200, data: { content: 'do not send', is_human_required: true, handoff_status: 'taken_over' } }), { status: 200 })
    ]
    const client = new OmniMindPythonClient({ fetch: vi.fn(async () => responses.shift()!), timeoutMs: 10 })
    const input = { baseUrl: 'http://127.0.0.1:8000', apiKey: 'secret', sessionId: 's', externalUserId: 'u', message: 'raw' }
    expect((await client.chat(input)).kind).toBe('malformed')
    expect((await client.chat(input)).kind).toBe('empty')
    expect((await client.chat(input)).kind).toBe('handoff')
  })

  it('uses the approved non-streaming chat contract', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { content: 'reply', is_human_required: false, handoff_status: 'none' } }), { status: 200 }))
    const client = new OmniMindPythonClient({ fetch: fetchMock, timeoutMs: 10 })
    expect(await client.chat({ baseUrl: 'http://127.0.0.1:8000/api/v1/open/', apiKey: 'secret', sessionId: 's', externalUserId: 'u', message: 'raw' })).toEqual({ kind: 'reply', text: 'reply' })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/api/v1/open/chat', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session_id: 's', external_user_id: 'u', message: 'raw', stream: false })
    }))
  })
})
