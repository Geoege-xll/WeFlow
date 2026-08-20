import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import './AppDialog.scss'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

export interface AppDialogProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  filters?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: DialogSize
  closeOnOverlayClick?: boolean
  closeOnEscape?: boolean
  closeAriaLabel?: string
  initialFocusRef?: React.RefObject<HTMLElement | null>
  openerRef?: React.RefObject<HTMLElement | null>
  dialogId?: string
  className?: string
  style?: React.CSSProperties
  role?: 'dialog' | 'alertdialog'
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export const AppDialog: React.FC<AppDialogProps> = ({
  open,
  onClose,
  title,
  subtitle,
  filters,
  children,
  footer,
  size = 'md',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  closeAriaLabel = '关闭',
  initialFocusRef,
  openerRef,
  dialogId,
  className = '',
  style,
  role = 'dialog'
}) => {
  const generatedId = useId().replace(/:/g, '')
  const titleId = `app-dialog-title-${generatedId}`
  const descriptionId = `app-dialog-description-${generatedId}`
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const capturedOpenerRef = useRef<HTMLElement | null>(null)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    capturedOpenerRef.current = openerRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const applicationRoot = document.getElementById('app') ?? document.getElementById('root')
    const previousAriaHidden = applicationRoot?.getAttribute('aria-hidden') ?? null
    const previousInert = applicationRoot?.inert ?? false
    if (applicationRoot) {
      applicationRoot.setAttribute('aria-hidden', 'true')
      applicationRoot.inert = true
    }
    const focusFrame = window.requestAnimationFrame(() => {
      const initialTarget = initialFocusRef?.current ?? closeButtonRef.current ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      initialTarget?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent): void => {
      // 多层确认框共用同一 Dialog 基础设施时，只允许最上层对话框消费键盘事件。
      // 这样停止确认框按 Esc 只会关闭确认框，不会穿透并关闭后面的托管中心。
      const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('.app-dialog-overlay'))
      if (openDialogs[openDialogs.length - 1]?.querySelector('.app-dialog') !== dialogRef.current) return
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown, true)
      if (applicationRoot) {
        if (previousAriaHidden === null) applicationRoot.removeAttribute('aria-hidden')
        else applicationRoot.setAttribute('aria-hidden', previousAriaHidden)
        applicationRoot.inert = previousInert
      }
      const opener = openerRef?.current ?? capturedOpenerRef.current
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus()
      })
    }
  }, [closeOnEscape, initialFocusRef, open, openerRef])

  if (!open) return null

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (closeOnOverlayClick && event.target === event.currentTarget) onCloseRef.current()
  }
  const hasHeader = Boolean(title || subtitle)

  return createPortal(
    <div className="app-dialog-overlay" onMouseDown={handleOverlayClick}>
      <div
        ref={dialogRef}
        id={dialogId}
        className={`app-dialog app-dialog-${size} ${className}`}
        style={style}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {hasHeader && (
          <header className="app-dialog-header">
            <div className="app-dialog-header-text">
              {title && <h2 id={titleId} className="app-dialog-title">{title}</h2>}
              {subtitle && <p id={descriptionId} className="app-dialog-subtitle">{subtitle}</p>}
            </div>
            <button ref={closeButtonRef} type="button" className="app-dialog-close-btn" onClick={() => onCloseRef.current()} aria-label={closeAriaLabel}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>
        )}
        {filters && <div className="app-dialog-filters">{filters}</div>}
        {children && <div className="app-dialog-content">{children}</div>}
        {footer && <footer className="app-dialog-footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  )
}

export default AppDialog
