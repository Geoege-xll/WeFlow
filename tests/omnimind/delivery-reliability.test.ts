import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildOsascriptArguments, FOCUS_RESTORE_SCRIPT, MacOsWeChatTextAdapter, SEND_SCRIPT, WcdbOutboundVerifier } from '../../electron/omnimind/macos-wechat-text-adapter'
import { UnifiedSender } from '../../electron/omnimind/unified-sender'

describe('OmniMind delivery reliability', () => {
  it('targets only System Events for send and focus restore while keeping dynamic values in argv', () => {
    for (const script of [SEND_SCRIPT, FOCUS_RESTORE_SCRIPT]) {
      expect(script.match(/tell application\s+/gi)).toEqual(['tell application '])
      expect(script).toContain('tell application "System Events"')
      expect(script).not.toMatch(/tell application "WeChat"|tell application \(|expectedTitle\s*&|replyText\s*&/i)
    }
    expect(FOCUS_RESTORE_SCRIPT).toContain('item 1 of argv')
    expect(buildOsascriptArguments(SEND_SCRIPT, ['title"\nmalicious', 'reply'])).toEqual(['-e', SEND_SCRIPT, '--', 'title"\nmalicious', 'reply'])
  })

  it('rejects a verifier without captureBaseline at the TypeScript boundary', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'weflow-required-baseline-'))
    try {
      const fixture = path.join(directory, 'missing-baseline.ts')
      const senderModule = path.resolve('electron/omnimind/unified-sender').replaceAll('\\', '\\\\')
      await writeFile(fixture, [
        `import type { OutboundVerifier } from '${senderModule}'`,
        'const verifier: OutboundVerifier = { verify: async () => ({ success: true }) }',
        'void verifier'
      ].join('\n'))
      const result = spawnSync(process.execPath, [
        path.resolve('node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noEmit', '--skipLibCheck', '--strict',
        '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', fixture
      ], { cwd: process.cwd(), encoding: 'utf8' })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain("Property 'captureBaseline' is missing")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps IPC and hook send results exactly aligned with the shared stage contract', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'weflow-send-result-contract-'))
    try {
      const fixture = path.join(directory, 'send-result-contract.ts')
      const contractsModule = path.resolve('shared/omnimind/contracts').replaceAll('\\', '\\\\')
      const electronTypesModule = path.resolve('src/types/electron').replaceAll('\\', '\\\\')
      const hookModule = path.resolve('src/features/omnimind/useOmniMind').replaceAll('\\', '\\\\')
      const senderModule = path.resolve('electron/omnimind/unified-sender').replaceAll('\\', '\\\\')
      const queueModule = path.resolve('electron/omnimind/global-ai-queue').replaceAll('\\', '\\\\')
      const controllerModule = path.resolve('electron/omnimind/omnimind-controller').replaceAll('\\', '\\\\')
      const serviceModule = path.resolve('electron/omnimind/omnimind-service').replaceAll('\\', '\\\\')
      const ipcModule = path.resolve('electron/omnimind/register-omnimind-ipc').replaceAll('\\', '\\\\')
      await writeFile(fixture, [
        `import type { OmniMindFailureStage, OmniMindSendResult } from '${contractsModule}'`,
        `import type { ElectronAPI } from '${electronTypesModule}'`,
        `import type { useOmniMind } from '${hookModule}'`,
        `import type { UnifiedSender } from '${senderModule}'`,
        `import type { GlobalAiQueue } from '${queueModule}'`,
        `import type { OmniMindController } from '${controllerModule}'`,
        `import type { OmniMindService } from '${serviceModule}'`,
        `import type { IpcController, registerOmniMindIpc } from '${ipcModule}'`,
        'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false',
        'type Assert<T extends true> = T',
        "type SenderManual = Awaited<ReturnType<UnifiedSender['sendManual']>>",
        "type SenderGenerated = Awaited<ReturnType<UnifiedSender['sendAutomatic']>>",
        "type QueueGenerated = Awaited<ReturnType<GlobalAiQueue['sendGeneratedReply']>>",
        "type ControllerGenerated = Awaited<ReturnType<OmniMindController['sendGeneratedReply']>>",
        "type ServiceManual = Awaited<ReturnType<OmniMindService['sendManual']>>",
        "type ServiceGenerated = Awaited<ReturnType<OmniMindService['sendGeneratedReply']>>",
        "type IpcManual = Awaited<ReturnType<IpcController['sendManual']>>",
        "type IpcGenerated = Awaited<ReturnType<IpcController['sendGeneratedReply']>>",
        "type RegisteredController = Parameters<typeof registerOmniMindIpc>[1]",
        "type ManualResult = Awaited<ReturnType<ElectronAPI['omniMind']['sendManual']>>",
        "type GeneratedResult = Awaited<ReturnType<ElectronAPI['omniMind']['sendGeneratedReply']>>",
        "type HookResult = Awaited<ReturnType<ReturnType<typeof useOmniMind>['sendGeneratedReply']>>",
        'type SenderManualExact = Assert<Equal<SenderManual, OmniMindSendResult>>',
        'type SenderGeneratedExact = Assert<Equal<SenderGenerated, OmniMindSendResult>>',
        'type QueueGeneratedExact = Assert<Equal<QueueGenerated, OmniMindSendResult>>',
        'type ControllerGeneratedExact = Assert<Equal<ControllerGenerated, OmniMindSendResult>>',
        'type ServiceManualExact = Assert<Equal<ServiceManual, OmniMindSendResult>>',
        'type ServiceGeneratedExact = Assert<Equal<ServiceGenerated, OmniMindSendResult>>',
        'type IpcManualExact = Assert<Equal<IpcManual, OmniMindSendResult>>',
        'type IpcGeneratedExact = Assert<Equal<IpcGenerated, OmniMindSendResult>>',
        'type RegisteredControllerExact = Assert<Equal<RegisteredController, IpcController>>',
        'type ManualExact = Assert<Equal<ManualResult, OmniMindSendResult>>',
        'type GeneratedExact = Assert<Equal<GeneratedResult, OmniMindSendResult>>',
        'type HookExact = Assert<Equal<HookResult, OmniMindSendResult>>',
        'declare const service: OmniMindService',
        'const registeredController: RegisteredController = service',
        'declare const result: ManualResult',
        'declare const generatedResult: GeneratedResult',
        'declare const hookResult: HookResult',
        'const stage: OmniMindFailureStage | undefined = result.stage',
        '// @ts-expect-error verified message keys are internal and must not cross IPC',
        'const leakedMessageKey = result.verifiedMessageKey',
        '// @ts-expect-error generated IPC results must not expose message keys',
        'const leakedGeneratedMessageKey = generatedResult.verifiedMessageKey',
        '// @ts-expect-error hook results must not expose message keys',
        'const leakedHookMessageKey = hookResult.verifiedMessageKey',
        '// @ts-expect-error verified message keys are not part of the public send result',
        "const leakedResult: OmniMindSendResult = { success: true, verifiedMessageKey: 'private-key' }",
        "// @ts-expect-error invalid stages must not cross IPC",
        "const invalid: OmniMindSendResult = { success: false, stage: 'not-a-stage' }",
        'void stage; void leakedMessageKey; void leakedGeneratedMessageKey; void leakedHookMessageKey; void leakedResult; void invalid; void registeredController',
        'type ContractAssertions = SenderManualExact | SenderGeneratedExact | QueueGeneratedExact | ControllerGeneratedExact | ServiceManualExact | ServiceGeneratedExact | IpcManualExact | IpcGeneratedExact | RegisteredControllerExact | ManualExact | GeneratedExact | HookExact',
        'declare const assertions: ContractAssertions',
        'void assertions'
      ].join('\n'))
      const result = spawnSync(process.execPath, [
        path.resolve('node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noEmit', '--skipLibCheck', '--strict',
        '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', fixture
      ], { cwd: process.cwd(), encoding: 'utf8' })

      const fixtureDiagnostics = `${result.stdout}\n${result.stderr}`.split('\n').filter((line) => line.includes('send-result-contract.ts'))
      expect(fixtureDiagnostics).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('takes the maximum ascending position as baseline and rejects an older same-second same-text row', async () => {
    const getMessages = vi.fn()
      .mockResolvedValueOnce({ success: true, messages: [
        { messageKey: 'old-outbound', localId: 10, isSend: 1, createTime: 100, parsedContent: 'same reply' },
        { messageKey: 'latest-outbound', localId: 12, isSend: 1, createTime: 100, parsedContent: 'different reply' },
        { messageKey: 'latest-inbound', localId: 13, isSend: 0, createTime: 100, parsedContent: 'customer' }
      ], hasMore: false })
      .mockResolvedValue({ success: true, messages: [
        { messageKey: 'old-outbound', localId: 10, isSend: 1, createTime: 100, parsedContent: 'same reply' }
      ], hasMore: false })
    let now = 100_900
    const verifier = new WcdbOutboundVerifier({ getMessages }, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
      verificationDeadlineMs: 200,
      pollIntervalMs: 100
    })

    const watermark = await verifier.captureBaseline({ accountId: 'private-account', sessionId: 'private-session' })

    expect(watermark).toEqual({ keys: ['latest-outbound'], createTime: 100, localId: 13 })
    expect(getMessages).toHaveBeenNthCalledWith(1, 'private-session', 0, 50, 0, 101, false)
    await expect(verifier.verify({
      accountId: 'private-account', sessionId: 'private-session', text: 'same reply', sentAt: 100_900, watermark
    })).resolves.toEqual({ success: false, error: 'outbound_not_verified' })
  })

  it('polls delayed WCDB visibility inside one verification call without invoking the adapter again', async () => {
    const oldRows = [{ messageKey: 'old', localId: 10, isSend: 1, createTime: 100, parsedContent: 'reply' }]
    const getMessages = vi.fn()
      .mockResolvedValueOnce({ success: true, messages: oldRows, hasMore: false })
      .mockResolvedValueOnce({ success: true, messages: oldRows, hasMore: false })
      .mockResolvedValueOnce({ success: true, messages: oldRows, hasMore: false })
      .mockResolvedValueOnce({ success: true, messages: [
        ...oldRows,
        { messageKey: 'new', localId: 11, isSend: 1, createTime: 101, parsedContent: 'reply' }
      ], hasMore: false })
    let now = 100_000
    const verifier = new WcdbOutboundVerifier({ getMessages }, {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
      verificationDeadlineMs: 500,
      pollIntervalMs: 100
    })
    const adapter = { sendText: vi.fn(async () => ({ success: true, sentAt: 100_000 })) }
    const sender = new UnifiedSender({ cancelForManualSend: () => [], adapter, verifier })

    await expect(sender.sendAutomatic({ accountId: 'a', sessionId: 's', text: 'reply' })).resolves.toEqual({
      success: true
    })
    expect(adapter.sendText).toHaveBeenCalledTimes(1)
    expect(getMessages).toHaveBeenCalledTimes(4)
  })

  it('does not call the adapter when baseline capture fails and returns a stable failure stage', async () => {
    const adapter = { sendText: vi.fn(async () => ({ success: true, sentAt: 1 })) }
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter,
      verifier: {
        captureBaseline: async () => { throw new Error('raw database details') },
        verify: async () => ({ success: true })
      }
    })

    await expect(sender.sendManual({ accountId: 'secret-account', sessionId: 'secret-session', text: 'secret reply' })).resolves.toEqual({
      success: false,
      stage: 'verification_baseline',
      error: 'verification_baseline_failed'
    })
    expect(adapter.sendText).not.toHaveBeenCalled()
  })

  it('marks an action that cannot be verified as post-send uncertainty', async () => {
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter: { sendText: async () => ({ success: true, sentAt: 1 }) },
      verifier: {
        captureBaseline: async () => ({ keys: [], createTime: 0, localId: 0 }),
        verify: async () => ({ success: false, error: 'verification_read_failed' })
      }
    })

    await expect(sender.sendManual({ accountId: 'a', sessionId: 's', text: 'reply' })).resolves.toEqual({
      success: false,
      stage: 'verification_postsend',
      error: 'verification_read_failed'
    })
  })

  it('converts a thrown post-send read into delivery uncertainty', async () => {
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter: { sendText: async () => ({ success: true, sentAt: 1 }) },
      verifier: {
        captureBaseline: async () => ({ keys: [], createTime: 0, localId: 0 }),
        verify: async () => { throw new Error('raw database error with private content') }
      }
    })

    await expect(sender.sendManual({ accountId: 'a', sessionId: 's', text: 'private reply' })).resolves.toEqual({
      success: false,
      stage: 'verification_postsend',
      error: 'verification_read_failed'
    })
  })

  it('verifies after an adapter throws because the action boundary is uncertain', async () => {
    const verify = vi.fn(async () => ({ success: true, verifiedMessageKey: 'confirmed' }))
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter: { sendText: async () => { throw new Error('raw adapter error') } },
      verifier: { captureBaseline: async () => undefined, verify }
    })

    const result = await sender.sendManual({ accountId: 'a', sessionId: 's', text: 'reply' })
    expect(result).toEqual({ success: true })
    expect(JSON.stringify(result)).toBe('{"success":true}')
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('returns an authorization stage before baseline or automation', async () => {
    const adapter = { sendText: vi.fn(async () => ({ success: true, sentAt: 1 })) }
    const captureBaseline = vi.fn(async () => undefined)
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter,
      verifier: { captureBaseline, verify: async () => ({ success: true }) }
    })

    await expect(sender.sendAutomatic({ accountId: 'a', sessionId: 's', text: 'reply' }, {
      onAcquire: vi.fn(), isCancelled: () => false,
      authorize: async () => ({ success: false, error: 'managed_scope_changed' })
    })).resolves.toEqual({ success: false, stage: 'authorization', error: 'managed_scope_changed' })
    expect(captureBaseline).not.toHaveBeenCalled()
    expect(adapter.sendText).not.toHaveBeenCalled()
  })

  it('fails before automation when clipboard capture is unavailable', async () => {
    const runAppleScript = vi.fn()
    const adapter = new MacOsWeChatTextAdapter({
      platform: 'darwin',
      clipboard: { readText: () => { throw new Error('raw clipboard contents') }, writeText: vi.fn() },
      runAppleScript
    })

    await expect(adapter.sendText({ accountId: 'a', sessionId: 's', conversationTitle: 'title', text: 'reply' })).resolves.toEqual({
      success: false,
      stage: 'automation',
      error: 'clipboard_capture_failed'
    })
    expect(runAppleScript).not.toHaveBeenCalled()
  })

  it('keeps a successful automation result when clipboard and focus restoration fail', async () => {
    const runAppleScript = vi.fn(async (_script: string, args: string[]) => {
      if (args.length === 0) return 'Finder'
      if (args[0] === 'Finder') throw new Error('raw focus restore failure')
      return 'sent'
    })
    const adapter = new MacOsWeChatTextAdapter({
      platform: 'darwin',
      clipboard: { readText: () => 'private clipboard', writeText: () => { throw new Error('raw clipboard restore failure') } },
      runAppleScript,
      now: () => 123
    })

    await expect(adapter.sendText({ accountId: 'a', sessionId: 's', conversationTitle: 'title', text: 'reply' })).resolves.toEqual({
      success: true,
      sentAt: 123,
      cleanupWarnings: ['clipboard_restore_failed', 'focus_restore_failed']
    })
  })

  it.each([
    ['accessibility', 'accessibility_permission_denied'],
    ['ambiguous-target', 'target_ambiguous'],
    ['target-mismatch', 'target_mismatch'],
    ['input-unavailable', 'input_unavailable'],
    ['ambiguous-input', 'input_ambiguous']
  ])('maps AppleScript result %s to safe reason %s', async (scriptResult, expectedReason) => {
    const adapter = new MacOsWeChatTextAdapter({
      platform: 'darwin',
      clipboard: { readText: () => 'before', writeText: vi.fn() },
      runAppleScript: vi.fn(async (_script: string, args: string[]) => args.length === 0 ? 'Finder' : scriptResult)
    })

    await expect(adapter.sendText({ accountId: 'a', sessionId: 's', conversationTitle: 'title', text: 'reply' })).resolves.toMatchObject({
      success: false,
      stage: 'automation',
      error: expectedReason
    })
  })

  it('classifies osascript timeout without exposing the raw exception', async () => {
    const timeout = Object.assign(new Error('reply text and contact leaked here'), { killed: true, signal: 'SIGTERM' })
    const adapter = new MacOsWeChatTextAdapter({
      platform: 'darwin',
      clipboard: { readText: () => 'before', writeText: vi.fn() },
      runAppleScript: vi.fn(async (_script: string, args: string[]) => {
        if (args.length === 0) return 'Finder'
        if (args[0] === 'Finder') return ''
        throw timeout
      }),
      now: () => 321
    })

    await expect(adapter.sendText({ accountId: 'a', sessionId: 's', conversationTitle: 'title', text: 'reply' })).resolves.toEqual({
      success: false,
      stage: 'automation',
      error: 'automation_timeout',
      actionMayHaveOccurred: true,
      sentAt: 321
    })
  })

  it.each([
    [Object.assign(new Error('Not authorized to send Apple events to System Events. (-1743)'), { code: 1, stderr: 'private contact: Not authorized to send Apple events. (-1743)' }), 'automation_permission_denied'],
    [{ code: -1743, message: 'localized failure containing private reply' }, 'automation_permission_denied'],
    [{ code: 1, stdout: 'System Events got an error: osascript is not allowed assistive access. (-25211)', stderr: 'private reply' }, 'accessibility_permission_denied'],
    [{ code: '-25211', message: 'localized failure containing private contact' }, 'accessibility_permission_denied']
  ])('classifies native permission rejection as %s without post-send verification or raw error leakage', async (permissionError, expectedReason) => {
    const verify = vi.fn(async () => ({ success: true, verifiedMessageKey: 'private-message-key' }))
    const diagnostics: Array<Record<string, unknown>> = []
    const adapter = new MacOsWeChatTextAdapter({
      platform: 'darwin',
      clipboard: { readText: () => 'private clipboard', writeText: vi.fn() },
      runAppleScript: vi.fn(async (_script: string, args: string[]) => {
        if (args.length === 0) return 'Finder'
        if (args[0] === 'Finder') return ''
        throw permissionError
      })
    })
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter,
      verifier: { captureBaseline: async () => undefined, verify },
      createCorrelationId: () => 'safe-correlation',
      recordDiagnostic: async (entry) => { diagnostics.push(entry) }
    })

    const result = await sender.sendManual({ accountId: 'private-account', sessionId: 'private-session', conversationTitle: 'private contact', text: 'private reply' })

    expect(result).toEqual({ success: false, stage: 'automation', error: expectedReason })
    expect(verify).not.toHaveBeenCalled()
    expect(diagnostics).toEqual([{ correlationId: 'safe-correlation', stage: 'automation', terminalState: 'send_failed', reason: expectedReason }])
    expect(JSON.stringify({ result, diagnostics })).not.toMatch(/private|Apple events|assistive access|-1743|-25211|verifiedMessageKey|message-key/i)
  })

  it('keeps an unknown osascript rejection post-send uncertain without exposing the raw exception', async () => {
    const verify = vi.fn(async () => ({ success: false, error: 'outbound_not_verified' }))
    const adapter = new MacOsWeChatTextAdapter({
      platform: 'darwin',
      clipboard: { readText: () => 'private clipboard', writeText: vi.fn() },
      runAppleScript: vi.fn(async (_script: string, args: string[]) => {
        if (args.length === 0) return 'Finder'
        throw Object.assign(new Error('private contact and reply'), { stderr: 'private raw stderr', code: 1 })
      })
    })
    const sender = new UnifiedSender({
      cancelForManualSend: () => [],
      adapter,
      verifier: { captureBaseline: async () => undefined, verify }
    })

    await expect(sender.sendManual({ accountId: 'a', sessionId: 's', conversationTitle: 'contact', text: 'reply' })).resolves.toEqual({
      success: false, stage: 'verification_postsend', error: 'outbound_not_verified'
    })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('classifies Automation denial while capturing focus before sending', async () => {
    const runAppleScript = vi.fn(async () => {
      throw Object.assign(new Error('System Events denied private contact'), { stderr: 'Not authorized to send Apple events. (-1743)' })
    })
    const adapter = new MacOsWeChatTextAdapter({
      platform: 'darwin',
      clipboard: { readText: () => 'private clipboard', writeText: vi.fn() },
      runAppleScript
    })

    await expect(adapter.sendText({ accountId: 'a', sessionId: 's', conversationTitle: 'contact', text: 'reply' })).resolves.toEqual({
      success: false, stage: 'automation', error: 'automation_permission_denied'
    })
    expect(runAppleScript).toHaveBeenCalledTimes(1)
  })
})
