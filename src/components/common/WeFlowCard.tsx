import React from 'react'
import './WeFlowCard.scss'

export interface WeFlowCardProps {
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

export const WeFlowCard: React.FC<WeFlowCardProps> = ({
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
      className={`weflow-card ${hoverElastic ? 'hover-elastic' : ''} ${onClick ? 'interactive' : ''} ${className}`}
      style={style}
      onClick={onClick}
    >
      {hasHeader && (
        <div className="weflow-card-header">
          {header || (
            <div className="weflow-card-header-titles">
              {title && <h3 className="weflow-card-title">{title}</h3>}
              {subtitle && <p className="weflow-card-subtitle">{subtitle}</p>}
            </div>
          )}
          {extra && <div className="weflow-card-extra">{extra}</div>}
        </div>
      )}
      {children && <div className="weflow-card-body">{children}</div>}
      {footer && <div className="weflow-card-footer">{footer}</div>}
    </div>
  )
}

export default WeFlowCard
