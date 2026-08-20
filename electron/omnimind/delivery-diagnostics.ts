import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type { OmniMindFailureStage, OmniMindTaskState } from '../../shared/omnimind/contracts'
import type { ClosedStreamDiagnostic } from '../safe-console'

export interface DeliveryDiagnosticInput {
  correlationId: string
  stage: OmniMindFailureStage
  terminalState: Extract<OmniMindTaskState, 'sent' | 'send_failed' | 'delivery_unconfirmed'>
  reason: string
}

interface RuntimeLoggingDiagnosticInput {
  correlationId: string
  stage: 'runtime_logging'
  terminalState: 'runtime_degraded'
  reason: 'console_stream_closed'
  stream: ClosedStreamDiagnostic['stream']
  errorCode: ClosedStreamDiagnostic['code']
}

type DiagnosticInput = DeliveryDiagnosticInput | RuntimeLoggingDiagnosticInput

interface DeliveryDiagnosticDependencies {
  read: () => Promise<string | undefined>
  writeAtomic: (value: string) => Promise<void>
  now?: () => number
  maxEntries?: number
}

export class DeliveryDiagnosticStore {
  private writeChain = Promise.resolve()

  constructor(private readonly dependencies: DeliveryDiagnosticDependencies) {}

  record(input: DiagnosticInput): Promise<void> {
    const operation = this.writeChain.then(() => this.persist(input))
    this.writeChain = operation.catch(() => undefined)
    return operation
  }

  recordRuntimeStreamClosure(event: ClosedStreamDiagnostic): Promise<void> {
    return this.record({
      correlationId: randomUUID(),
      stage: 'runtime_logging',
      terminalState: 'runtime_degraded',
      reason: 'console_stream_closed',
      stream: event.stream,
      errorCode: event.code
    })
  }

  private async persist(input: DiagnosticInput): Promise<void> {
    if (!SAFE_STAGES.has(input.stage)) return
    const runtimeEntry = input.stage === 'runtime_logging'
    if (runtimeEntry) {
      const candidate = input as Partial<RuntimeLoggingDiagnosticInput>
      if (candidate.terminalState !== 'runtime_degraded' || candidate.reason !== 'console_stream_closed') return
      if (!SAFE_STREAMS.has(candidate.stream as ClosedStreamDiagnostic['stream'])) return
      if (!SAFE_STREAM_ERROR_CODES.has(candidate.errorCode as ClosedStreamDiagnostic['code'])) return
    } else if (!SAFE_DELIVERY_TERMINAL_STATES.has(input.terminalState as DeliveryDiagnosticInput['terminalState'])) {
      return
    }
    const existing = await this.readEntries()
    const maximum = Math.min(500, Math.max(1, this.dependencies.maxEntries ?? 100))
    const entry: DeliveryDiagnosticEntry = {
      timestamp: this.dependencies.now?.() ?? Date.now(),
      correlationId: SAFE_CORRELATION_ID.test(input.correlationId) ? input.correlationId : randomUUID(),
      stage: input.stage,
      terminalState: input.terminalState,
      reason: runtimeEntry ? 'console_stream_closed' : (SAFE_REASONS.has(input.reason) ? input.reason : 'unknown_failure')
    }
    if (runtimeEntry) {
      const runtime = input as RuntimeLoggingDiagnosticInput
      entry.stream = runtime.stream
      entry.errorCode = runtime.errorCode
    }
    existing.push(entry)
    await this.dependencies.writeAtomic(JSON.stringify(existing.slice(-maximum)))
  }

  private async readEntries(): Promise<DeliveryDiagnosticEntry[]> {
    try {
      const value = await this.dependencies.read()
      if (!value) return []
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((value): DeliveryDiagnosticEntry[] => {
        if (!value || typeof value !== 'object') return []
        const entry = value as Record<string, unknown>
        if (typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) return []
        if (typeof entry.correlationId !== 'string' || !SAFE_CORRELATION_ID.test(entry.correlationId)) return []
        if (typeof entry.stage !== 'string' || !SAFE_STAGES.has(entry.stage as OmniMindFailureStage)) return []
        if (typeof entry.terminalState !== 'string') return []
        const runtimeEntry = entry.stage === 'runtime_logging'
        if (runtimeEntry) {
          if (entry.terminalState !== 'runtime_degraded' || entry.reason !== 'console_stream_closed') return []
          if (typeof entry.stream !== 'string' || !SAFE_STREAMS.has(entry.stream as ClosedStreamDiagnostic['stream'])) return []
          if (typeof entry.errorCode !== 'string' || !SAFE_STREAM_ERROR_CODES.has(entry.errorCode as ClosedStreamDiagnostic['code'])) return []
        } else if (!SAFE_DELIVERY_TERMINAL_STATES.has(entry.terminalState as DeliveryDiagnosticInput['terminalState'])) {
          return []
        }
        const diagnostic: DeliveryDiagnosticEntry = {
          timestamp: entry.timestamp,
          correlationId: entry.correlationId,
          stage: entry.stage as OmniMindFailureStage,
          terminalState: entry.terminalState as DeliveryDiagnosticEntry['terminalState'],
          reason: runtimeEntry ? 'console_stream_closed' : (typeof entry.reason === 'string' && SAFE_REASONS.has(entry.reason) ? entry.reason : 'unknown_failure')
        }
        if (runtimeEntry) {
          diagnostic.stream = entry.stream as ClosedStreamDiagnostic['stream']
          diagnostic.errorCode = entry.errorCode as ClosedStreamDiagnostic['code']
        }
        return [diagnostic]
      })
    } catch {
      return []
    }
  }
}

