import type { OmniMindFailureStage, OmniMindPermissionKind, OmniMindSnapshot, OmniMindTaskSummary } from '../../../shared/omnimind/contracts'
import { omniMindZhCN } from './locale'

export type OmniMindRecoveryActionKind = 'retry' | 'help' | 'conversation' | 'hosting' | 'permissions'
export interface OmniMindRecoveryAction { kind: OmniMindRecoveryActionKind; label: string; permissionKind?: OmniMindPermissionKind }
export interface OmniMindFailurePresentation { status: string; fact: string; nextStep: string; actions: OmniMindRecoveryAction[]; canRetry: boolean; uncertain: boolean }
export interface OmniMindTaskViewModel extends OmniMindTaskSummary { statusLabel: string; canCancel: boolean; canRetry: boolean; canReview: boolean; canConfirmDelivery: boolean; hasGeneratedReply: boolean; failure?: OmniMindFailurePresentation }
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
  // 生成失败必须在 Renderer 中保留主进程给出的稳定 reason，不展示原始 Error、响应正文或用户消息。
  // timeout 是执行结果不确定状态，只引导检查会话，不构造 retry 动作。
  if (stage === 'generation' && reason === 'timeout') return failurePresentation(omniMindZhCN.failure.generationTimeout, 'conversation', false, true)
  if (stage === 'generation' && reason === 'auth') return failurePresentation(omniMindZhCN.failure.generationAuth, 'retry', true, false)
  if (stage === 'generation' && reason === 'network') return failurePresentation(omniMindZhCN.failure.generationNetwork, 'retry', true, false)
  if (stage === 'generation' && reason === 'malformed') return failurePresentation(omniMindZhCN.failure.generationMalformed, 'retry', true, false)
  if (stage === 'generation' && reason === 'empty') return failurePresentation(omniMindZhCN.failure.generationEmpty, 'retry', true, false)
  if (stage === 'generation' && reason === 'handoff') return failurePresentation(omniMindZhCN.failure.generationHandoff, 'conversation', false, false)
  if (stage === 'generation' && reason === 'generation_exception') return failurePresentation(omniMindZhCN.failure.generationException, 'retry', true, false)
  if (stage === 'verification_baseline' && reason === 'verification_baseline_failed') return failurePresentation(omniMindZhCN.failure.verificationBaseline, 'retry', true, false)
  if (reason === 'accessibility_permission_denied') return permissionFailurePresentation(omniMindZhCN.failure.accessibility, 'accessibility')
  if (reason === 'automation_permission_denied') return permissionFailurePresentation(omniMindZhCN.failure.automationPermission, 'automation')
  // TCC 权限拒绝只由主进程根据原生 -25211/assistive access 证据产生；
  // 其余 AX 控件定位或操作失败必须落到可恢复的微信 UI 文案，不能误导用户去授权。
  if (stage === 'automation' && reason === 'wechat_process_unavailable') return failurePresentation(omniMindZhCN.failure.wechatProcessUnavailable, 'conversation', false, false)
  if (stage === 'automation' && reason === 'wechat_window_unavailable') return failurePresentation(omniMindZhCN.failure.wechatWindowUnavailable, 'conversation', false, false)
  if (stage === 'automation' && reason === 'search_open_failed') return failurePresentation(omniMindZhCN.failure.searchOpenFailed, 'conversation', false, false)
  if (stage === 'automation' && reason === 'search_field_unavailable') return failurePresentation(omniMindZhCN.failure.searchFieldUnavailable, 'conversation', false, false)
  if (stage === 'automation' && reason === 'search_field_ambiguous') return failurePresentation(omniMindZhCN.failure.searchFieldAmbiguous, 'conversation', false, false)
  if (stage === 'automation' && reason === 'search_input_failed') return failurePresentation(omniMindZhCN.failure.searchInputFailed, 'conversation', false, false)
  if (stage === 'automation' && reason === 'search_result_click_failed') return failurePresentation(omniMindZhCN.failure.searchResultClickFailed, 'conversation', false, false)
  if (stage === 'automation' && reason === 'target_ambiguous') return failurePresentation(omniMindZhCN.failure.targetAmbiguous, 'help', false, false)
  if (stage === 'automation' && reason === 'target_mismatch') return failurePresentation(omniMindZhCN.failure.targetMismatch, 'help', false, false)
  if (stage === 'automation' && reason === 'input_unavailable') return failurePresentation(omniMindZhCN.failure.inputUnavailable, 'help', false, false)
  if (stage === 'automation' && reason === 'input_ambiguous') return failurePresentation(omniMindZhCN.failure.inputUnavailable, 'conversation', false, false)
  if (stage === 'automation' && reason === 'input_click_failed') return failurePresentation(omniMindZhCN.failure.inputClickFailed, 'conversation', false, false)
  if (stage === 'automation' && reason === 'input_paste_failed') return failurePresentation(omniMindZhCN.failure.inputPasteFailed, 'conversation', false, false)
  if (stage === 'automation' && reason === 'input_submit_failed') return failurePresentation(omniMindZhCN.failure.inputSubmitFailed, 'conversation', false, false)
  if (stage === 'automation' && reason === 'automation_timeout') return failurePresentation(omniMindZhCN.failure.automationTimeout, 'conversation', false, true)
  if (stage === 'verification_postsend' && ['outbound_not_verified', 'verification_read_failed', 'verification_unbounded'].includes(reason ?? '')) return failurePresentation(omniMindZhCN.failure.deliveryUnconfirmed, 'conversation', false, true)
  const unknown = failurePresentation(omniMindZhCN.failure.unknown, 'conversation', false, true)
  return { ...unknown, actions: [...unknown.actions, { kind: 'hosting', label: omniMindZhCN.actions.inspectHosting }] }
}

const mapTask = (task: OmniMindTaskSummary): OmniMindTaskViewModel => {
  const failure = ['generation_failed', 'send_failed', 'delivery_unconfirmed'].includes(task.status)
    ? getOmniMindFailurePresentation(task.failureStage, task.reason)
    : undefined
  return {
    ...task,
    statusLabel: failure?.status ?? omniMindZhCN.taskStatus[task.status],
    canCancel: ['queued', 'generating', 'waiting_to_send'].includes(task.status),
    canRetry: Boolean(failure?.canRetry),
    canReview: task.status === 'awaiting_manual_send',
    // “确认送达”不是重试能力，只对投递结果不确定的终态开放。
    canConfirmDelivery: task.status === 'delivery_unconfirmed',
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
