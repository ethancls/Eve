import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { version as APP_VERSION } from '../../package.json'
import { Plus, Sun, Moon, Monitor, ChevronDown, ChevronLeft, EthernetPort, LogOut, Settings, Users, History, Layers2, LayoutGrid, Lock, Github, Package, Database, Boxes } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from '../contexts/useTheme'
import { api, authLogout } from '../api/client'
import ForbiddenActionModal from './ForbiddenActionModal'
import { canAccessUsers, normalizeRole } from '../utils/rbac'
import useShortcutPlatform from '../hooks/useShortcutPlatform'

const NAV = [
  { group: null,        to: '/dashboard', Icon: LayoutGrid, label: 'Dashboard' },
  { group: 'Compute',   to: '/containers', Icon: Boxes, label: 'Containers' },
  { group: 'Compute',   to: '/projects',   Icon: Package, label: 'Projects' },
  { group: 'Resources', to: '/networks',  Icon: EthernetPort, label: 'Networks' },
  { group: 'Resources', to: '/images',    Icon: Layers2, label: 'Images' },
  { group: 'Resources', to: '/volumes',   Icon: Database, label: 'Volumes' },
  { group: 'System',    to: '/users',     Icon: Users, label: 'Users' },
  { group: 'System',    to: '/logs',      Icon: History, label: 'Logs' },
  { group: 'System',    to: '/settings',  Icon: Settings, label: 'Settings' },
]

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
]
const MOBILE_THEME_OPTIONS = THEME_OPTIONS
const THEME_ORDER = ['dark', 'light', 'system']

function canAccessNavItem(role, to) {
  if (to === '/users') return canAccessUsers(role)
  return true
}

function SidebarAvatar({ user, size = 30 }) {
  const [failed, setFailed] = useState(false)
  const avatar = user?.avatar_url || ''

  const fallback = String(user?.name || user?.login || '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <span className="sidebar-avatar" style={{ '--avatar-size': `${size}px` }}>
      {avatar && !failed ? (
        <img
          src={avatar}
          alt={user?.login || 'avatar'}
          width={size}
          height={size}
          className="sidebar-avatar-image"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="mono sidebar-avatar-fallback">
          {fallback}
        </span>
      )}
    </span>
  )
}

