import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function MobileNavDrawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="mobile-drawer-root" role="presentation">
      <button
        type="button"
        aria-label="Close navigation"
        className="mobile-drawer-backdrop"
        onClick={onClose}
      />
      <div id="mobile-nav-drawer" className="mobile-drawer-panel" role="dialog" aria-modal="true" aria-label="Navigation menu">
        <button
          type="button"
          className="mobile-drawer-close"
          aria-label="Close navigation menu"
          onClick={onClose}
        >
          <X size={22} strokeWidth={3} />
        </button>
        {children}
      </div>
    </div>
  )
}
