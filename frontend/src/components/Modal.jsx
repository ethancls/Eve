import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Base modal component.
 * Props:
 *   title       string
 *   size        'sm' | 'md' | 'lg' | 'xl'  (default 'md')
 *   onClose     () => void
 *   footer      ReactNode  (optional — custom footer buttons)
 *   ariaLabelledBy string (optional)
 *   ariaDescribedBy string (optional)
 *   initialFocusRef RefObject<HTMLElement> (optional)
 *   children
 */
function getFocusableElements(container) {
  if (!container) return []
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((el) => !el.hasAttribute('aria-hidden'))
}

export default function Modal({
  title,
  size = 'md',
  onClose,
  closeOnEsc = true,
  closeOnOverlay = true,
  showClose = true,
  footer,
  children,
  ariaLabelledBy,
  ariaDescribedBy,
  initialFocusRef,
}) {
  const overlayRef = useRef(null)
  const panelRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const internalTitleId = useId()
  const headingId = ariaLabelledBy || internalTitleId

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    if (!panel) return undefined

    const focusTarget = initialFocusRef?.current || getFocusableElements(panel)[0] || panel
    const frame = window.requestAnimationFrame(() => focusTarget.focus())

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!closeOnEsc) return
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const focusables = getFocusableElements(panel)
      if (!focusables.length) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
        return
      }

      if (active === last || !panel.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
      restoreFocusRef.current?.focus?.()
    }
  }, [closeOnEsc, initialFocusRef, onClose])

  // Prevent body scroll
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  const widths = { sm: 480, md: 580, lg: 700, xl: 880 }

  return (
    <div
      ref={overlayRef}
      role="presentation"
      onClick={e => { if (closeOnOverlay && e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        overscrollBehavior: 'contain',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        style={{
          background: 'var(--card-1)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          width: '100%',
          maxWidth: widths[size],
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          animation: 'modal-in 0.18s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <style>{`
          @keyframes modal-in {
            from { opacity:0; transform:scale(0.96) translateY(8px); }
            to   { opacity:1; transform:scale(1) translateY(0); }
          }
        `}</style>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 0',
          flexShrink: 0,
        }}>
          <h2
            id={headingId}
            style={{
              margin: 0, fontSize: 18, fontWeight: 800,
              letterSpacing: '-0.3px', lineHeight: 1.1,
            }}
          >
            {title}
          </h2>
          {showClose && (
            <button
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
              style={{
                background: 'var(--card-2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '5px 6px', cursor: 'pointer',
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)', margin: '18px 0 0' }} />

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', overflowX: 'visible', flex: 1, minWidth: 0 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
              {footer}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
