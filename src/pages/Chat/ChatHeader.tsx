import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Aperture,
  BarChart3,
  Calendar,
  Download,
  Image as ImageIcon,
  Info,
  Loader2,
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

export interface ChatHeaderProps {
  session: ChatSession
  isGroupChat: boolean
  standaloneSessionWindow: boolean
  showGroupMembersPanel: boolean
  showJumpPopover: boolean
  showInSessionSearch: boolean
  showDetailPanel: boolean
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
  onBeforeOpenMore?: () => void
}

function ChatHeader({
  session,
  isGroupChat,
  standaloneSessionWindow,
  showGroupMembersPanel,
  showJumpPopover,
  showInSessionSearch,
  showDetailPanel,
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
  onBeforeOpenMore
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
  const batchImageDecryptProgressPercent = batchImageDecryptProgress?.total
    ? Math.max(0, Math.min(100, Math.round((batchImageDecryptProgress.current / Math.max(1, batchImageDecryptProgress.total)) * 100)))
    : 0
  const batchImageDecryptTitle = isBatchDecrypting
    ? `批量解密图片中${batchImageDecryptProgress?.total ? `：${batchImageDecryptProgress.current}/${batchImageDecryptProgress.total}（${batchImageDecryptProgressPercent}%）` : ''}，可在导出页任务中心查看进度`
    : '批量解密图片'
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePosition, setMorePosition] = useState<{ top: number; left: number; placement: 'above' | 'below' }>()
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  const closeMore = (restoreFocus = true): void => {
    setMoreOpen(false)
    if (restoreFocus) moreButtonRef.current?.focus()
  }
  const runMoreAction = (action: () => void): void => {
    action()
    closeMore()
  }
  useLayoutEffect(() => {
    if (!moreOpen || !moreButtonRef.current || !moreMenuRef.current) return
    const anchor = moreButtonRef.current.getBoundingClientRect()
    const menu = moreMenuRef.current.getBoundingClientRect()
    const viewportGap = 12
    const anchorGap = 6
    const fitsBelow = anchor.bottom + anchorGap + menu.height <= window.innerHeight - viewportGap
    const fitsAbove = anchor.top - anchorGap - menu.height >= viewportGap
    const placement = !fitsBelow && fitsAbove ? 'above' : 'below'
    const unclampedTop = placement === 'above' ? anchor.top - anchorGap - menu.height : anchor.bottom + anchorGap
    const top = Math.max(viewportGap, Math.min(unclampedTop, window.innerHeight - menu.height - viewportGap))
    const left = Math.max(viewportGap, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - viewportGap))
    setMorePosition({ top, left, placement })
  }, [moreOpen])
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
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (moreMenuRef.current?.contains(target) || moreButtonRef.current?.contains(target)) return
      // 原型合同要求任一关闭路径都把键盘焦点还给 More 触发器。
      closeMore()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
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
        {/* 核心入口 1: 📅 按日期跳转 */}
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

        {/* 核心入口 2: 🔍 会话内搜索 */}
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

        {/* 核心入口 3: ℹ️ 会话详情 / 群成员 Drawer */}
        {!shouldHideStandaloneDetailButton && (
          <button
            className={`icon-btn detail-btn ${showDetailPanel || showGroupMembersPanel ? 'active' : ''}`}
            onClick={(event) => isGroupChat ? onToggleGroupMembersPanel(event.currentTarget) : onToggleDetailPanel(event.currentTarget)}
            title={isGroupChat ? '群成员' : '会话详情'}
            aria-label={isGroupChat ? '群成员' : '会话详情'}
            aria-expanded={isGroupChat ? showGroupMembersPanel : showDetailPanel}
            aria-controls={isGroupChat ? 'group-members-inspector' : 'session-detail-inspector'}
          >
            <Info size={18} />
          </button>
        )}

        {/* 更多 (···) 下拉菜单 */}
        <div className="chat-header-more-wrap">
          <button
            ref={moreButtonRef}
            type="button"
            className="icon-btn chat-header-more-btn"
            aria-label="更多会话操作"
            aria-expanded={moreOpen}
            aria-controls="chat-header-more-menu"
            onClick={() => setMoreOpen((open) => {
              if (!open) onBeforeOpenMore?.()
              return !open
            })}
          >
            <MoreHorizontal size={18} />
          </button>
          {moreOpen && createPortal(
            <div
              ref={moreMenuRef}
              id="chat-header-more-menu"
              className="chat-header-more-menu"
              role="menu"
              data-placement={morePosition?.placement}
              style={morePosition ? { top: morePosition.top, left: morePosition.left } : undefined}
            >
              <button type="button" role="menuitem" disabled={!currentSessionId || isTriggeringSessionInsight} onClick={() => runMoreAction(onTriggerSessionInsight)}>
                {isTriggeringSessionInsight ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                立即触发当前聊天 AI 见解
              </button>
              {isGroupChat && aiGroupSummaryEnabled && (
                <button type="button" role="menuitem" disabled={!currentSessionId} onClick={() => runMoreAction(() => onToggleGroupSummaryPanel(moreButtonRef.current ?? undefined))}>
                  <Newspaper size={16} />AI 群聊总结
                </button>
              )}
              {!standaloneSessionWindow && isGroupChat && (
                <button type="button" role="menuitem" onClick={() => runMoreAction(onGroupAnalytics)}>
                  <BarChart3 size={16} />群聊分析
                </button>
              )}
              {!standaloneSessionWindow && (
                <button type="button" role="menuitem" disabled={!currentSessionId || isExportActionBusy} onClick={() => runMoreAction(onExportCurrentSession)}>
                  {isExportActionBusy ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                  {exportTitle}
                </button>
              )}
              {!standaloneSessionWindow && isPrivateSnsSupported && (
                <button type="button" role="menuitem" disabled={!currentSessionId} onClick={() => runMoreAction(onOpenSnsTimeline)}>
                  <Aperture size={16} />查看朋友圈
                </button>
              )}
              {!standaloneSessionWindow && (
                <button type="button" role="menuitem" disabled={!currentSessionId} onClick={() => runMoreAction(onBatchTranscribe)}>
                  {isBatchTranscribing ? <Loader2 size={16} className="spin" /> : <Mic size={16} />}
                  {batchVoiceTitle}
                </button>
              )}
              {!standaloneSessionWindow && (
                <button type="button" role="menuitem" disabled={!currentSessionId} onClick={() => runMoreAction(onBatchDecrypt)}>
                  {isBatchDecrypting ? <Loader2 size={16} className="spin" /> : <ImageIcon size={16} />}
                  {batchImageDecryptTitle}
                </button>
              )}
              <button type="button" role="menuitem" disabled={isRefreshingMessages || isLoadingMessages} onClick={() => runMoreAction(onRefreshMessages)}>
                <RefreshCw size={16} className={isRefreshingMessages ? 'spin' : ''} />刷新消息
              </button>
            </div>,
            document.body
          )}
        </div>
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
    prev.showJumpPopover === next.showJumpPopover &&
    prev.showInSessionSearch === next.showInSessionSearch &&
    prev.showDetailPanel === next.showDetailPanel &&
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
    prev.onBeforeOpenMore === next.onBeforeOpenMore
  )
}

export default React.memo(ChatHeader, areEqual)
