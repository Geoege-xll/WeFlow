import { describe, expect, it, vi } from 'vitest'
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { createAtomicDiagnosticFile, DeliveryDiagnosticStore } from '../../electron/omnimind/delivery-diagnostics'
import { UnifiedSender } from '../../electron/omnimind/unified-sender'

describe('delivery failure observability', () => {
  it('persists only bounded, allowlisted diagnostic fields', async () => {
    let persisted: string | undefined
    let timestampSequence = 0
    const store = new DeliveryDiagnosticStore({
      read: async () => persisted,
      writeAtomic: async (value) => { persisted = value },
      now: () => 1_000 + ++timestampSequence,
      maxEntries: 2
    })

    await store.record({ correlationId: 'transaction-1', stage: 'automation', terminalState: 'send_failed', reason: 'accessibility_permission_denied' })
    await store.record({ correlationId: 'transaction-2', stage: 'cleanup', terminalState: 'sent', reason: 'clipboard_restore_failed' })
    await store.record({
      correlationId: 'transaction-3', stage: 'verification_postsend', terminalState: 'delivery_unconfirmed', reason: 'outbound_not_verified',
      accountId: 'secret-account', sessionId: 'secret-session', contact: 'Alice', customerText: 'private input',
      replyText: 'private reply', messageKey: 'secret-key', apiKey: 'secret-api', clipboard: 'secret clipboard',
      rawError: 'raw exception with private reply'
    } as never)

    const entries = JSON.parse(String(persisted)) as Array<Record<string, unknown>>
    expect(entries).toHaveLength(2)
    expect(entries[1]).toEqual({
      timestamp: 1003,
      correlationId: 'transaction-3',
      stage: 'verification_postsend',
      terminalState: 'delivery_unconfirmed',
      reason: 'outbound_not_verified'
    })
    expect(String(persisted)).not.toMatch(/secret-account|secret-session|Alice|private input|private reply|secret-key|secret-api|secret clipboard|raw exception/i)
  })

  it('persists bounded privacy-safe runtime stream closures without implying a send transaction', async () => {
    let persisted = ''
    let timestamp = 20
    const store = new DeliveryDiagnosticStore({
      read: async () => persisted,
      writeAtomic: async (value) => { persisted = value },
      now: () => ++timestamp,
      maxEntries: 2
    })

    await store.recordRuntimeStreamClosure({ stream: 'stdout', code: 'EPIPE' })
    await store.recordRuntimeStreamClosure({ stream: 'stderr', code: 'ERR_STREAM_DESTROYED' })
    await store.recordRuntimeStreamClosure({
      stream: 'stdout',
      code: 'EPIPE',
      rawError: 'customer text and API key'
    } as never)

    const entries = JSON.parse(persisted) as Array<Record<string, unknown>>
    expect(entries).toHaveLength(2)
    expect(entries[1]).toEqual({
      timestamp: 23,
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      stage: 'runtime_logging',
      terminalState: 'runtime_degraded',
      reason: 'console_stream_closed',
      stream: 'stdout',
      errorCode: 'EPIPE'
    })
    expect(persisted).not.toMatch(/customer text|API key|rawError/i)
  })

  it('rejects non-allowlisted runtime stream fields instead of persisting them', async () => {
    const writeAtomic = vi.fn(async (_value: string) => undefined)
    const store = new DeliveryDiagnosticStore({ read: async () => undefined, writeAtomic })

    await store.recordRuntimeStreamClosure({ stream: 'stdin' as never, code: 'EPIPE' })
    await store.recordRuntimeStreamClosure({ stream: 'stdout', code: 'EIO' as never })

    expect(writeAtomic).not.toHaveBeenCalled()
  })

  it('replaces unknown reason text instead of persisting it', async () => {
    let persisted = ''
    const store = new DeliveryDiagnosticStore({
      read: async () => persisted,
      writeAtomic: async (value) => { persisted = value },
      now: () => 10,
    })

    await store.record({ correlationId: 'correlation-safe', stage: 'automation', terminalState: 'send_failed', reason: 'raw customer text leaked here' as never })

    expect(JSON.parse(persisted)[0]).toEqual({
      timestamp: 10,
      correlationId: 'correlation-safe',
      stage: 'automation',
      terminalState: 'send_failed',
      reason: 'unknown_failure'
    })
    expect(persisted).not.toContain('raw customer text')
  })

  it.each([
    'permission_status_unknown',
    'wechat_process_unavailable', 'wechat_window_unavailable', 'wechat_window_ambiguous',
    'wechat_window_recovery_failed', 'wechat_window_recovery_timeout',
    'search_open_failed', 'search_field_unavailable', 'search_field_ambiguous', 'search_input_failed',
    'conversation_title_unavailable', 'target_ambiguous', 'search_result_click_failed', 'target_mismatch',
    'input_unavailable', 'input_ambiguous', 'input_click_failed', 'input_paste_failed', 'input_submit_failed'
  ])('对当前稳定自动化原因 %s 做新旧诊断 round-trip', async (reason) => {
    let persisted = JSON.stringify([{ timestamp: 1, correlationId: 'old-id', stage: 'automation', terminalState: 'send_failed', reason }])
    const store = new DeliveryDiagnosticStore({
      read: async () => persisted,
      writeAtomic: async (value) => { persisted = value },
      now: () => 2
    })

    await store.record({ correlationId: 'new-id', stage: 'automation', terminalState: 'send_failed', reason })

    expect(JSON.parse(persisted).map((entry: { reason: string }) => entry.reason)).toEqual([reason, reason])
  })

  it('replaces an unsafe correlation ID before the first persistence', async () => {
    let persisted = ''
    const store = new DeliveryDiagnosticStore({
      read: async () => persisted,
      writeAtomic: async (value) => { persisted = value },
      now: () => 10
    })

    await store.record({ correlationId: 'private customer text', stage: 'automation', terminalState: 'send_failed', reason: 'automation_failed' })

    expect(persisted).not.toContain('private customer text')
    expect(JSON.parse(persisted)[0].correlationId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('does not carry unexpected fields forward from an existing diagnostic file', async () => {
    let persisted = JSON.stringify([{
      timestamp: 1,
      correlationId: 'old-correlation',
      stage: 'automation',
      terminalState: 'send_failed',
      reason: 'automation_failed',
      customerText: 'private prior customer text',
      rawError: 'raw prior exception'
    }])
    const store = new DeliveryDiagnosticStore({
      read: async () => persisted,
      writeAtomic: async (value) => { persisted = value },
      now: () => 2,
    })

    await store.record({ correlationId: 'new-correlation', stage: 'cleanup', terminalState: 'sent', reason: 'focus_restore_failed' })

    expect(persisted).not.toMatch(/private prior|raw prior|customerText|rawError/)
  })

  it('drops entries with invalid runtime stage or terminal state before persistence', async () => {
    const writeAtomic = vi.fn(async (_value: string) => undefined)
    const store = new DeliveryDiagnosticStore({ read: async () => undefined, writeAtomic })

    await store.record({ correlationId: 'safe-id', stage: 'private customer stage' as never, terminalState: 'send_failed', reason: 'automation_failed' })
    await store.record({ correlationId: 'safe-id', stage: 'automation', terminalState: 'private customer state' as never, reason: 'automation_failed' })

    expect(writeAtomic).not.toHaveBeenCalled()
  })

  it('records post-send uncertainty and cleanup warnings without changing a verified result', async () => {
    const diagnostics: Array<Record<string, unknown>> = []
    const uncertain = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter: { sendText: async () => ({ success: true, sentAt: 1, cleanupWarnings: ['clipboard_restore_failed'] }) },
      verifier: {
        captureBaseline: async () => ({ keys: [], createTime: 0, localId: 0 }),
        verify: async () => ({ success: false, error: 'outbound_not_verified' })
      },
      createCorrelationId: () => 'transaction-one',
      recordDiagnostic: async (entry) => { diagnostics.push(entry) }
    })

    await expect(uncertain.sendManual({ accountId: 'secret-account', sessionId: 'secret-session', text: 'private reply' })).resolves.toMatchObject({
      success: false,
      stage: 'verification_postsend',
      error: 'outbound_not_verified'
    })
    expect(diagnostics).toEqual([
      { correlationId: 'transaction-one', stage: 'verification_postsend', terminalState: 'delivery_unconfirmed', reason: 'outbound_not_verified' },
      { correlationId: 'transaction-one', stage: 'cleanup', terminalState: 'delivery_unconfirmed', reason: 'clipboard_restore_failed' }
    ])

    diagnostics.length = 0
    const verified = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter: { sendText: async () => ({ success: true, sentAt: 1, cleanupWarnings: ['focus_restore_failed'] }) },
      verifier: { captureBaseline: async () => undefined, verify: async () => ({ success: true, verifiedMessageKey: 'verified' }) },
      createCorrelationId: () => 'transaction-two',
      recordDiagnostic: async (entry) => { diagnostics.push(entry) }
    })
    await expect(verified.sendManual({ accountId: 'a', sessionId: 's', text: 'reply' })).resolves.toEqual({ success: true })
    expect(diagnostics).toEqual([{ correlationId: 'transaction-two', stage: 'cleanup', terminalState: 'sent', reason: 'focus_restore_failed' }])
  })

  it('uses one correlation ID per transaction and a different ID for the next transaction', async () => {
    const diagnostics: Array<Record<string, unknown>> = []
    let sequence = 0
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter: { sendText: async () => ({ success: false, stage: 'automation' as const, error: 'automation_timeout', actionMayHaveOccurred: true, sentAt: 1, cleanupWarnings: ['focus_restore_failed'] }) },
      verifier: { captureBaseline: async () => undefined, verify: async () => ({ success: false, error: 'outbound_not_verified' }) },
      createCorrelationId: () => `transaction-${++sequence}`,
      recordDiagnostic: async (entry) => { diagnostics.push(entry) }
    })

    await sender.sendManual({ accountId: 'a', sessionId: 'one', text: 'reply one' })
    await sender.sendManual({ accountId: 'a', sessionId: 'two', text: 'reply two' })

    expect(diagnostics.map((entry) => entry.correlationId)).toEqual([
      'transaction-1', 'transaction-1', 'transaction-1',
      'transaction-2', 'transaction-2', 'transaction-2'
    ])
    expect(diagnostics.slice(0, 3).map((entry) => entry.stage)).toEqual(['automation', 'verification_postsend', 'cleanup'])
  })

  it('atomically replaces the diagnostic file with mode 0600 in an isolated temporary directory', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omnimind-wechat-delivery-diagnostics-'))
    try {
      const target = path.join(directory, 'delivery-diagnostics.json')
      const file = createAtomicDiagnosticFile(target, { processId: 42, createTemporaryId: () => 'replacement' })

      await file.writeAtomic('[{"version":1}]')
      const first = await stat(target)
      await chmod(target, 0o644)
      await file.writeAtomic('[{"version":2}]')
      const second = await stat(target)

      expect(await readFile(target, 'utf8')).toBe('[{"version":2}]')
      expect(second.mode & 0o777).toBe(0o600)
      expect(second.ino).not.toBe(first.ino)
      expect(await readdir(directory)).toEqual(['delivery-diagnostics.json'])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('retries an exclusive temp collision without modifying or deleting the existing file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omnimind-wechat-delivery-collision-'))
    try {
      const target = path.join(directory, 'delivery-diagnostics.json')
      const collision = path.join(directory, '.delivery-diagnostics.json.42.collision.tmp')
      await writeFile(collision, 'valuable existing temp', { mode: 0o640 })
      const ids = ['collision', 'fresh']
      const file = createAtomicDiagnosticFile(target, { processId: 42, createTemporaryId: () => String(ids.shift()) })

      await file.writeAtomic('[{"safe":true}]')

      expect(await readFile(collision, 'utf8')).toBe('valuable existing temp')
      expect((await stat(collision)).mode & 0o777).toBe(0o640)
      expect(await readFile(target, 'utf8')).toBe('[{"safe":true}]')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not follow or unlink a colliding symlink while retrying', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omnimind-wechat-delivery-symlink-'))
    try {
      const target = path.join(directory, 'delivery-diagnostics.json')
      const protectedFile = path.join(directory, 'protected.txt')
      const collision = path.join(directory, '.delivery-diagnostics.json.42.link.tmp')
      await writeFile(protectedFile, 'protected contents', { mode: 0o640 })
      await symlink(protectedFile, collision)
      const ids = ['link', 'fresh']
      const file = createAtomicDiagnosticFile(target, { processId: 42, createTemporaryId: () => String(ids.shift()) })

      await file.writeAtomic('[{"safe":true}]')

      expect((await lstat(collision)).isSymbolicLink()).toBe(true)
      expect(await readFile(protectedFile, 'utf8')).toBe('protected contents')
      expect((await stat(protectedFile)).mode & 0o777).toBe(0o640)
      expect(await readFile(target, 'utf8')).toBe('[{"safe":true}]')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails safely after bounded temp collisions without changing target or collision', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omnimind-wechat-delivery-bounded-collision-'))
    try {
      const target = path.join(directory, 'delivery-diagnostics.json')
      const collision = path.join(directory, '.delivery-diagnostics.json.42.collision.tmp')
      await writeFile(target, 'old target', { mode: 0o640 })
      await writeFile(collision, 'existing collision', { mode: 0o600 })
      const file = createAtomicDiagnosticFile(target, { processId: 42, createTemporaryId: () => 'collision' })

      await expect(file.writeAtomic('new target')).rejects.toThrow('diagnostic_temp_collision')

      expect(await readFile(target, 'utf8')).toBe('old target')
      expect((await stat(target)).mode & 0o777).toBe(0o640)
      expect(await readFile(collision, 'utf8')).toBe('existing collision')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
