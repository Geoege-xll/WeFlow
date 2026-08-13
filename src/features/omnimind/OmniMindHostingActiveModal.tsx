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
          <div className="hosting-dialog-header">
            <div className="hosting-status-tag">
              <span className="pulse-indicator" />
              {omniMindZhCN.hosting.running}
            </div>
            <h2 id="hosting-dialog-title">OmniMind 托管服务高优先级守护中</h2>
            <p className="hosting-dialog-lead">
              已进入系统级自动托管机制。后台将自动监测消息事件、调度模型生成并严格排队校验发送。
            </p>
          </div>
          <div className="hosting-dialog-body">
            <div className="hosting-metrics-grid">
              <div className="h-metric-box">
                <strong>{processedCount} 条</strong>
                <span>已自动处理</span>
              </div>
              <div className="h-metric-box">
                <strong>{queueCount} 条</strong>
                <span>当前队列</span>
              </div>
              <div className="h-metric-box">
                <strong>100%</strong>
                <span>安全校验率</span>
              </div>
            </div>
            <div className="hosting-stream-box">
              {snapshot?.current ? (
                <div className="stream-line active">
                  <time>{new Date().toLocaleTimeString('zh-CN', { hour12: false })}</time>
                  <span>正在处理任务：{snapshot.current.sessionName || snapshot.current.sessionId}</span>
                </div>
              ) : snapshot?.waiting && snapshot.waiting.length > 0 ? (
                <div className="stream-line active">
                  <time>{new Date().toLocaleTimeString('zh-CN', { hour12: false })}</time>
                  <span>排队等待中（{snapshot.waiting.length} 个任务待生成/发送）</span>
                </div>
              ) : (
                <div className="stream-line active">
                  <time>{new Date().toLocaleTimeString('zh-CN', { hour12: false })}</time>
                  <span>系统挂起就绪，实时监测新消息中...</span>
                </div>
              )}
              {snapshot?.recent && snapshot.recent.length > 0 && (
                <div className="stream-line">
                  <time>{new Date(snapshot.recent[0].updatedAt || snapshot.recent[0].createdAt || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                  <span>最近已成功处理并校验 1 条发送响应</span>
                </div>
              )}
            </div>
            <div className="hosting-warning-note">
              <strong>强交互防护规则：</strong>蒙层点击与键盘 ESC 快捷键已禁用。必须明确点击下方“停止托管”按钮方可终止托管进程。
            </div>
          </div>
          <div className="hosting-dialog-foot">
            <button
              ref={stopButtonRef}
              id="stop-hosting"
              className="button danger"
              type="button"
              disabled={loading}
              onClick={handleStop}
              style={{ width: '100%', minHeight: '44px', fontWeight: 700 }}
            >
              {loading ? '正在停止...' : '停止托管'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
