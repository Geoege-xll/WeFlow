import { describe, expect, it } from 'vitest'
import {
  isCriticalSettingsChange,
  makeStableMessageId,
  parseCancelTaskPayload,
  parseEnablePayload,
  parseManualSendPayload,
  normalizeOmniMindBaseUrl,
  parseManagedScope,
  isManagedSession,
  parseSettingsPayload,
  parsePermissionKindPayload
} from '../../shared/omnimind/contracts'
import { parseAccountConfigBundle, parseAccountConfigPatch } from '../../shared/omnimind/account-bundle'

describe('OmniMind contracts smoke', () => {
  it('discovers tests and rejects unknown enable payload fields', () => {
    expect(() => parseEnablePayload({ unexpected: true })).toThrow('Invalid enable payload')
  })

  it('builds account-scoped stable message ids', () => {
    expect(makeStableMessageId('wxid_a', 'alice', 'msg-1')).toBe('wxid_a\u001falice\u001fmsg-1')
  })

  it('strictly validates renderer command payloads', () => {
    expect(parseEnablePayload({})).toEqual({})
    expect(parseCancelTaskPayload({ taskId: ' task-1 ' })).toEqual({ taskId: 'task-1' })
    expect(parseManualSendPayload({ sessionId: 's', text: ' hello ' })).toEqual({ sessionId: 's', text: ' hello ' })
    expect(() => parseManualSendPayload({ accountId: 'a', sessionId: 's', text: 'hello' })).toThrow()
    expect(() => parseManualSendPayload({ sessionId: 's', text: '   ' })).toThrow()
    expect(() => parseCancelTaskPayload({ taskId: 'x', extra: true })).toThrow()
    expect(parseSettingsPayload({ schemaVersion: 2, pythonBaseUrl: 'http://127.0.0.1:8000', apiKeyDraft: 'secret', managedScope: { mode: 'selected', conversations: [{ sessionId: 'a', displayName: 'A' }] }, autoSend: true, ignoreOfficial: true, batchWindowMs: 2500, requestTimeoutMs: 12000 })).toEqual({
      schemaVersion: 2, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', apiKeyDraft: 'secret', managedScope: { mode: 'selected', conversations: [{ sessionId: 'a', displayName: 'A' }] }, autoSend: true, ignoreOfficial: true, batchWindowMs: 2500, requestTimeoutMs: 12000
    })
    const base = { schemaVersion: 2, managedScope: { mode: 'all', confirmedAt: 1 }, autoSend: true, ignoreOfficial: true }
    expect(() => parseSettingsPayload({ ...base, pythonBaseUrl: 'http://remote.test' })).toThrow()
    expect(() => parseSettingsPayload({ ...base, pythonBaseUrl: 'http://user:pass@127.0.0.1:8000' })).toThrow()
    expect(() => parseSettingsPayload({ ...base, pythonBaseUrl: 'http://127.0.0.1:8000', batchWindowMs: 20 })).toThrow()
    expect(parseSettingsPayload({ ...base, pythonBaseUrl: 'http://[::1]:8000/api/v1/open' }).pythonBaseUrl).toBe('http://[::1]:8000/api/v1/open')
  })

  it('accepts only a fixed permission enum and rejects renderer-controlled targets', () => {
    expect(parsePermissionKindPayload({ permission: 'accessibility' })).toEqual({ permission: 'accessibility' })
    expect(parsePermissionKindPayload({ permission: 'automation' })).toEqual({ permission: 'automation' })
    expect(() => parsePermissionKindPayload({ permission: 'automation', url: 'https://example.test' })).toThrow('Invalid permission payload')
    expect(() => parsePermissionKindPayload({ permission: 'camera' })).toThrow('Invalid permission payload')
  })

  it('strictly validates the complete account configuration bundle', () => {
    const bundle = { myWxid: 'a', dbPath: '/db', decryptKey: 'key', imageXorKey: 7, imageAesKey: '', cachePath: '/cache', lastOpenedDb: '/db' }
    expect(parseAccountConfigBundle(bundle)).toEqual(bundle)
    expect(parseAccountConfigBundle({ ...bundle, imageAesKey: '0123456789abcdef' }).imageAesKey).toBe('0123456789abcdef')
    expect(parseAccountConfigBundle({ ...bundle, imageAesKey: '0291fe4418a3007db261990cee531780' }).imageAesKey).toHaveLength(32)
    expect(() => parseAccountConfigBundle({ ...bundle, extra: true })).toThrow('Invalid account bundle')
    expect(() => parseAccountConfigBundle({ ...bundle, decryptKey: undefined })).toThrow('Invalid account bundle')
    expect(() => parseAccountConfigBundle({ ...bundle, imageXorKey: -1 })).toThrow('Invalid account bundle')
    expect(() => parseAccountConfigBundle({ ...bundle, imageXorKey: 999 })).toThrow('Invalid account bundle')
    expect(() => parseAccountConfigBundle({ ...bundle, imageXorKey: 1.5 })).toThrow('Invalid account bundle')
    for (const imageAesKey of ['short', '0123456789abcde\n', 'z'.repeat(32)]) {
      expect(() => parseAccountConfigBundle({ ...bundle, imageAesKey })).toThrow('Invalid account bundle')
    }
    expect(parseAccountConfigPatch({ imageXorKey: 255, imageAesKey: '' }).patch).toEqual({ imageXorKey: 255, imageAesKey: '' })
    expect(parseAccountConfigPatch({ imageAesKey: '0123456789abcdef' }).patch.imageAesKey).toBe('0123456789abcdef')
    expect(() => parseAccountConfigPatch({ imageXorKey: 999 })).toThrow('Invalid account patch')
    expect(() => parseAccountConfigPatch({ imageXorKey: -1 })).toThrow('Invalid account patch')
    expect(() => parseAccountConfigPatch({ imageXorKey: 1.5 })).toThrow('Invalid account patch')
    expect(() => parseAccountConfigPatch({ imageAesKey: 'short' })).toThrow('Invalid account patch')
    expect(() => parseAccountConfigPatch({ imageAesKey: 'z'.repeat(32) })).toThrow('Invalid account patch')
    expect(() => parseAccountConfigPatch({ imageAesKey: '', extra: true })).toThrow('Invalid account patch')
  })

  it('classifies batch and timeout as general settings while endpoint, key, scope and policy are critical', () => {
    const current = { schemaVersion: 2 as const, pythonBaseUrl: 'http://127.0.0.1:8000/api/v1/open', managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 's', displayName: 'S' }] }, autoSend: true, ignoreOfficial: true, hasApiKey: true, batchWindowMs: 2000, requestTimeoutMs: 15000 }
    expect(isCriticalSettingsChange(current, { ...current, batchWindowMs: 2500, requestTimeoutMs: 30000 })).toBe(false)
    expect(isCriticalSettingsChange(current, { ...current, pythonBaseUrl: 'http://localhost:8000/api/v1/open' })).toBe(true)
    expect(isCriticalSettingsChange(current, { ...current, apiKeyDraft: 'replacement' })).toBe(true)
    expect(isCriticalSettingsChange(current, { ...current, managedScope: { mode: 'selected', conversations: [{ sessionId: 'other', displayName: 'Other' }] } })).toBe(true)
  })
})

