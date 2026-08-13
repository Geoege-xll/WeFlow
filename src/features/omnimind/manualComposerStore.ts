import type { OmniMindFailureStage, OmniMindSendResult } from '../../../shared/omnimind/contracts'
import { getOmniMindFailurePresentation } from './OmniMindQueueViewModel'

export interface ManualComposerIdentity { accountId: string; sessionId: string }
export interface ManualComposerFailure { stage?: OmniMindFailureStage; reason?: string }
export interface ManualComposerSessionState {
  text: string
  sending: boolean
  failure?: ManualComposerFailure
  conversationChecked: boolean
  resendConfirmed: boolean
  recoveryAnnouncement: string
}

interface SessionEntry {
  state: ManualComposerSessionState
  listeners: Set<() => void>
  transaction?: symbol
  touchedAt: number
}

const MAX_RETAINED_SESSIONS = 24
const MAX_IN_FLIGHT_SENDS = 4
const sessions = new Map<string, SessionEntry>()
const activeTransactions = new Set<symbol>()
const keyFor = ({ accountId, sessionId }: ManualComposerIdentity): string => `${accountId.length}:${accountId}${sessionId}`
const emptyState = (): ManualComposerSessionState => ({ text: '', sending: false, conversationChecked: false, resendConfirmed: false, recoveryAnnouncement: '' })

const entryFor = (identity: ManualComposerIdentity): SessionEntry => {
  const key = keyFor(identity)
  const existing = sessions.get(key)
  if (existing) { existing.touchedAt = Date.now(); return existing }
  const created = { state: emptyState(), listeners: new Set<() => void>(), touchedAt: Date.now() }
  sessions.set(key, created)
  return created
}

const prune = (): void => {
  if (sessions.size <= MAX_RETAINED_SESSIONS) return
  const removable = [...sessions.entries()]
    .filter(([, entry]) => {
      const failure = entry.state.failure
      const unresolvedUncertain = Boolean(failure && !entry.state.resendConfirmed && getOmniMindFailurePresentation(failure.stage, failure.reason).uncertain)
      return !entry.state.sending && !unresolvedUncertain && entry.listeners.size === 0
    })
    .sort((left, right) => left[1].touchedAt - right[1].touchedAt)
  while (sessions.size > MAX_RETAINED_SESSIONS && removable.length) sessions.delete(removable.shift()![0])
}

const applyState = (entry: SessionEntry, patch: Partial<ManualComposerSessionState>, suppressListenerErrors = false): void => {
  entry.state = { ...entry.state, ...patch }
  entry.touchedAt = Date.now()
  if (suppressListenerErrors) {
    for (const listener of entry.listeners) { try { listener() } catch { /* state cleanup must remain deterministic */ } }
  } else {
    entry.listeners.forEach((listener) => listener())
  }
  prune()
}

export const getManualComposerState = (identity: ManualComposerIdentity): ManualComposerSessionState => entryFor(identity).state

export const subscribeManualComposerState = (identity: ManualComposerIdentity, listener: () => void): (() => void) => {
  const entry = entryFor(identity)
  entry.listeners.add(listener)
  return () => { entry.listeners.delete(listener); prune() }
}

export const updateManualComposerState = (identity: ManualComposerIdentity, patch: Partial<ManualComposerSessionState>): void => {
  applyState(entryFor(identity), patch)
}

export const resolveManualComposerAsSent = (identity: ManualComposerIdentity): boolean => {
  const entry = entryFor(identity)
  const failure = entry.state.failure
  if (!failure || !getOmniMindFailurePresentation(failure.stage, failure.reason).uncertain || entry.state.sending) return false
  applyState(entry, { text: '', failure: undefined, conversationChecked: false, resendConfirmed: false, recoveryAnnouncement: '' })
  return true
}

export const sendManualComposerText = async (
  identity: ManualComposerIdentity,
  sendManual: (payload: { sessionId: string; text: string }) => Promise<OmniMindSendResult>
): Promise<'started' | 'ignored' | 'capacity_reached'> => {
  const entry = entryFor(identity)
  const text = entry.state.text
  if (!text.trim() || entry.state.sending) return 'ignored'
  if (activeTransactions.size >= MAX_IN_FLIGHT_SENDS) return 'capacity_reached'
  const transaction = Symbol()
  entry.transaction = transaction
  activeTransactions.add(transaction)
  try {
    updateManualComposerState(identity, { sending: true, failure: undefined })
    const result = await sendManual({ sessionId: identity.sessionId, text })
    const current = sessions.get(keyFor(identity))
    if (!current || current.transaction !== transaction) return 'started'
    applyState(current, result.success
      ? { text: '', failure: undefined, conversationChecked: false, resendConfirmed: false }
      : { failure: { stage: result.stage, reason: result.error }, conversationChecked: false, resendConfirmed: false }, true)
  } catch {
    const current = sessions.get(keyFor(identity))
    if (current?.transaction === transaction) applyState(current, { failure: {}, conversationChecked: false, resendConfirmed: false }, true)
  } finally {
    activeTransactions.delete(transaction)
    const current = sessions.get(keyFor(identity))
    if (current?.transaction === transaction) {
      current.transaction = undefined
      applyState(current, { sending: false }, true)
    }
  }
  return 'started'
}

export const resetManualComposerStoreForTests = (): void => { sessions.clear(); activeTransactions.clear() }
