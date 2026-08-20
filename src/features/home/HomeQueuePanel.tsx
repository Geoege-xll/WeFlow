import { Activity, Clock, Inbox, ListTodo, UserCheck } from 'lucide-react'
import type { OmniMindPermissionKind } from '../../../shared/omnimind/contracts'
import type { OmniMindRuntimePresentation } from '../omnimind/OmniMindHostingHeader'
import type { OmniMindQueueViewModel } from '../omnimind/OmniMindQueueViewModel'
import { OmniMindQueueTaskItem } from '../omnimind/OmniMindQueueTaskItem'
import '../omnimind/omnimind.scss'

interface QueueTaskActions {
  onCancel: (id: string) => void | Promise<void>
  onRetry: (id: string) => void | Promise<void>
  onSend: (id: string) => Promise<{ success: boolean; error?: string }>
  onAbandon: (id: string) => void | Promise<void>
  onConfirmDelivery: (id: string) => void | Promise<void>
  onInspectConversation: (sessionId: string) => void
  onOpenHostingSettings: (opener?: HTMLElement, kind?: OmniMindPermissionKind) => void
}

/**
 * 首页右侧的持续队列视图。
 *
 * 本组件只接收 HomeWorkbench 已经构建的同一份 view model，不自行调用 useOmniMind，
 * 从结构上保证控制区和队列不会各自建立运行时订阅。队列没有关闭或折叠入口；
 * 所有任务动作继续复用现有 OmniMindQueueTaskItem 的审核、确认与恢复规则。
 */
export function HomeQueuePanel({
  view,
  loading,
  summary,
  runtime,
  actions
}: {
  view: OmniMindQueueViewModel
  loading: boolean
  summary: string
  runtime: OmniMindRuntimePresentation
  actions: QueueTaskActions
}) {
  return (
    <aside className={`home-zone home-queue-zone runtime-${view.runtimeState}`} aria-labelledby="home-queue-title">
      <header className="home-queue-header">
        <div className="home-queue-header-top">
          <span className={`home-queue-badge-category ${view.runtimeState === 'running' ? 'active' : ''}`}>
            <span className={`home-queue-status-dot ${view.runtimeState === 'running' ? 'active' : ''}`} aria-hidden="true" />
            自动托管
          </span>
          <span className={`home-queue-summary-pill ${summary.includes('失败') ? 'has-failures' : ''}`}>{summary}</span>
        </div>
        <div className="home-queue-title-row">
          <div className="home-queue-title-icon">
            <ListTodo size={16} aria-hidden="true" />
          </div>
          <h1 id="home-queue-title">全局串行队列</h1>
        </div>
      </header>

      <div className="home-queue-metrics" aria-label="队列数量">
        <div className={`home-metric-card metric-current ${view.current ? 'has-current' : ''}`} aria-label={`当前 ${view.current ? 1 : 0}`}>
          <div className="metric-header">
            <Activity size={13} className="metric-icon" aria-hidden="true" />
            <span>当前</span>
          </div>
          <strong>{view.current ? 1 : 0}</strong>
        </div>
        <div className="home-metric-card metric-waiting" aria-label={`等待 ${view.waiting.length}`}>
          <div className="metric-header">
            <Clock size={13} className="metric-icon" aria-hidden="true" />
            <span>等待</span>
          </div>
          <strong>{view.waiting.length}</strong>
        </div>
        <div className={`home-metric-card metric-awaiting ${view.awaiting.length > 0 ? 'has-items' : ''}`} aria-label={`待确认 ${view.awaiting.length}`}>
          <div className="metric-header">
            <UserCheck size={13} className="metric-icon" aria-hidden="true" />
            <span>待确认</span>
          </div>
          <strong>{view.awaiting.length}</strong>
        </div>
      </div>

      <div className="home-queue-scroll" aria-live="polite">
        {loading && <div className="home-queue-empty">正在读取真实队列…</div>}
        {!loading && view.current && (
          <section className="home-queue-section">
            <h2>
              <span className="section-dot current" aria-hidden="true" />
              当前任务 · 1
            </h2>
            <OmniMindQueueTaskItem task={view.current} {...actions} />
          </section>
        )}
        {!loading && view.awaiting.length > 0 && (
          <section className="home-queue-section">
            <h2>
              <span className="section-dot awaiting" aria-hidden="true" />
              等待你发送 · {view.awaiting.length}
            </h2>
            {view.awaiting.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} {...actions} />)}
          </section>
        )}
        {!loading && view.waiting.length > 0 && (
          <section className="home-queue-section">
            <h2>
              <span className="section-dot waiting" aria-hidden="true" />
              等待队列 · {view.waiting.length}
            </h2>
            {view.waiting.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} {...actions} />)}
          </section>
        )}
        {!loading && view.recent.length > 0 && (
          <section className="home-queue-section">
            <h2>
              <span className="section-dot recent" aria-hidden="true" />
              最近结果 · {view.recent.length}
            </h2>
            {view.recent.map((task) => <OmniMindQueueTaskItem key={task.id} task={task} {...actions} />)}
          </section>
        )}
        {!loading && !view.current && view.waiting.length === 0 && view.awaiting.length === 0 && view.recent.length === 0 && (
          <div className="home-queue-empty">
            <div className="home-queue-empty-icon-wrap">
              <Inbox size={26} className="empty-icon" aria-hidden="true" />
            </div>
            <div className="home-queue-empty-text">
              <strong>{runtime.emptyText ?? '当前没有队列任务'}</strong>
              <p>新消息到达后将按串行规则自动进入处理队列</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