interface AtomicDiagnosticFileDependencies {
  processId?: number
  createTemporaryId?: () => string
}

export const createAtomicDiagnosticFile = (
  target: string,
  dependencies: AtomicDiagnosticFileDependencies = {}
): Pick<DeliveryDiagnosticDependencies, 'read' | 'writeAtomic'> => ({
  read: async () => {
    try { return await fs.readFile(target, 'utf8') } catch { return undefined }
  },
  writeAtomic: async (value) => {
    await fs.mkdir(path.dirname(target), { recursive: true })
    let temporary = ''
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const temporaryId = dependencies.createTemporaryId?.() ?? randomUUID()
      temporary = path.join(path.dirname(target), `.${path.basename(target)}.${dependencies.processId ?? process.pid}.${temporaryId}.tmp`)
      try {
        handle = await fs.open(temporary, 'wx', 0o600)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    if (!handle) throw new Error('diagnostic_temp_collision')
    try {
      await handle.writeFile(value, { encoding: 'utf8' })
      await handle.close()
      handle = undefined
      await fs.rename(temporary, target)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await fs.unlink(temporary).catch(() => undefined)
      throw error
    }
  }
})

interface DeliveryDiagnosticEntry {
  timestamp: number
  correlationId: string
  stage: OmniMindFailureStage
  terminalState: DeliveryDiagnosticInput['terminalState'] | 'runtime_degraded'
  reason: string
  stream?: ClosedStreamDiagnostic['stream']
  errorCode?: ClosedStreamDiagnostic['code']
}

const SAFE_REASONS = new Set([
  'verification_baseline_failed', 'verification_read_failed', 'verification_unbounded', 'outbound_not_verified',
  'clipboard_capture_failed', 'focus_capture_failed', 'accessibility_permission_denied', 'automation_permission_denied', 'permission_status_unknown',
  // 脚本只返回这些无用户数据的稳定码；新记录与旧诊断读回共用同一白名单，其他文本统一降级。
  'wechat_process_unavailable', 'wechat_window_unavailable', 'wechat_window_ambiguous',
  'wechat_window_recovery_failed', 'wechat_window_recovery_timeout',
  'search_open_failed', 'search_field_unavailable', 'search_field_ambiguous', 'search_input_failed',
  // 标题缺失与重名都只表达本地授权结论，不包含真实昵称、sessionId 或其他用户数据。
  'conversation_title_unavailable', 'target_ambiguous', 'search_result_click_failed', 'target_mismatch',
  'input_unavailable', 'input_ambiguous', 'input_click_failed', 'input_paste_failed', 'input_submit_failed',
  'automation_timeout', 'automation_failed',
  'clipboard_restore_failed', 'focus_restore_failed', 'current_account_changed', 'current_settings_unavailable',
  'managed_scope_changed', 'official_account_filtered', 'api_key_unavailable', 'unknown_failure'
])
const SAFE_STAGES = new Set<OmniMindFailureStage>(['generation', 'authorization', 'verification_baseline', 'automation', 'verification_postsend', 'cleanup', 'runtime_logging'])
const SAFE_DELIVERY_TERMINAL_STATES = new Set<DeliveryDiagnosticInput['terminalState']>(['sent', 'send_failed', 'delivery_unconfirmed'])
const SAFE_STREAMS = new Set<ClosedStreamDiagnostic['stream']>(['stdout', 'stderr'])
const SAFE_STREAM_ERROR_CODES = new Set<ClosedStreamDiagnostic['code']>(['EPIPE', 'ERR_STREAM_DESTROYED'])
const SAFE_CORRELATION_ID = /^[A-Za-z0-9-]{1,64}$/
