import type { OmniMindFailureStage, OmniMindPermissionKind, OmniMindSnapshot, OmniMindTaskSummary } from '../../../shared/omnimind/contracts'
import { omniMindZhCN } from './locale'

export type OmniMindRecoveryActionKind = 'retry' | 'help' | 'conversation' | 'hosting' | 'permissions'
export interface OmniMindRecoveryAction { kind: OmniMindRecoveryActionKind; label: string; permissionKind?: OmniMindPermissionKind }
export interface OmniMindFailurePresentation { status: string; fact: string; nextStep: string; actions: OmniMindRecoveryAction[]; canRetry: boolean; uncertain: boolean }
export interface OmniMindTaskViewModel extends OmniMindTaskSummary { statusLabel: string; canCancel: boolean; canRetry: boolean; canReview: boolean; hasGeneratedReply: boolean; failure?: OmniMindFailurePresentation }
export interface OmniMindQueueViewModel { runtimeState: OmniMindSnapshot['runtimeState']; current?: OmniMindTaskViewModel; waiting: OmniMindTaskViewModel[]; awaiting: OmniMindTaskViewModel[]; recent: OmniMindTaskViewModel[] }

type FailureCopy = { status: string; fact: string; nextStep: string; action: string }
const failurePresentation = (copy: FailureCopy, kind: OmniMindRecoveryActionKind, canRetry: boolean, uncertain: boolean): OmniMindFailurePresentation => ({
  status: copy.status,
  fact: copy.fact,
  nextStep: copy.nextStep,
  actions: [{ kind, label: copy.action }],
  canRetry,
  uncertain
})

const permissionFailurePresentation = (copy: FailureCopy, permissionKind: OmniMindPermissionKind): OmniMindFailurePresentation => ({
  status: copy.status,
  fact: copy.fact,
  nextStep: copy.nextStep,
  actions: [{ kind: 'permissions', label: copy.action, permissionKind }],
  canRetry: false,
  uncertain: false
})

export const getOmniMindFailurePresentation = (stage?: OmniMindFailureStage, reason?: string): OmniMindFailurePresentation => {
  if (stage === 'verification_baseline' && reason === 'verification_baseline_failed') return failurePresentation(omniMindZhCN.failure.verificationBaseline, 'retry', true, false)
  if (reason === 'accessibility_permission_denied') return permissionFailurePresentation(omniMindZhCN.failure.accessibility, 'accessibility')
  if (reason === 'automation_permission_denied') return permissionFailurePresentation(omniMindZhCN.failure.automationPermission, 'automation')
  if (stage === 'automation' && reason === 'target_ambiguous') return failurePresentation(omniMindZhCN.failure.targetAmbiguous, 'help', false, false)
  if (stage === 'automation' && reason === 'target_mismatch') return failurePresentation(omniMindZhCN.failure.targetMismatch, 'help', false, false)
  if (stage === 'automation' && reason === 'input_unavailable') return failurePresentation(omniMindZhCN.failure.inputUnavailable, 'help', false, false)
  if (stage === 'automation' && reason === 'automation_timeout') return failurePresentation(omniMindZhCN.failure.automationTimeout, 'conversation', false, true)
  if (stage === 'verification_postsend' && ['outbound_not_verified', 'verification_read_failed', 'verification_unbounded'].includes(reason ?? '')) return failurePresentation(omniMindZhCN.failure.deliveryUnconfirmed, 'conversation', false, true)
  const unknown = failurePresentation(omniMindZhCN.failure.unknown, 'conversation', false, true)
  return { ...unknown, actions: [...unknown.actions, { kind: 'hosting', label: omniMindZhCN.actions.inspectHosting }] }
}

const mapTask = (task: OmniMindTaskSummary): OmniMindTaskViewModel => {
  const failure = ['send_failed', 'delivery_unconfirmed'].includes(task.status)
    ? getOmniMindFailurePresentation(task.failureStage, task.reason)
    : undefined
  return {
    ...task,
    statusLabel: failure?.status ?? omniMindZhCN.taskStatus[task.status],
    canCancel: ['queued', 'generating', 'waiting_to_send'].includes(task.status),
    canRetry: task.status === 'generation_failed' || Boolean(failure?.canRetry),
    canReview: task.status === 'awaiting_manual_send',
    hasGeneratedReply: ['awaiting_manual_send', 'send_failed', 'delivery_unconfirmed'].includes(task.status) && Boolean(task.replyText),
    failure
  }
}

export const buildQueueViewModel = (snapshot: OmniMindSnapshot): OmniMindQueueViewModel => ({
  runtimeState: snapshot.runtimeState,
  current: snapshot.current ? mapTask(snapshot.current) : undefined,
  waiting: snapshot.waiting.map(mapTask),
  awaiting: (snapshot.awaitingManualSend ?? []).map(mapTask),
  recent: snapshot.recent.map(mapTask)
})
