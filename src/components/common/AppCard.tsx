import React from 'react'
import './AppCard.scss'

export interface AppCardProps {
  id?: string
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  hoverElastic?: boolean
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  extra?: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
}

export const AppCard: React.FC<AppCardProps> = ({
  id,
  children,
  className = '',
  style,
  hoverElastic = false,
  onClick,
  title,
  subtitle,
  extra,
  header,
  footer
}) => {
  const hasHeader = Boolean(header || title || subtitle || extra)

  return (
    <div
      id={id}
      className={`app-card ${hoverElastic ? 'hover-elastic' : ''} ${onClick ? 'interactive' : ''} ${className}`}
      style={style}
      onClick={onClick}
    >
      {hasHeader && (
        <div className="app-card-header">
          {header || (
            <div className="app-card-header-titles">
              {title && <h3 className="app-card-title">{title}</h3>}
              {subtitle && <p className="app-card-subtitle">{subtitle}</p>}
            </div>
          )}
          {extra && <div className="app-card-extra">{extra}</div>}
        </div>
      )}
      {children && <div className="app-card-body">{children}</div>}
      {footer && <div className="app-card-footer">{footer}</div>}
    </div>
  )
}

export default AppCard
