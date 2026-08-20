import { describe, expect, it } from 'vitest'
import {
  classifyOmniMindConversation,
  isHostableConversationKind,
  managedSessionIdentity,
  parseManagedScope
} from '../../shared/omnimind/conversation-domain'
import {
  OMNIMIND_SETTING_RANGES,
  OMNIMIND_SETTINGS_DEFAULTS,
  createOmniMindSettingsDraft,
  diffOmniMindSettings,
  getOmniMindEndpointProtocol,
  parseOmniMindTimings,
  parsePersistedOmniMindSettings,
  parseSettingsPayload,
  toOmniMindSettingsInput,
  validateOmniMindSettingsDraft
} from '../../shared/omnimind/settings-domain'

const settings = {
  schemaVersion: 4 as const,
  pythonBaseUrl: OMNIMIND_SETTINGS_DEFAULTS.pythonBaseUrl,
  managedScope: { mode: 'selected' as const, conversations: [{ sessionId: 'Alice', displayName: 'Alice' }] },
  autoSend: true,
  hasApiKey: true,
  batchWindowMs: OMNIMIND_SETTINGS_DEFAULTS.batchWindowMs
}

describe('OmniMind settings domain', () => {
  it('owns defaults, aggregation boundaries and endpoint facts without exposing a model timeout', () => {
    expect(OMNIMIND_SETTINGS_DEFAULTS).toMatchObject({ batchWindowMs: 2000 })
    expect(OMNIMIND_SETTINGS_DEFAULTS).not.toHaveProperty('requestTimeoutMs')
    expect(OMNIMIND_SETTINGS_DEFAULTS).not.toHaveProperty('ignoreOfficial')
    expect(OMNIMIND_SETTING_RANGES).not.toHaveProperty('requestTimeoutMs')
    expect(parseOmniMindTimings(OMNIMIND_SETTING_RANGES.batchWindowMs.min)).toEqual({ batchWindowMs: 500 })
    expect(() => parseOmniMindTimings(499)).toThrow('Invalid settings payload')
    expect(getOmniMindEndpointProtocol('http://localhost:8000')).toBe('HTTP')
    expect(getOmniMindEndpointProtocol('https://api.example.com')).toBe('HTTPS')
  })

  it('strictly parses renderer and persisted settings through the same core rules', () => {
    const payload = {
      schemaVersion: 4,
      pythonBaseUrl: 'https://api.example.com',
      managedScope: { mode: 'selected', conversations: [{ sessionId: ' Alice ', displayName: ' Alice ' }] },
      autoSend: false,
      batchWindowMs: 2500
    }
    const renderer = parseSettingsPayload(payload)
    const persisted = parsePersistedOmniMindSettings(payload)
    expect(renderer).toEqual(persisted)
    expect(renderer).toMatchObject({ pythonBaseUrl: 'https://api.example.com/api/v1/open', managedScope: { conversations: [{ sessionId: 'Alice', displayName: 'Alice' }] } })
    expect(() => parseSettingsPayload({ ...payload, unknown: true })).toThrow()
    expect(() => parseSettingsPayload({ ...payload, ignoreOfficial: true })).toThrow()
    expect(() => parseSettingsPayload({ ...payload, ignoreOfficial: false })).toThrow()
    // 当前 Renderer/IPC/持久化合同对旧超时字段严格 fail closed，只有 Store 迁移器能读取 v3。
    expect(() => parsePersistedOmniMindSettings({ ...payload, requestTimeoutMs: 30_000 })).toThrow()
    expect(() => parseSettingsPayload({ ...payload, requestTimeoutMs: 30_000 })).toThrow()
  })

  it('allows only the explicit migration empty scope while ordinary saves remain fail closed', () => {
    const empty = {
      schemaVersion: 4,
      pythonBaseUrl: 'http://127.0.0.1:8000',
      managedScope: { mode: 'selected', conversations: [] },
      autoSend: true,
      batchWindowMs: 2000
    }
    expect(() => parseSettingsPayload(empty)).toThrow()
    expect(() => parsePersistedOmniMindSettings(empty)).toThrow()
    expect(parsePersistedOmniMindSettings(empty, { allowEmptySelected: true }).managedScope).toEqual({ mode: 'selected', conversations: [] })
    // 清除 Key 是独立 IPC 命令；普通保存即使携带 true 也必须按未知字段拒绝。
    expect(() => parseSettingsPayload({ ...empty, clearApiKey: true })).toThrow('Invalid settings payload')
  })

  it('computes semantic draft diff and critical changes without JSON or display-order coupling', () => {
    const draft = createOmniMindSettingsDraft(settings)
    draft.managedScope = { mode: 'selected', conversations: [{ sessionId: 'alice', displayName: 'Renamed' }] }
    expect(diffOmniMindSettings(settings, draft)).toMatchObject({ dirty: false, critical: false, managedScope: false })

    draft.autoSend = false
    expect(diffOmniMindSettings(settings, draft)).toMatchObject({ dirty: true, critical: false, autoSend: true })
    draft.apiKeyDraft = 'replacement'
    expect(diffOmniMindSettings(settings, draft)).toMatchObject({ dirty: true, critical: true, apiKey: true })

    const allSettings = { ...settings, managedScope: { mode: 'all' as const, confirmedAt: 123 } }
    const unconfirmedAll = createOmniMindSettingsDraft(allSettings)
    unconfirmedAll.managedScope = { mode: 'all', confirmedAt: 0 }
    expect(diffOmniMindSettings(allSettings, unconfirmedAll)).toMatchObject({ dirty: true, critical: true, managedScope: true })
  })

  it('validates scope, official policy, timings and normalized save input centrally', () => {
    const draft = createOmniMindSettingsDraft(settings)
    draft.managedScope = { mode: 'selected', conversations: [{ sessionId: 'gh_service', displayName: 'Service' }] }
    expect(validateOmniMindSettingsDraft(draft).map((issue) => issue.code)).toContain('official_scope_conflict')
    expect(() => toOmniMindSettingsInput(draft)).not.toThrow()
    expect(() => parseSettingsPayload(toOmniMindSettingsInput(draft))).toThrow()

    draft.managedScope = { mode: 'all', confirmedAt: 0 }
    draft.batchWindowMs = Number.NaN
    expect(validateOmniMindSettingsDraft(draft).map((issue) => issue.code)).toEqual(expect.arrayContaining(['unconfirmed_all_scope', 'invalid_timing']))
  })
})

describe('OmniMind conversation domain', () => {
  it('normalizes identity and classifies stable WeChat session identifiers', () => {
    expect(managedSessionIdentity(' Alice ')).toBe('alice')
    expect(classifyOmniMindConversation('ROOM@CHATROOM')).toBe('group')
    expect(classifyOmniMindConversation('GH_Service')).toBe('official')
    expect(classifyOmniMindConversation('session-only-private')).toBe('private')
    expect(classifyOmniMindConversation('placeholder_foldgroup_1')).toBe('other')
    expect(isHostableConversationKind('private')).toBe(true)
    expect(isHostableConversationKind('group')).toBe(true)
    expect(isHostableConversationKind('official')).toBe(false)
    expect(isHostableConversationKind('other')).toBe(false)
  })

  it('deduplicates selected scope case-insensitively while retaining the first stable id', () => {
    expect(parseManagedScope({ mode: 'selected', conversations: [
      { sessionId: 'Room@Chatroom', displayName: 'Room' },
      { sessionId: 'room@chatroom', displayName: 'Duplicate' }
    ] })).toEqual({ mode: 'selected', conversations: [{ sessionId: 'Room@Chatroom', displayName: 'Room' }] })
  })
})
