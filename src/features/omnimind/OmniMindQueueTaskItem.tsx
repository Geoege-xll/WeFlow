import { useRef, useState } from 'react'
import { CircleDot } from 'lucide-react'
import type { OmniMindRecoveryAction, OmniMindTaskViewModel } from './OmniMindQueueViewModel'
import { omniMindZhCN } from './locale'

export function OmniMindQueueTaskItem({ task, onCancel, onRetry, onSend, onAbandon, onInspectConversation = () => undefined, onOpenHostingSettings = () => undefined }: { task: OmniMindTaskViewModel; onCancel: (id: string) => void | Promise<void>; onRetry: (id: string) => void | Promise<void>; onSend: (id: string) => Promise<{ success: boolean; error?: string }>; onAbandon: (id: string) => void | Promise<void>; onInspectConversation?: (sessionId: string) => void; onOpenHostingSettings?: (opener?: HTMLElement, permissionKind?: 'accessibility' | 'automation') => void }) {
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string>()
  const [recoveryAnnouncement, setRecoveryAnnouncement] = useState('')
  const failureRef = useRef<HTMLDivElement>(null)
  const run = async (command: (id: string) => unknown | Promise<unknown>): Promise<unknown> => {
    if (busy) return
    setBusy(true); setError(undefined)
    try { return await command(task.id) } catch { setError(omniMindZhCN.taskCommandFailed) } finally { setBusy(false) }
  }
  const send = async (): Promise<void> => {
    const result = await run(onSend) as { success?: boolean; error?: string } | undefined
    if (result?.error === 'stale_reply_confirmation_required') setError(omniMindZhCN.queue.staleConfirm)
    else if (result && !result.success) setError(omniMindZhCN.taskCommandFailed)
  }
  const abandon = (): void => { if (window.confirm(omniMindZhCN.queue.abandonConfirm)) void run(onAbandon) }
  const recover = (action: OmniMindRecoveryAction, opener: HTMLButtonElement): void => {
    if (action.kind === 'retry') { void run(onRetry); return }
    if (action.kind === 'conversation') onInspectConversation(task.sessionId)
    else if (action.kind === 'hosting') onOpenHostingSettings(opener)
    else if (action.kind === 'permissions' && action.permissionKind) onOpenHostingSettings(opener, action.permissionKind)
    else failureRef.current?.focus()
    setRecoveryAnnouncement(action.kind === 'help' || action.kind === 'permissions' ? task.failure?.nextStep ?? '' : action.label)
  }
  return <article className={`omnimind-task status-${task.status}`} aria-label={`${task.sessionName} ${task.statusLabel}`}>
    <div className="omnimind-task-heading"><strong title={task.sessionName}>{task.sessionName}</strong><span><CircleDot className="omnimind-status-icon" size={16} aria-hidden="true" />{task.statusLabel}</span></div>
    {task.hasGeneratedReply && task.replyText ? <><p className={expanded ? undefined : 'omnimind-reply-preview'}>{task.replyText}</p><button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? omniMindZhCN.queue.collapse : omniMindZhCN.queue.expand}</button>{Boolean(task.newMessagesSinceGenerated) && <p className="omnimind-warning">{omniMindZhCN.queue.stale} · {task.newMessagesSinceGenerated}</p>}</> : !task.failure && <p>{task.reason ? (omniMindZhCN.taskReason[task.reason] || task.statusLabel) : omniMindZhCN.taskType}</p>}
    {task.failure && <div ref={failureRef} tabIndex={-1} className={task.failure.uncertain ? 'omnimind-runtime-notice warning' : 'omnimind-queue-alert'} role="status">
      <strong>{task.failure.fact}</strong>
      <p>{task.failure.nextStep}</p>
      <div className="omnimind-recovery-actions">{task.failure.actions.map((action) => <button key={action.kind} type="button" disabled={busy} onClick={(event) => recover(action, event.currentTarget)}>{action.label}</button>)}</div>
    </div>}
    <span className="omnimind-sr-only" aria-live="polite">{recoveryAnnouncement}</span>
    <time dateTime={new Date(task.generatedAt ?? task.updatedAt).toISOString()}>{task.hasGeneratedReply ? `${omniMindZhCN.queue.generatedAt} ` : ''}{new Date(task.generatedAt ?? task.updatedAt).toLocaleTimeString(omniMindZhCN.locale, { hour: '2-digit', minute: '2-digit' })}</time>
    {task.canCancel && <button type="button" disabled={busy} aria-busy={busy} onClick={() => void run(onCancel)}>{omniMindZhCN.actions.cancel}</button>}
    {task.canRetry && !task.failure && <button type="button" disabled={busy} aria-busy={busy} onClick={() => void run(onRetry)}>{omniMindZhCN.actions.retry}</button>}
    {task.canReview && <div className="omnimind-review-actions"><button type="button" disabled={busy} onClick={abandon}>{omniMindZhCN.actions.abandon}</button><button type="button" disabled={busy} aria-busy={busy} onClick={() => void send()}>{omniMindZhCN.actions.send}</button></div>}
    {error && <p role="alert">{error}</p>}
  </article>
}
