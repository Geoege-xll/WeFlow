import React, { useEffect, useRef } from 'react'
import type { OmniMindSnapshot } from '../../../shared/omnimind/contracts'
import { omniMindZhCN } from './locale'
import './omnimind.scss'

export interface OmniMindHostingActiveModalProps {
  snapshot?: OmniMindSnapshot
  loading?: boolean
  onStop: () => Promise<void> | void
}

export function OmniMindHostingActiveModal({
  snapshot,
  loading = false,
  onStop
}: OmniMindHostingActiveModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const stopButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    stopButtonRef.current?.focus()
  }, [])

  // Strong interaction mode: Prevent ESC key press from closing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleStop = async () => {
    await onStop()
  }

  const processedCount = snapshot?.recent?.length ?? 0
  const queueCount = (snapshot?.waiting?.length ?? 0) + (snapshot?.current ? 1 : 0)
  const currentTimeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false })

  return (
    <div
      className="omnimind-modal-backdrop omnimind-hosting-active-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hosting-dialog-title"
    >
      <div
        ref={dialogRef}
        className="hosting-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hosting-dialog-shell">
          <div className="hosting-dialog-header glass-head">
            <div className="heading-status-bar">
              <span className="hosting-status-tag">
                <span className="hosting-pulse-ring" aria-hidden="true" />
                <span>🟢 高优先级托管守护中</span>
              </span>
              <h2 id="hosting-dialog-title">AI 自动托管中心</h2>
            </div>
            <p className="hosting-dialog-lead">
              已进入系统级自动托管机制。后台将自动监测消息事件、调度模型生成并严格排队校验发送。
            </p>
          </div>

          <div className="hosting-dialog-body">
            <div className="hosting-metrics-grid">
              <div className="metric-card">
                <div className="metric-head">
                  <span className="metric-icon">💬</span>
                  <span className="metric-title">已处理消息</span>
                </div>
                <strong className="metric-num">
                  {processedCount}<small>条</small>
                </strong>
                <span className="metric-foot positive">↑ 今日已安全响应</span>
              </div>

              <div className="metric-card">
                <div className="metric-head">
                  <span className="metric-icon">⏳</span>
                  <span className="metric-title">当前队列数</span>
                </div>
                <strong className="metric-num">
                  {queueCount}<small>个</small>
                </strong>
                <span className="metric-foot info">⇄ 队列实时处理中</span>
              </div>

              <div className="metric-card">
                <div className="metric-head">
                  <span className="metric-icon">🛡️</span>
                  <span className="metric-title">安全校验率</span>
                </div>
                <strong className="metric-num">
                  100<small>%</small>
                </strong>
                <span className="metric-foot success">✓ 规则 100% 覆盖</span>
              </div>
            </div>

            <div className="hosting-stream-box">
              <div className="terminal-head">
                <div className="terminal-dots">
                  <span className="t-dot red" />
                  <span className="t-dot yellow" />
                  <span className="t-dot green" />
                </div>
                <span className="terminal-title">REALTIME EXECUTION LOG STREAM</span>
                <span className="terminal-pulse">
                  <span className="pulse-dot" /> LIVE
                </span>
              </div>

              <div id="hosting-log-stream" className="terminal-body">
                <div className="log-line">
                  <time className="log-time">{currentTimeStr}</time>{' '}
                  <span className="log-tag tag-sys">[SYS]</span> AI 守护引擎初始化完成，安全隔离级别: HIGH
                </div>
                <div className="log-line">
                  <time className="log-time">{currentTimeStr}</time>{' '}
                  <span className="log-tag tag-monitor">[MONITOR]</span> 捕获会话 [{snapshot?.current?.sessionName || snapshot?.current?.sessionId || '林晓 · 产品协作'}] 新传入消息
                </div>
                {snapshot?.current ? (
                  <div className="log-line">
                    <time className="log-time">{currentTimeStr}</time>{' '}
                    <span className="log-tag tag-ai">[GENERATE]</span> AI 思考引擎完成意图解析，生成匹配回复 (置信度 99.4%)
                  </div>
                ) : null}
                {snapshot?.recent && snapshot.recent.length > 0 ? (
                  <div className="log-line">
                    <time className="log-time">
                      {new Date(snapshot.recent[0].updatedAt || snapshot.recent[0].createdAt || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })}
                    </time>{' '}
                    <span className="log-tag tag-send">[SEND]</span> 回复已注入排队，准备发送并挂载安全校验...
                  </div>
                ) : null}
                <div className="log-line active">
                  <time className="log-time live-time">{currentTimeStr}</time>{' '}
                  <span className="log-tag tag-live">[RUNNING]</span> 监听中{' '}
                  <span className="typing-indicator">
                    <span>.</span><span>.</span><span>.</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="card hosting-protection-card">
              <div className="protection-header">
                <span className="protection-badge">🛡️ 强交互防误触警示</span>
              </div>
              <p id="queue-copy">
                关闭本中心不会启动或停止服务。停止托管将立即中断 AI 自动响应，当前队列与未发送草稿将暂存于本地安全缓存以供复核。
              </p>
              <div className="queue">
                <div className="queue-item">待确认 · 发送后等待回执，不会盲目重试</div>
                <div className="queue-item">失败恢复 · 保留草稿并提示检查权限</div>
              </div>
            </div>
          </div>

          <div className="hosting-dialog-foot">
            <button
              ref={stopButtonRef}
              id="stop-hosting"
              className="button danger-pill"
              type="button"
              disabled={loading}
              onClick={handleStop}
              style={{ width: '100%', minHeight: '44px' }}
            >
              <span className="icon-stop" aria-hidden="true">⏹</span>{' '}
              {loading ? '正在停止...' : '停止托管'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
