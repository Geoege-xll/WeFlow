import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import './WeFlowDialog.scss'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

export interface WeFlowDialogProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  filters?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: DialogSize
  closeOnOverlayClick?: boolean
  className?: string
  style?: React.CSSProperties
}

export const WeFlowDialog: React.FC<WeFlowDialogProps> = ({
  open,
  onClose,
  title,
  subtitle,
  filters,
  children,
  footer,
  size = 'md',
  closeOnOverlayClick = true,
  className = '',
  style
}) => {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose()
    }
  }

  const hasHeader = Boolean(title || subtitle)

  return (
    <div className="weflow-dialog-overlay" onClick={handleOverlayClick}>
      <div className={`weflow-dialog weflow-dialog-${size} ${className}`} style={style} onClick={e => e.stopPropagation()}>
        {/* Stage 1: Header */}
        {hasHeader && (
          <header className="weflow-dialog-header">
            <div className="weflow-dialog-header-text">
              {title && <h2 className="weflow-dialog-title">{title}</h2>}
              {subtitle && <p className="weflow-dialog-subtitle">{subtitle}</p>}
            </div>
            <button
              type="button"
              className="weflow-dialog-close-btn"
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </header>
        )}

        {/* Stage 2: Filters */}
        {filters && <div className="weflow-dialog-filters">{filters}</div>}

        {/* Stage 3: Content */}
        {children && <div className="weflow-dialog-content">{children}</div>}

        {/* Stage 4: Footer */}
        {footer && <footer className="weflow-dialog-footer">{footer}</footer>}
      </div>
    </div>
  )
}

export default WeFlowDialog
