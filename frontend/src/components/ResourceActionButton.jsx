import { Loader2 } from 'lucide-react'
import Tooltip from './Tooltip'

export default function ResourceActionButton({
  icon,
  color,
  label,
  onClick,
  disabled = false,
  isLoading = false,
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled || isLoading}
        onClick={!disabled && !isLoading ? onClick : undefined}
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          border: 'none',
          background: 'transparent',
          color: disabled && !isLoading ? 'var(--text-muted)' : color,
          cursor: disabled || isLoading ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.12s, opacity 0.12s',
          flexShrink: 0,
          opacity: disabled && !isLoading ? 0.35 : 1,
        }}
        onMouseEnter={(e) => {
          if (!disabled && !isLoading) e.currentTarget.style.background = `color-mix(in srgb, ${color} 12%, transparent)`
        }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {isLoading ? <Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> : icon}
      </button>
    </Tooltip>
  )
}
