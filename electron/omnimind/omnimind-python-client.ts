import type { GenerationResult } from './global-ai-queue'

interface PythonClientDependencies { fetch?: typeof fetch; timeoutMs?: number }
interface ChatInput { baseUrl: string; apiKey: string; sessionId: string; externalUserId: string; message: string; timeoutMs?: number }

export class OmniMindPythonClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(dependencies: PythonClientDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? fetch
    this.timeoutMs = dependencies.timeoutMs ?? 15_000
  }

  async check(baseUrl: string, apiKey: string): Promise<{ success: boolean; kind?: string }> {
    const result = await this.request(`${baseUrl.replace(/\/$/, '')}/auth/check`, { method: 'GET', headers: this.headers(apiKey) })
    if (!result.ok) return { success: false, kind: result.kind }
    const contentType = result.response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json')) return { success: false, kind: 'incompatible' }
    try {
      const payload = await result.response.json() as Record<string, unknown>
      const data = payload?.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : undefined
      return payload.code === 200 && typeof payload.message === 'string' && Number.isFinite(payload.timestamp) && typeof payload.trace_id === 'string' && payload.trace_id.length > 0 && data?.authenticated === true
        ? { success: true }
        : { success: false, kind: 'incompatible' }
    } catch { return { success: false, kind: 'incompatible' } }
  }

  async chat(input: ChatInput): Promise<GenerationResult> {
    const response = await this.request(`${input.baseUrl.replace(/\/$/, '')}/chat`, {
      method: 'POST',
      headers: this.headers(input.apiKey),
      body: JSON.stringify({ session_id: input.sessionId, external_user_id: input.externalUserId, message: input.message, stream: false })
    }, input.timeoutMs)
    if (!response.ok) return { kind: response.kind as Exclude<GenerationResult['kind'], 'reply'>, error: response.error }
    let payload: unknown
    try { payload = JSON.parse(await response.response.text()) } catch { return { kind: 'malformed' } }
    if (!payload || typeof payload !== 'object') return { kind: 'malformed' }
    const record = payload as Record<string, unknown>
    if (record.code !== undefined && record.code !== 200) return { kind: 'malformed' }
    const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record
    const handoffStatus = typeof data.handoff_status === 'string' ? data.handoff_status.toLowerCase() : 'none'
    if (data.is_human_required === true || ['recommended', 'taken_over'].includes(handoffStatus)) return { kind: 'handoff' }
    if (typeof data.content !== 'string') return { kind: 'malformed' }
    const text = data.content.trim()
    return text ? { kind: 'reply', text } : { kind: 'empty' }
  }

  private headers(apiKey: string): Record<string, string> { return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` } }

  private async request(url: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<{ ok: true; response: Response } | { ok: false; kind: string; error?: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal })
      if (response.status === 401 || response.status === 403) return { ok: false, kind: 'auth' }
      if (!response.ok) return { ok: false, kind: 'network', error: `http_${response.status}` }
      return { ok: true, response }
    } catch (error) {
      return { ok: false, kind: controller.signal.aborted ? 'timeout' : 'network', error: error instanceof Error ? error.name : 'request_failed' }
    } finally { clearTimeout(timer) }
  }
}
