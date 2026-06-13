import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Grip } from 'lucide-react'
import Tooltip from '../Tooltip'

const EMPTY_ACTIONS = []

export default function ActionRadialMenu({ actions = EMPTY_ACTIONS }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const btnRef  = useRef(null)
  const menuRef = useRef(null)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const enabled = actions.filter((a) => !a.hidden)
  const triggerLabel = 'More actions'

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (event) => {
      if (rootRef.current?.contains(event.target)) return
      if (menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onEsc = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onEsc)
    }
  }, [open])

  function handleToggle(event) {
    event.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({
        top:   rect.bottom + 6,
        right: window.innerWidth - rect.right,
      })
    }
    setOpen((v) => !v)
  }

  if (!enabled.length) return null

  return (
    <div ref={rootRef} style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
      <Tooltip label={triggerLabel}>
        <button
          ref={btnRef}
          type="button"
          aria-label={triggerLabel}
          onClick={handleToggle}
          style={{
            width: 40, height: 40, borderRadius: 999,
            border: 'none',
            background: open ? 'var(--accent-dim)' : 'transparent',
            color: open ? 'var(--accent)' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.14s ease, color 0.14s ease',
            position: 'relative', zIndex: 5,
          }}
        >
          <Grip size={16} />
        </button>
      </Tooltip>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top:   menuPos.top,
            right: menuPos.right,
            minWidth: 150,
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--card-3)',
            boxShadow: 'var(--shadow-lg)',
            padding: 5,
            zIndex: 9999,
          }}
        >
          {enabled.map((action) => (
            <button
              key={action.label}
              type="button"
              aria-label={action.label}
              disabled={action.disabled}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                if (!action.disabled) action.onClick()
              }}
              style={{
                width: '100%', border: 'none', background: 'none', borderRadius: 8,
                color: action.color || 'var(--text-secondary)',
                opacity: action.disabled ? 0.45 : 1,
                cursor: action.disabled ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 13, fontWeight: 600, padding: '9px 11px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
