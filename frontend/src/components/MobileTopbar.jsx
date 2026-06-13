import { ChevronLeft, Menu, Plus, X } from 'lucide-react'

export default function MobileTopbar({ navOpen, onToggleNav, onNewInstance, title, onBack, backLabel }) {
  return (
    <header className="mobile-topbar">
      <button
        type="button"
        className="mobile-topbar-icon"
        data-tour="mobile-menu-toggle"
        aria-label={navOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={navOpen}
        aria-controls="mobile-nav-drawer"
        onClick={onToggleNav}
      >
        {navOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      <div className="mobile-topbar-title-wrap" data-tour="mobile-topbar-title">
        <p className="mobile-topbar-title">{title}</p>
        {onBack && (
          <button
            type="button"
            className="mobile-topbar-back-link"
            aria-label={backLabel ? `Back to ${backLabel}` : 'Back'}
            onClick={onBack}
          >
            <ChevronLeft size={16} />
            Get back
          </button>
        )}
      </div>

      <button
        type="button"
        className="mobile-topbar-icon mobile-topbar-icon-accent"
        data-tour="new-instance-topbar"
        aria-label="Create new instance"
        onClick={onNewInstance}
      >
        <Plus size={16} />
      </button>
    </header>
  )
}
