import React, { useRef } from 'react'
import { Search as SearchIcon, X } from 'lucide-react'
import './WeFlowSearch.scss'

export interface WeFlowSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onSearch?: (value: string) => void
  onClear?: () => void
  allowClear?: boolean
  size?: 'sm' | 'md' | 'lg'
  autoFocus?: boolean
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

export const WeFlowSearch: React.FC<WeFlowSearchProps> = ({
  value,
  onChange,
  placeholder = '搜索...',
  onSearch,
  onClear,
  allowClear = true,
  size = 'md',
  autoFocus = false,
  disabled = false,
  className = '',
  style
}) => {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClear = () => {
    onChange('')
    if (onClear) onClear()
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSearch) {
      onSearch(value)
    }
  }

  return (
    <div className={`weflow-search weflow-search-${size} ${disabled ? 'disabled' : ''} ${className}`} style={style}>
      <span className="weflow-search-icon">
        <SearchIcon size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className="weflow-search-input"
      />
      {allowClear && value && !disabled && (
        <button
          type="button"
          className="weflow-search-clear"
          onClick={handleClear}
          aria-label="清除"
        >
          <X size={size === 'sm' ? 12 : size === 'lg' ? 16 : 14} />
        </button>
      )}
    </div>
  )
}

export default WeFlowSearch