describe('OmniMind v2 hosting settings contract', () => {
  it('normalizes loopback HTTP and remote HTTPS to one open API root', () => {
    expect(normalizeOmniMindBaseUrl('http://localhost:8000/')).toBe('http://localhost:8000/api/v1/open')
    expect(normalizeOmniMindBaseUrl('https://api.example.com/api/v1/open/')).toBe('https://api.example.com/api/v1/open')
    expect(() => normalizeOmniMindBaseUrl('http://192.168.1.20:8000')).toThrow()
    expect(() => normalizeOmniMindBaseUrl('https://user:pass@example.com')).toThrow()
    expect(() => normalizeOmniMindBaseUrl('https://api.example.com?key=x')).toThrow()
  })

  it('parses selected and all scopes without treating an empty list as all', () => {
    const selected = parseManagedScope({ mode: 'selected', conversations: [
      { sessionId: ' Alice ', displayName: 'Alice' }, { sessionId: 'alice', displayName: 'Duplicate' }
    ] })
    expect(selected).toEqual({ mode: 'selected', conversations: [{ sessionId: 'Alice', displayName: 'Alice' }] })
    expect(isManagedSession(selected, ' alice ')).toBe(true)
    expect(parseManagedScope({ mode: 'all', confirmedAt: 123 })).toEqual({ mode: 'all', confirmedAt: 123 })
    expect(() => parseManagedScope({ mode: 'selected', conversations: [] })).toThrow()
    expect(() => parseManagedScope({ mode: 'all' })).toThrow()
  })

  it('strictly parses v2 settings and preserves false booleans', () => {
    expect(parseSettingsPayload({
      schemaVersion: 2,
      pythonBaseUrl: 'https://api.example.com',
      managedScope: { mode: 'all', confirmedAt: 123 },
      autoSend: false,
      ignoreOfficial: false,
      batchWindowMs: 2000,
      requestTimeoutMs: 15000
    })).toMatchObject({ schemaVersion: 2, pythonBaseUrl: 'https://api.example.com/api/v1/open', autoSend: false, ignoreOfficial: false })
  })
})
