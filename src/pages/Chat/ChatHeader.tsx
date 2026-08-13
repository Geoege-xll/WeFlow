import React, { useEffect, useRef, useState } from 'react'
import {
  Aperture,
  BarChart3,
  Calendar,
  Download,
  Image as ImageIcon,
  Info,
  Loader2,
  ListTodo,
  Mic,
  MoreHorizontal,
  Newspaper,
  RefreshCw,
  Search,
  Sparkles,
  Users
} from 'lucide-react'
import { Avatar } from '../../components/Avatar'
import type { ChatSession } from '../../types/models'
import type { BatchVoiceTaskType } from '../../stores/batchTranscribeStore'
import { displayNameOrFallback } from '../../utils/displayName'
import { useDetailChromeRegistration } from '../../components/common/DetailChromeContext'

export interface ChatHeaderProps {
  session: ChatSession
  isGroupChat: boolean
  standaloneSessionWindow: boolean
  showGroupMembersPanel: boolean
  showGroupSummaryPanel: boolean
  showJumpPopover: boolean
  showInSessionSearch: boolean
  showDetailPanel: boolean
  showQueueDrawer?: boolean
  isHostingActive?: boolean
  aiGroupSummaryEnabled: boolean
  shouldHideStandaloneDetailButton: boolean
  isPrivateSnsSupported: boolean
  isExportActionBusy: boolean
  isCurrentSessionExporting: boolean
  isPreparingExportDialog: boolean
  isBatchTranscribing: boolean
  runningBatchVoiceTaskType?: BatchVoiceTaskType
  batchVoiceProgress?: { current: number; total: number }
  isBatchDecrypting: boolean
  batchImageDecryptProgress?: { current: number; total: number }
  isTriggeringSessionInsight: boolean
  isRefreshingMessages: boolean
  isLoadingMessages: boolean
  currentSessionId?: string | null
  compactHeader: boolean
  jumpCalendarWrapRef: React.RefObject<HTMLDivElement | null>
  onTriggerSessionInsight: () => void
  onToggleGroupSummaryPanel: (trigger?: HTMLButtonElement) => void
  onGroupAnalytics: () => void
  onToggleGroupMembersPanel: (trigger?: HTMLButtonElement) => void
  onExportCurrentSession: () => void
  onOpenSnsTimeline: () => void
  onBatchTranscribe: () => void
  onBatchDecrypt: () => void
  onToggleJumpPopover: () => void
  onToggleInSessionSearch: () => void
  onRefreshMessages: () => void
  onToggleDetailPanel: (trigger?: HTMLButtonElement) => void
  onToggleQueueDrawer?: () => void
  onOpenHostingModal?: () => void
}

