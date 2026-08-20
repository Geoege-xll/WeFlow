import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { Send, CornerDownLeft } from 'lucide-react'
import { omniMindZhCN } from './locale'
import { getOmniMindFailurePresentation } from './OmniMindQueueViewModel'
import { focusCurrentConversation, requestOmniMindSettings } from './recoveryActions'
import {
  getManualComposerState,
  resolveManualComposerAsSent,
  sendManualComposerText,
  subscribeManualComposerState,
  updateManualComposerState
} from './manualComposerStore'

export function OmniMindManualMessageComposer({ accountId = '', sessionId, recoveryActionScope = 'all' }: { accountId?: string; sessionId: string; recoveryActionScope?: 'all' | 'conversation-only' }) {
  const identity = useMemo(() => ({ accountId, sessionId }), [accountId, sessionId])
  const subscribe = useCallback((listener: () => void) => subscribeManualComposerState(identity, listener), [identity])
  const getSnapshot = useCallback(() => getManualComposerState(identity), [identity])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [composing, setComposing] = useState(false)
  const failure = state.failure ? getOmniMindFailurePresentation(state.failure.stage, state.failure.reason) : undefined
  // 普通聊天页只保留人工发送链路，因此仅展示会话检查和人工重试等会话内恢复动作；
  // “托管设置”与复用同一设置弹窗的权限入口都属于首页工作台，不能从聊天分区重新暴露。
  const visibleRecoveryActions = failure?.actions.filter((action) => (
    recoveryActionScope === 'all' || (action.kind !== 'hosting' && action.kind !== 'permissions')
  )) ?? []
  const send = async (): Promise<void> => {
    if (!state.text.trim() || state.sending || (failure?.uncertain && !state.resendConfirmed)) return
    const outcome = await sendManualComposerText(identity, window.electronAPI.omniMind.sendManual)
    if (outcome === 'capacity_reached') updateManualComposerState(identity, { recoveryAnnouncement: omniMindZhCN.composer.tooManyPending })
  }

  const isSendDisabled = !state.text.trim() || state.sending || Boolean(failure?.uncertain && !state.resendConfirmed)

  return <div className="omnimind-manual-composer">
    <div className="composer-container">
      <label htmlFor="omnimind-manual-text" className="composer-label">
        {omniMindZhCN.composer.label}
      </label>
      <div className={`composer-input-card ${state.sending ? 'is-sending' : ''}`}>
        <textarea
          id="omnimind-manual-text"
          className="composer-textarea"
          aria-describedby={failure ? 'omnimind-manual-failure' : undefined}
          value={state.text}
          readOnly={state.sending}
          placeholder={omniMindZhCN.composer.placeholder}
          onChange={(event) => { if (!state.sending) updateManualComposerState(identity, { text: event.target.value }) }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !composing && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-shortcuts">
            <span className="shortcut-tip">
              <CornerDownLeft size={11} className="shortcut-icon" />
              <span>Enter 发送 · Shift + Enter 换行</span>
            </span>
          </div>
          <button
            type="button"
            className={`composer-send-btn ${!isSendDisabled ? 'active' : ''}`}
            aria-describedby={failure?.uncertain ? 'omnimind-manual-failure' : undefined}
            disabled={isSendDisabled}
            onClick={() => void send()}
          >
            <Send size={12} className="send-icon" />
            <span>
              {state.sending ? omniMindZhCN.composer.waiting : failure?.uncertain && !state.resendConfirmed ? omniMindZhCN.actions.inspectBeforeSend : omniMindZhCN.actions.send}
            </span>
          </button>
        </div>
      </div>
    </div>
    {failure && <div id="omnimind-manual-failure" className={failure.uncertain ? 'omnimind-runtime-notice warning' : 'omnimind-queue-alert'} role="alert">
      <strong>{failure.fact}</strong>
      <p>{failure.nextStep}</p>
      <div className="omnimind-recovery-actions">{visibleRecoveryActions.map((action) => <button key={action.kind} type="button" onClick={(event) => {
        if (action.kind === 'retry') {
          void send()
          return
        }
        if (action.kind === 'conversation') {
          const focused = focusCurrentConversation()
          updateManualComposerState(identity, {
            conversationChecked: focused,
            recoveryAnnouncement: focused ? omniMindZhCN.recovery.conversationFocused : omniMindZhCN.recovery.conversationUnavailable
          })
        } else if (action.kind === 'hosting') {
          requestOmniMindSettings(event.currentTarget)
          updateManualComposerState(identity, { recoveryAnnouncement: omniMindZhCN.recovery.settingsOpened })
        } else if (action.kind === 'permissions' && action.permissionKind) {
          requestOmniMindSettings(event.currentTarget, action.permissionKind)
          updateManualComposerState(identity, { recoveryAnnouncement: failure.nextStep })
        } else {
          updateManualComposerState(identity, { recoveryAnnouncement: failure.nextStep })
        }
      }}>{action.label}</button>)}{failure.uncertain && <button type="button" onClick={() => {
        if (resolveManualComposerAsSent(identity)) updateManualComposerState(identity, { recoveryAnnouncement: omniMindZhCN.composer.sentResolved })
      }}>{omniMindZhCN.actions.confirmSentDiscard}</button>}</div>
      {failure.uncertain && state.conversationChecked && !state.resendConfirmed && <button className="omnimind-recovery-confirm" type="button" onClick={() => updateManualComposerState(identity, { resendConfirmed: true, recoveryAnnouncement: omniMindZhCN.composer.inspectedReady })}>{omniMindZhCN.composer.inspectedNotSent}</button>}
      <small>{omniMindZhCN.composer.preserved}</small>
    </div>}
    <span className="omnimind-sr-only" aria-live="polite">{state.recoveryAnnouncement}</span>
  </div>
}
