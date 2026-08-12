import { createElement, isValidElement, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Copy, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react'
import { useDetailChrome } from './common/DetailChromeContext'
import './TitleBar.scss'

export interface TitleBarProps {
  title?: React.ReactNode
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  showWindowControls?: boolean
  customControls?: React.ReactNode
  showLogo?: boolean
  showNavControls?: boolean
  onBack?: () => void
  onForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
}

function TitleBar({
  title,
  sidebarCollapsed = false,
  onToggleSidebar,
  showWindowControls = true,
  customControls,
  showLogo = true,
  showNavControls = false,
  onBack,
  onForward,
  canGoBack = Boolean(onBack),
  canGoForward = Boolean(onForward)
}: TitleBarProps = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const detailChrome = useDetailChrome()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!showWindowControls) return

    void window.electronAPI?.window?.isMaximized?.().then(setIsMaximized).catch(() => {
      setIsMaximized(false)
    })

    return window.electronAPI?.window?.onMaximizeStateChanged?.((maximized) => {
      setIsMaximized(maximized)
    })
  }, [showWindowControls])

  const handleBack = () => {
    if (!canGoBack) return
    if (onBack) {
      onBack()
    } else {
      navigate(-1)
    }
  }

  const handleForward = () => {
    if (!canGoForward) return
    if (onForward) {
      onForward()
    } else {
      navigate(1)
    }
  }

  const getResolvedTitle = (): React.ReactNode => {
    if (title !== undefined) return title
    if (detailChrome?.title !== undefined) return detailChrome.title
    const p = location.pathname
    if (p === '/home') return '首页'
    if (p === '/chat') return '聊天'
    if (p === '/sns') return '朋友圈'
    if (p === '/insight-inbox') return '灵感信箱'
    if (p === '/contacts') return '通讯录'
    if (p === '/resources') return '资源浏览'
    if (p.startsWith('/analytics')) return '聊天分析'
    if (p.startsWith('/annual-report')) return '年度报告'
    if (p === '/footprint') return '我的足迹'
    if (p === '/export') return '导出'
    if (p === '/backup') return '数据库备份'
    if (p === '/settings') return '外观'
    if (p === '/account-management') return '账号管理'
    if (p === '/biz') return '公众号'
    return 'WeFlow'
  }

  const resolvedTitle = getResolvedTitle()

  return (
    <header className="title-bar mac-unified-toolbar">
      <div className="title-bar-left">
        {onToggleSidebar ? (
          <button
            type="button"
            className="title-sidebar-toggle"
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        ) : null}

        {showNavControls ? (
          <div className="title-nav-history">
            <button
              type="button"
              className="title-nav-btn"
              onClick={handleBack}
              disabled={!canGoBack}
              title="后退"
              aria-label="后退"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="title-nav-btn"
              onClick={handleForward}
              disabled={!canGoForward}
              title="前进"
              aria-label="前进"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}

        {detailChrome?.icon && (
          <span className="title-detail-icon">
            {isValidElement(detailChrome.icon)
              ? detailChrome.icon
              : createElement(detailChrome.icon, { 'aria-hidden': true })}
          </span>
        )}
        <span className="title-detail-copy">
          <span className="titles bold-page-title">{resolvedTitle}</span>
          {detailChrome?.subtitle && (
            <span className="title-detail-subtitle">{detailChrome.subtitle}</span>
          )}
        </span>
      </div>

      {showLogo && (
        <div className="title-bar-center">
          <img src="./logo.png" alt="WeFlow" className="title-logo" />
        </div>
      )}

      <div className="title-bar-right">
        {detailChrome?.headerFilters ? (
          <div className="title-detail-filters">{detailChrome.headerFilters}</div>
        ) : null}

        {detailChrome?.headerActions ? (
          <div className="title-detail-actions">{detailChrome.headerActions}</div>
        ) : null}

        {customControls ? (
          <div className="title-custom-controls">
            {customControls}
          </div>
        ) : null}

        {showWindowControls ? (
          <div className="title-window-controls">
            <button
              type="button"
              className="title-window-control-btn"
              aria-label="最小化"
              title="最小化"
              onClick={() => window.electronAPI?.window?.minimize?.()}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="title-window-control-btn"
              aria-label={isMaximized ? '还原' : '最大化'}
              title={isMaximized ? '还原' : '最大化'}
              onClick={() => window.electronAPI?.window?.maximize?.()}
            >
              {isMaximized ? <Copy size={12} /> : <Square size={12} />}
            </button>
            <button
              type="button"
              className="title-window-control-btn is-close"
              aria-label="关闭"
              title="关闭"
              onClick={() => window.electronAPI?.window?.close?.()}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}

export default TitleBar