function ChatHeader({
  session,
  isGroupChat,
  standaloneSessionWindow,
  showGroupMembersPanel,
  showGroupSummaryPanel,
  showJumpPopover,
  showInSessionSearch,
  showDetailPanel,
  showQueueDrawer,
  isHostingActive,
  aiGroupSummaryEnabled,
  shouldHideStandaloneDetailButton,
  isPrivateSnsSupported,
  isExportActionBusy,
  isCurrentSessionExporting,
  isPreparingExportDialog,
  isBatchTranscribing,
  runningBatchVoiceTaskType,
  batchVoiceProgress,
  isBatchDecrypting,
  batchImageDecryptProgress,
  isTriggeringSessionInsight,
  isRefreshingMessages,
  isLoadingMessages,
  currentSessionId,
  compactHeader,
  jumpCalendarWrapRef,
  onTriggerSessionInsight,
  onToggleGroupSummaryPanel,
  onGroupAnalytics,
  onToggleGroupMembersPanel,
  onExportCurrentSession,
  onOpenSnsTimeline,
  onBatchTranscribe,
  onBatchDecrypt,
  onToggleJumpPopover,
  onToggleInSessionSearch,
  onRefreshMessages,
  onToggleDetailPanel,
  onToggleQueueDrawer,
  onOpenHostingModal
}: ChatHeaderProps) {
  const sessionName = displayNameOrFallback(session.username, session.displayName)
  const exportTitle = isCurrentSessionExporting
    ? '导出中'
    : isPreparingExportDialog
      ? '正在准备导出模块'
      : '导出当前会话'
  const batchVoiceTitle = isBatchTranscribing
    ? `${runningBatchVoiceTaskType === 'decrypt' ? '批量语音解密' : '批量转写'}中${batchVoiceProgress?.total ? `：${batchVoiceProgress.current}/${batchVoiceProgress.total}（${Math.round((batchVoiceProgress.current / Math.max(1, batchVoiceProgress.total)) * 100)}%）` : ''}，可在导出页任务中心查看进度`
    : '批量语音处理'
  const batchVoiceProgressPercent = batchVoiceProgress?.total
    ? Math.max(0, Math.min(100, Math.round((batchVoiceProgress.current / Math.max(1, batchVoiceProgress.total)) * 100)))
    : 0
  const batchImageDecryptProgressPercent = batchImageDecryptProgress?.total
    ? Math.max(0, Math.min(100, Math.round((batchImageDecryptProgress.current / Math.max(1, batchImageDecryptProgress.total)) * 100)))
    : 0
  const batchImageDecryptTitle = isBatchDecrypting
    ? `批量解密图片中${batchImageDecryptProgress?.total ? `：${batchImageDecryptProgress.current}/${batchImageDecryptProgress.total}（${batchImageDecryptProgressPercent}%）` : ''}，可在导出页任务中心查看进度`
    : '批量解密图片'
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  useDetailChromeRegistration({
    headerActions: (
      <>
        <div className="jump-calendar-anchor" ref={jumpCalendarWrapRef}>
          <button
            className={`icon-btn jump-to-time-btn ${showJumpPopover ? 'active' : ''}`}
            onClick={onToggleJumpPopover}
            title="跳转到指定时间"
            aria-label="跳转到指定时间"
            aria-expanded={showJumpPopover}
            aria-controls="chat-jump-calendar-popover"
          >
            <Calendar size={18} />
          </button>
        </div>
        <button
          className={`icon-btn in-session-search-btn ${showInSessionSearch ? 'active' : ''}`}
          onClick={onToggleInSessionSearch}
          disabled={!currentSessionId}
          title="搜索会话消息"
          aria-label="搜索会话消息"
          aria-expanded={showInSessionSearch}
          aria-controls="chat-in-session-search-panel"
        >
          <Search size={18} />
        </button>
      </>
    )
  })

  const closeMore = (restoreFocus = true): void => {
    setMoreOpen(false)
    if (restoreFocus) moreButtonRef.current?.focus()
  }
  const runMoreAction = (action: () => void): void => {
    action()
    closeMore()
  }
  useEffect(() => {
    if (!moreOpen) return
    moreMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMore()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = Array.from(moreMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      if (!items.length) return
      event.preventDefault()
      const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length
      items[nextIndex].focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

  return (
    <div className="message-header">
      <Avatar
        src={session.avatarUrl}
        name={sessionName}
        size={40}
        className={isGroupChat ? 'group session-avatar' : 'session-avatar'}
      />
      <div className="header-info">
        <h3>{sessionName}</h3>
        {isGroupChat && <div className="header-subtitle">群聊</div>}
      </div>
      <div className="header-actions">
        {!standaloneSessionWindow && onOpenHostingModal && (
          <button
            type="button"
            className={`primary-hosting-btn ${isHostingActive ? 'active' : ''}`}
            onClick={onOpenHostingModal}
            title={isHostingActive ? '自动托管运行中' : '开启托管'}
          >
            {isHostingActive ? (
              <>
                <span className="pulse-indicator" />
                托管中
              </>
            ) : (
              '开启托管'
            )}
          </button>
        )}
        {!compactHeader && <>
        <div className="header-action-group ai-actions">
          <button
            className={`icon-btn session-insight-btn${isTriggeringSessionInsight ? ' triggering' : ''}`}
            onClick={onTriggerSessionInsight}
            disabled={!currentSessionId || isTriggeringSessionInsight}
            title={isTriggeringSessionInsight ? '正在生成 AI 见解' : '立即触发当前聊天 AI 见解'}
            aria-label="立即触发当前聊天 AI 见解"
          >
            {isTriggeringSessionInsight ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
          </button>
          {isGroupChat && aiGroupSummaryEnabled && (
            <button
              className={`icon-btn chat-header-secondary-action group-summary-btn ${showGroupSummaryPanel ? 'active' : ''}`}
              onClick={(event) => onToggleGroupSummaryPanel(event.currentTarget)}
              disabled={!currentSessionId}
              title="AI 群聊总结"
              aria-label="AI 群聊总结"
            >
              <Newspaper size={18} />
            </button>
          )}
          {!standaloneSessionWindow && isGroupChat && (
            <button className="icon-btn chat-header-secondary-action group-analytics-btn" onClick={onGroupAnalytics} title="群聊分析" aria-label="群聊分析">
              <BarChart3 size={18} />
            </button>
          )}
          {isGroupChat && (
            <button
              className={`icon-btn chat-header-secondary-action group-members-btn ${showGroupMembersPanel ? 'active' : ''}`}
              onClick={(event) => onToggleGroupMembersPanel(event.currentTarget)}
              title="群成员"
              aria-label="群成员"
            >
              <Users size={18} />
            </button>
          )}
        </div>
        <div className="header-action-group tool-actions">
          {!standaloneSessionWindow && (
            <button
              className={`icon-btn chat-header-secondary-action export-session-btn${isExportActionBusy ? ' exporting' : ''}`}
              onClick={onExportCurrentSession}
              disabled={!currentSessionId || isExportActionBusy}
              title={exportTitle}
              aria-label={exportTitle}
            >
              {isExportActionBusy ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
            </button>
          )}
          {!standaloneSessionWindow && isPrivateSnsSupported && (
            <button
              className="icon-btn chat-header-secondary-action chat-sns-timeline-btn"
              onClick={onOpenSnsTimeline}
              disabled={!currentSessionId}
              title="查看朋友圈"
              aria-label="查看朋友圈"
            >
              <Aperture size={18} />
            </button>
          )}
          {!standaloneSessionWindow && (
            <button
              className={`icon-btn chat-header-secondary-action batch-transcribe-btn${isBatchTranscribing ? ' transcribing' : ''}`}
              onClick={onBatchTranscribe}
              disabled={!currentSessionId}
              title={batchVoiceTitle}
              aria-label={batchVoiceTitle}
            >
              {isBatchTranscribing ? (
                <>
                  <Loader2 size={18} className="spin" />
                  {batchVoiceProgress?.total ? (
                    <span className="batch-progress-badge">{batchVoiceProgressPercent}%</span>
                  ) : null}
                </>
              ) : <Mic size={18} />}
            </button>
          )}
          {!standaloneSessionWindow && (
            <button
              className={`icon-btn chat-header-secondary-action batch-decrypt-btn${isBatchDecrypting ? ' transcribing' : ''}`}
              onClick={onBatchDecrypt}
              disabled={!currentSessionId}
              title={batchImageDecryptTitle}
              aria-label={batchImageDecryptTitle}
            >
              {isBatchDecrypting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  {batchImageDecryptProgress?.total ? (
                    <span className="batch-progress-badge">{batchImageDecryptProgressPercent}%</span>
                  ) : null}
                </>
              ) : <ImageIcon size={18} />}
            </button>
          )}
        </div>
        <div className="header-action-group view-actions">
          <button
            className="icon-btn chat-header-secondary-action refresh-messages-btn"
            onClick={onRefreshMessages}
            disabled={isRefreshingMessages || isLoadingMessages}
            title="刷新消息"
            aria-label="刷新消息"
          >
            <RefreshCw size={18} className={isRefreshingMessages ? 'spin' : ''} />
          </button>
          {!standaloneSessionWindow && onToggleQueueDrawer && (
            <button
              className={`icon-btn queue-drawer-btn ${showQueueDrawer ? 'active' : ''}`}
              onClick={onToggleQueueDrawer}
              title="任务队列"
              aria-label="任务队列"
              aria-expanded={showQueueDrawer}
            >
              <ListTodo size={18} />
            </button>
          )}
          {!shouldHideStandaloneDetailButton && (
            <button
              className={`icon-btn detail-btn ${showDetailPanel ? 'active' : ''}`}
              onClick={(event) => onToggleDetailPanel(event.currentTarget)}
              title="会话详情"
              aria-label="会话详情"
            >
              <Info size={18} />
            </button>
          )}
        </div>
        </>}
        {compactHeader && (
          <div className="chat-header-more-wrap">
            <button
              ref={moreButtonRef}
              type="button"
              className="icon-btn chat-header-more-btn"
              aria-label="更多会话操作"
              aria-expanded={moreOpen}
              aria-controls="chat-header-more-menu"
              onClick={() => setMoreOpen((open) => !open)}
            >
              <MoreHorizontal size={18} />
            </button>
            {moreOpen && (
              <div ref={moreMenuRef} id="chat-header-more-menu" className="chat-header-more-menu" role="menu">
                <button type="button" role="menuitem" disabled={!currentSessionId || isTriggeringSessionInsight} onClick={() => runMoreAction(onTriggerSessionInsight)}><Sparkles size={16} />立即触发当前聊天 AI 见解</button>
                {isGroupChat && aiGroupSummaryEnabled && <button type="button" role="menuitem" disabled={!currentSessionId} onClick={() => runMoreAction(() => onToggleGroupSummaryPanel(moreButtonRef.current ?? undefined))}><Newspaper size={16} />AI 群聊总结</button>}
                {!standaloneSessionWindow && isGroupChat && <button type="button" role="menuitem" onClick={() => runMoreAction(onGroupAnalytics)}><BarChart3 size={16} />群聊分析</button>}
                {isGroupChat && <button type="button" role="menuitem" onClick={() => runMoreAction(() => onToggleGroupMembersPanel(moreButtonRef.current ?? undefined))}><Users size={16} />群成员</button>}
                {!standaloneSessionWindow && <button type="button" role="menuitem" disabled={!currentSessionId || isExportActionBusy} onClick={() => runMoreAction(onExportCurrentSession)}><Download size={16} />{exportTitle}</button>}
                {!standaloneSessionWindow && isPrivateSnsSupported && <button type="button" role="menuitem" disabled={!currentSessionId} onClick={() => runMoreAction(onOpenSnsTimeline)}><Aperture size={16} />查看朋友圈</button>}
                {!standaloneSessionWindow && <button type="button" role="menuitem" disabled={!currentSessionId} onClick={() => runMoreAction(onBatchTranscribe)}><Mic size={16} />{batchVoiceTitle}</button>}
                {!standaloneSessionWindow && <button type="button" role="menuitem" disabled={!currentSessionId} onClick={() => runMoreAction(onBatchDecrypt)}><ImageIcon size={16} />{batchImageDecryptTitle}</button>}
                <button type="button" role="menuitem" disabled={isRefreshingMessages || isLoadingMessages} onClick={() => runMoreAction(onRefreshMessages)}><RefreshCw size={16} />刷新消息</button>
                {!shouldHideStandaloneDetailButton && <button type="button" role="menuitem" onClick={() => runMoreAction(() => onToggleDetailPanel(moreButtonRef.current ?? undefined))}><Info size={16} />会话详情</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function areEqual(prev: ChatHeaderProps, next: ChatHeaderProps) {
  return (
    prev.session.username === next.session.username &&
    prev.session.displayName === next.session.displayName &&
    prev.session.avatarUrl === next.session.avatarUrl &&
    prev.isGroupChat === next.isGroupChat &&
    prev.standaloneSessionWindow === next.standaloneSessionWindow &&
    prev.showGroupMembersPanel === next.showGroupMembersPanel &&
    prev.showGroupSummaryPanel === next.showGroupSummaryPanel &&
    prev.showJumpPopover === next.showJumpPopover &&
    prev.showInSessionSearch === next.showInSessionSearch &&
    prev.showDetailPanel === next.showDetailPanel &&
    prev.showQueueDrawer === next.showQueueDrawer &&
    prev.isHostingActive === next.isHostingActive &&
    prev.aiGroupSummaryEnabled === next.aiGroupSummaryEnabled &&
    prev.shouldHideStandaloneDetailButton === next.shouldHideStandaloneDetailButton &&
    prev.isPrivateSnsSupported === next.isPrivateSnsSupported &&
    prev.isExportActionBusy === next.isExportActionBusy &&
    prev.isCurrentSessionExporting === next.isCurrentSessionExporting &&
    prev.isPreparingExportDialog === next.isPreparingExportDialog &&
    prev.isBatchTranscribing === next.isBatchTranscribing &&
    prev.runningBatchVoiceTaskType === next.runningBatchVoiceTaskType &&
    prev.batchVoiceProgress?.current === next.batchVoiceProgress?.current &&
    prev.batchVoiceProgress?.total === next.batchVoiceProgress?.total &&
    prev.isBatchDecrypting === next.isBatchDecrypting &&
    prev.batchImageDecryptProgress?.current === next.batchImageDecryptProgress?.current &&
    prev.batchImageDecryptProgress?.total === next.batchImageDecryptProgress?.total &&
    prev.isTriggeringSessionInsight === next.isTriggeringSessionInsight &&
    prev.isRefreshingMessages === next.isRefreshingMessages &&
    prev.isLoadingMessages === next.isLoadingMessages &&
    prev.currentSessionId === next.currentSessionId &&
    prev.compactHeader === next.compactHeader &&
    prev.jumpCalendarWrapRef === next.jumpCalendarWrapRef &&
    prev.onTriggerSessionInsight === next.onTriggerSessionInsight &&
    prev.onToggleGroupSummaryPanel === next.onToggleGroupSummaryPanel &&
    prev.onGroupAnalytics === next.onGroupAnalytics &&
    prev.onToggleGroupMembersPanel === next.onToggleGroupMembersPanel &&
    prev.onExportCurrentSession === next.onExportCurrentSession &&
    prev.onOpenSnsTimeline === next.onOpenSnsTimeline &&
    prev.onBatchTranscribe === next.onBatchTranscribe &&
    prev.onBatchDecrypt === next.onBatchDecrypt &&
    prev.onToggleJumpPopover === next.onToggleJumpPopover &&
    prev.onToggleInSessionSearch === next.onToggleInSessionSearch &&
    prev.onRefreshMessages === next.onRefreshMessages &&
    prev.onToggleDetailPanel === next.onToggleDetailPanel &&
    prev.onToggleQueueDrawer === next.onToggleQueueDrawer &&
    prev.onOpenHostingModal === next.onOpenHostingModal
  )
}

export default React.memo(ChatHeader, areEqual)
