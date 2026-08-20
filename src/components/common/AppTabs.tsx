import React from 'react'
import './AppTabs.scss'

export interface TabItem {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode
  badge?: React.ReactNode | number
  disabled?: boolean
}

export interface AppTabsProps {
  items: TabItem[]
  activeKey: string
  onChange: (key: string) => void
  size?: 'sm' | 'md' | 'lg'
  className?: string
  style?: React.CSSProperties
}

export const AppTabs: React.FC<AppTabsProps> = ({
  items,
  activeKey,
  onChange,
  size = 'md',
  className = '',
  style
}) => {
  return (
    <div className={`app-tabs app-tabs-${size} ${className}`} style={style} role="tablist">
      {items.map((item) => {
        const isActive = item.key === activeKey
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={item.disabled}
            className={`app-tab-item ${isActive ? 'active' : ''}`}
            onClick={() => !item.disabled && onChange(item.key)}
          >
            {item.icon && <span className="app-tab-icon">{item.icon}</span>}
            <span className="app-tab-label">{item.label}</span>
            {item.badge !== undefined && item.badge !== null && (
              <span className="app-tab-badge">{item.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default AppTabs