export default function Sidebar({
  onNewInstance,
  collapsed,
  onToggle,
  onLogout,
  isMobile = false,
  disableCollapse = false,
  onNavigate,
}) {
  const { theme, setTheme } = useTheme()
  const { isApple } = useShortcutPlatform()
  const location = useLocation()
  const pathname = location.pathname
  const effectiveCollapsed = !disableCollapse && collapsed
  const collapseShortcut = isApple ? '⌘B' : 'Ctrl+B'

  const { data: meData } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => api.getCurrentUser(),
    staleTime: 60000,
    retry: false,
  })
  const me = meData?.user || null
  const [forbiddenNav, setForbiddenNav] = useState(null)
  const [mobileThemeOpen, setMobileThemeOpen] = useState(false)
  const mobileThemeRef = useRef(null)
  const currentRole = normalizeRole(me?.role)

  const accountName = me?.name || me?.login || 'Account'
  const accountLogin = me?.login || 'local'

  async function handleSignOut() {
    try {
      await authLogout()
    } finally {
      onNavigate?.()
      onLogout?.()
    }
  }

  function handleNewInstance() {
    onNavigate?.()
    onNewInstance?.()
  }

  const activeTheme = useMemo(
    () => THEME_OPTIONS.find((option) => option.value === theme) || THEME_OPTIONS[0],
    [theme],
  )
  const mobileActiveTheme = useMemo(
    () => MOBILE_THEME_OPTIONS.find((option) => option.value === theme) || MOBILE_THEME_OPTIONS[0],
    [theme],
  )
  const MobileActiveThemeIcon = mobileActiveTheme.Icon
  const navEntries = useMemo(
    () => NAV.map((item) => ({ ...item, allowed: canAccessNavItem(currentRole, item.to) })),
    [currentRole],
  )

  function cycleTheme() {
    const currentIndex = THEME_ORDER.indexOf(theme)
    const nextTheme = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length]
    setTheme(nextTheme)
  }

  useEffect(() => {
    if (!isMobile || !mobileThemeOpen) return undefined

    const onPointerDown = (event) => {
      if (!mobileThemeRef.current?.contains(event.target)) setMobileThemeOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMobileThemeOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isMobile, mobileThemeOpen])

  return (
    <aside
      className={`sidebar sidebar-shell${effectiveCollapsed ? ' collapsed' : ''}${isMobile ? ' sidebar-mobile' : ''}`}
    >
      {/* ── Logo row ── */}
      <div className="sidebar-header">
        <div
          className={`sidebar-brand${effectiveCollapsed ? ' is-collapsed' : ''}`}
          onClick={!disableCollapse ? onToggle : undefined}
          role={!disableCollapse ? 'button' : undefined}
          tabIndex={!disableCollapse ? 0 : -1}
          onKeyDown={(e) => {
            if (!disableCollapse && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              onToggle()
            }
          }}
        >
          <img
            src="/eve.svg"
            width={40} height={40}
            alt="Eve"
            className="sidebar-brand-logo"
          />
          <div className="sidebar-brand-copy sidebar-label">
            <span className="sidebar-brand-title">Eve</span>
          </div>
        </div>

        {!effectiveCollapsed && !disableCollapse && (
          <button
            type="button"
            aria-label={`Collapse sidebar (${collapseShortcut})`}
            title={`Collapse sidebar (${collapseShortcut})`}
            onClick={onToggle}
            className="sidebar-collapse-toggle"
          >
            <ChevronLeft size={22} color="var(--accent-fill)" strokeWidth={3} />
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {navEntries.map((item, idx) => {
          const { group, to, label, matchPaths, matchPrefix, allowed } = item
          const tourId = to === '/dashboard'
            ? 'nav-dashboard'
            : to === '/instances'
              ? 'nav-instances'
              : to === '/networks'
                ? 'nav-networks'
                : to === '/settings'
                  ? 'nav-settings'
                  : undefined
          const isActive = (matchPaths && matchPaths.includes(pathname)) || (matchPrefix && pathname.startsWith(matchPrefix)) || pathname === to
          const prevGroup = idx > 0 ? navEntries[idx - 1].group : null
          const startsGroup = !!group && group !== prevGroup
          return (
            <div key={to} className="sidebar-nav-section">
              {!effectiveCollapsed && startsGroup && (
                <p className="section-label sidebar-group-label">
                  {group}
                </p>
              )}
              {effectiveCollapsed && startsGroup && (
                <div aria-hidden="true" className="sidebar-group-divider">
                  <span className="sidebar-group-divider-line" />
                </div>
              )}
              {allowed ? (
                <NavLink
                  to={to}
                  state={{ from: pathname }}
                  data-tour={tourId}
                  title={effectiveCollapsed ? label : undefined}
                  className={() => `nav-item${isActive ? ' active' : ''}`}
                  onClick={() => onNavigate?.()}
                >
                  <span className="sidebar-nav-icon-wrap">
                    <item.Icon size={24} />
                  </span>

                  <span className="sidebar-label sidebar-nav-label">
                    {label}
                  </span>
                </NavLink>
              ) : (
                <button
                  type="button"
                  data-tour={tourId}
                  title={effectiveCollapsed ? `${label} (Restricted)` : undefined}
                  className="nav-item nav-item-locked"
                  onClick={() => setForbiddenNav({
                    title: 'Action Not Permitted',
                    description: `Your role does not allow access to ${label}.`,
                  })}
                >
                  <span className="sidebar-nav-icon-wrap">
                    <item.Icon size={24} />
                  </span>
                  <span className="sidebar-label sidebar-nav-label">
                    {label}
                    {!effectiveCollapsed && <Lock size={11} className="sidebar-nav-lock" />}
                  </span>
                </button>
              )}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-fill" />

      {/* New instance (desktop only) */}
      {!isMobile && (
        effectiveCollapsed ? (
          <button
            type="button"
            aria-label="New Instance"
            title="New Instance"
            onClick={handleNewInstance}
            className="sidebar-new-instance-button"
          >
            <Plus size={16} color="#0a0a0a" />
          </button>
        ) : (
          <button
            className="btn-accent sidebar-new-instance-button-expanded"
            onClick={handleNewInstance}
          >
            <Plus size={13} /> New Instance
          </button>
        )
      )}

      {/* Theme */}
      <div className={`sidebar-footer${effectiveCollapsed ? ' is-collapsed' : ''}`}>
        {!isMobile && (
          !effectiveCollapsed ? (
            <div className="sidebar-theme-picker" role="group" aria-label="Theme">
              {THEME_OPTIONS.map((option) => {
                const isActive = theme === option.value
                const Icon = option.Icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTheme(option.value)}
                    className={`sidebar-theme-picker-option${isActive ? ' is-active' : ''}`}
                    aria-label={`Set ${option.label} theme`}
                    aria-pressed={isActive}
                  >
                    <Icon size={16} />
                  </button>
                )
              })}
            </div>
          ) : (
            <button
              type="button"
              aria-label="Switch theme"
              title={`Theme: ${activeTheme.label}`}
              className="sidebar-theme-cycle is-collapsed"
              onClick={cycleTheme}
            >
              <span className="sidebar-theme-cycle-icon">
                <activeTheme.Icon size={18} />
              </span>
            </button>
          )
        )}

        {!effectiveCollapsed ? (
          <div className="sidebar-user-row">
            <SidebarAvatar key={me?.avatar_url || ''} user={me} size={isMobile ? 30 : 34} />
            <div className="sidebar-user-meta">
              <p className="sidebar-user-name">{accountName}</p>
              <p className="mono sidebar-user-login">
                @{accountLogin}
              </p>
            </div>
            {isMobile && (
              <div className="sidebar-mobile-theme-dropdown" ref={mobileThemeRef}>
                <button
                  type="button"
                  className="sidebar-mobile-theme-trigger"
                  data-tour="mobile-theme-toggle"
                  aria-label="Theme options"
                  aria-haspopup="menu"
                  aria-expanded={mobileThemeOpen}
                  onClick={() => setMobileThemeOpen((open) => !open)}
                >
                  <MobileActiveThemeIcon size={14} />
                  <ChevronDown size={12} />
                </button>
                {mobileThemeOpen && (
                  <div className="sidebar-mobile-theme-menu" role="menu" aria-label="Theme">
                    {MOBILE_THEME_OPTIONS.map((option) => {
                      const Icon = option.Icon
                      const isActive = option.value === theme
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`sidebar-mobile-theme-option${isActive ? ' is-active' : ''}`}
                          title={option.label}
                          aria-label={option.label}
                          role="menuitemradio"
                          aria-checked={isActive}
                          onClick={() => {
                            setTheme(option.value)
                            setMobileThemeOpen(false)
                          }}
                        >
                          <Icon size={14} />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              data-tour="sidebar-logout"
              onClick={handleSignOut}
              className="sidebar-logout-button"
            >
              <LogOut size={18} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={handleSignOut}
            className="sidebar-footer-action-button sidebar-footer-action-button-danger"
          >
            <LogOut size={18} />
          </button>
        )}

        {!effectiveCollapsed && (
          <div className="sidebar-footer-version-row">
            <p className="mono sidebar-footer-version-text">
              v{APP_VERSION}
            </p>
            <a
              className="sidebar-footer-github-link"
              href="https://github.com/ethancls/Eve"
              target="_blank"
              rel="noreferrer"
              aria-label="Open Eve GitHub repository"
              title="GitHub"
            >
              <Github size={14} />
            </a>
          </div>
        )}
      </div>

      {forbiddenNav && (
        <ForbiddenActionModal
          title={forbiddenNav.title}
          description={forbiddenNav.description}
          onClose={() => setForbiddenNav(null)}
        />
      )}

    </aside>
  )
}
