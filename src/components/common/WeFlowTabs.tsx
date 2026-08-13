import React from 'react'
import './WeFlowTabs.scss'

export interface TabItem {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode
  badge?: React.ReactNode | number
  disabled?: boolean
}

export interface WeFlowTabsProps {
  items: TabItem[]
  activeKey: string
  onChange: (key: string) => void
  size?: 'sm' | 'md' | 'lg'
  className?: string
  style?: React.CSSProperties
}

export const WeFlowTabs: React.FC<WeFlowTabsProps> = ({
  items,
  activeKey,
  onChange,
  size = 'md',
  className = '',
  style
}) => {
  return (
    <div className={`weflow-tabs weflow-tabs-${size} ${className}`} style={style} role="tablist">
      {items.map((item) => {
        const isActive = item.key === activeKey
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={item.disabled}
            className={`weflow-tab-item ${isActive ? 'active' : ''}`}
            onClick={() => !item.disabled && onChange(item.key)}
          >
            {item.icon && <span className="weflow-tab-icon">{item.icon}</span>}
            <span className="weflow-tab-label">{item.label}</span>
            {item.badge !== undefined && item.badge !== null && (
              <span className="weflow-tab-badge">{item.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default WeFlowTabs
