import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Inbox, Loader2 } from 'lucide-react'
import { useDetailChromeRegistration } from './DetailChromeContext'
import './AppPageContainer.scss'

export interface AppPageContainerProps {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  /** @deprecated Use subtitle. */
  description?: React.ReactNode
  showBack?: boolean
  onBack?: () => void
  showForward?: boolean
  onForward?: () => void
  showNavigationStack?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  icon?: React.ElementType | React.ReactElement
  /** @deprecated Use headerActions. */
  actions?: React.ReactNode
  headerActions?: React.ReactNode
  /** @deprecated Use headerFilters. */
  filters?: React.ReactNode
  headerFilters?: React.ReactNode
  children?: React.ReactNode
  scrollable?: boolean
  loading?: boolean
  /** @deprecated Use loading. */
  isLoading?: boolean
  loadingText?: string
  empty?: boolean
  /** @deprecated Use empty. */
  isEmpty?: boolean
  emptyTitle?: React.ReactNode
  /** @deprecated Use emptyTitle. */
  emptyText?: string
  emptyDescription?: React.ReactNode
  emptyIcon?: React.ElementType | React.ReactElement
  emptyAction?: React.ReactNode
  /** @deprecated Use footerActions. */
  footer?: React.ReactNode
  footerActions?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export const AppPageContainer: React.FC<AppPageContainerProps> = ({
  title,
  subtitle,
  description,
  showBack = false,
  onBack,
  showForward = false,
  onForward,
  showNavigationStack = false,
  canGoBack,
  canGoForward,
  icon,
  actions,
  headerActions,
  filters,
  headerFilters,
  children,
  scrollable = true,
  loading,
  isLoading = false,
  loadingText = '加载中...',
  empty,
  isEmpty = false,
  emptyTitle,
  emptyText = '暂无数据',
  emptyDescription,
  emptyIcon,
  emptyAction,
  footer,
  footerActions,
  className = '',
  style
}) => {
  const navigate = useNavigate()
  const historyIndex = Number(window.history.state?.idx)
  const backVisible = showNavigationStack || showBack || Boolean(onBack)
  const forwardVisible = showNavigationStack || showForward || Boolean(onForward)
  const renderNavControls = backVisible || forwardVisible
  const backAvailable = canGoBack ?? (Boolean(onBack) || (Number.isFinite(historyIndex) && historyIndex > 0))
  const forwardAvailable = canGoForward ?? Boolean(onForward)

  const effectiveSubtitle = subtitle ?? description
  const effectiveHeaderFilters = headerFilters ?? filters
  const effectiveHeaderActions = headerActions ?? actions
  const effectiveFooter = footerActions ?? footer
  const effectiveLoading = loading ?? isLoading
  const effectiveEmpty = empty ?? isEmpty
  const rendersChromeInShell = useDetailChromeRegistration({
    title,
    subtitle: effectiveSubtitle,
    icon,
    headerFilters: effectiveHeaderFilters,
    headerActions: effectiveHeaderActions
  })

  const hasHeader = Boolean(
    title ||
    effectiveSubtitle ||
    renderNavControls ||
    icon ||
    effectiveHeaderActions ||
    effectiveHeaderFilters
  )

  const handleBack = () => {
    if (!backAvailable) return
    if (onBack) {
      onBack()
    } else {
      navigate(-1)
    }
  }

  const handleForward = () => {
    if (!forwardAvailable) return
    if (onForward) {
      onForward()
    } else {
      navigate(1)
    }
  }

  const renderContent = () => {
    if (effectiveLoading) {
      return (
        <div
          className="content-unavailable-view app-page-empty is-loading"
          role="status"
          aria-live="polite"
        >
          <div className="content-unavailable-icon spin">
            <Loader2 size={48} aria-hidden="true" />
          </div>
          <h3 className="content-unavailable-title">{loadingText}</h3>
        </div>
      )
    }

    if (effectiveEmpty) {
      return (
        <div className="content-unavailable-view app-page-empty" role="status">
          <div className="content-unavailable-icon">
            {React.isValidElement(emptyIcon)
              ? emptyIcon
              : emptyIcon
                ? React.createElement(emptyIcon, { size: 48, 'aria-hidden': true })
                : <Inbox size={48} aria-hidden="true" />}
          </div>
          <h3 className="content-unavailable-title">{emptyTitle || emptyText}</h3>
          {emptyDescription && (
            <p className="content-unavailable-description">{emptyDescription}</p>
          )}
          {emptyAction && (
            <div className="content-unavailable-action">{emptyAction}</div>
          )}
        </div>
      )
    }

    return children
  }

  return (
    <div className={`app-page-container mac-detail-view ${className}`} style={style}>
      {hasHeader && !rendersChromeInShell && (
        <header className="app-page-header mac-detail-header">
          <div className="app-page-header-main">
            <div className="app-page-header-titles">
              {renderNavControls && (
                <div className="app-page-nav-group">
                  {backVisible && (
                    <button
                      type="button"
                      className="app-page-nav-btn"
                      onClick={handleBack}
                      disabled={!backAvailable}
                      aria-label="返回"
                      title="返回"
                    >
                      <ChevronLeft size={16} />
                    </button>
                  )}
                  {forwardVisible && (
                    <button
                      type="button"
                      className="app-page-nav-btn"
                      onClick={handleForward}
                      disabled={!forwardAvailable}
                      aria-label="前进"
                      title="前进"
                    >
                      <ChevronRight size={16} />
                    </button>
                  )}
                </div>
              )}
              {icon && (
                <div className="app-page-icon">
                  {React.isValidElement(icon)
                    ? icon
                    : React.createElement(icon, { 'aria-hidden': true })}
                </div>
              )}
              <div className="app-page-header-text">
                {title && <h1 className="app-page-title">{title}</h1>}
                {effectiveSubtitle && (
                  <p className="app-page-subtitle app-page-description">
                    {effectiveSubtitle}
                  </p>
                )}
              </div>
            </div>
            {effectiveHeaderFilters && (
              <div className="app-page-header-filters">{effectiveHeaderFilters}</div>
            )}
            {effectiveHeaderActions && (
              <div className="app-page-header-actions">{effectiveHeaderActions}</div>
            )}
          </div>
        </header>
      )}

      <main
        className={`app-page-body ${scrollable ? 'scrollable' : 'fixed'}`}
        aria-busy={effectiveLoading || undefined}
      >
        {renderContent()}
      </main>

      {effectiveFooter && (
        <footer className="app-page-footer safe-area-bottom-inset">
          {effectiveFooter}
        </footer>
      )}
    </div>
  )
}

export default AppPageContainer
