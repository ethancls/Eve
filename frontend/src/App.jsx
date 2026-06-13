import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft } from 'lucide-react'
import Sidebar from './components/Sidebar'
import ContainerSystemNotice from './components/ContainerSystemNotice'
import MobileTopbar from './components/MobileTopbar'
import MobileNavDrawer from './components/MobileNavDrawer'
import GuidedTour from './components/GuidedTour'
import { useStats } from './hooks/useStats'
import { useInstances } from './hooks/useInstances'
import useMediaQuery from './hooks/useMediaQuery'
import Dashboard from './pages/Dashboard'
import Containers from './pages/Containers'
import ContainerDetails from './pages/ContainerDetails'
import Projects from './pages/Projects'
import Instances from './pages/Instances'
import MachineDetails from './pages/MachineDetails'
import Networks from './pages/Networks'
import Images from './pages/Images'
import Volumes from './pages/Volumes'
import Builder from './pages/Builder'
import NewContainer from './pages/NewContainer'
import Users from './pages/Users'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import LoginPage from './pages/LoginPage'
import { Toaster } from 'sileo'
import { ThemeProvider } from './contexts/ThemeContext'
import { useTheme } from './contexts/useTheme'
import { authMe, setOnUnauthorized } from './api/client'

function routeTitle(pathname) {
  if (!pathname) return ''
  const path = pathname.split('?')[0].split('#')[0]
  if (path === '/dashboard' || path === '/') return 'Dashboard'
  if (path === '/containers') return 'Containers'
  if (path.startsWith('/containers/')) return decodeURIComponent(path.slice('/containers/'.length)) || 'Container'
  if (path === '/projects') return 'Projects'
  if (path === '/networks') return 'Networks'
  if (path === '/images') return 'Images'
  if (path === '/volumes') return 'Volumes'
  if (path === '/builder') return 'Builder'
  if (path === '/users') return 'Users'
  if (path === '/logs') return 'Activity'
  if (path === '/settings') return 'Settings'
return ''
}

function ThemedToaster() {
  const { theme } = useTheme()
  const isDark = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : theme !== 'light'
  return (
    <Toaster
      position="top-center"
      options={isDark
        ? { fill: '#ffffff', roundness: 14, autopilot: { expand: 300, collapse: 2500 }, styles: { title: 'text-black!', description: 'text-black/70!' } }
        : { fill: '#171717', roundness: 14, autopilot: { expand: 300, collapse: 2500 }, styles: { title: 'text-white!', description: 'text-white/70!' } }
      }
    />
  )
}

function NotFound() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 24, padding: 40,
    }}>
      <img src="/eve.svg" width={56} height={56} alt="Eve"/>
      <div style={{ textAlign: 'center' }}>
        <p className="mono" style={{ fontSize: 48, fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1, marginBottom: 12 }}>404</p>
        <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Page not found</p>
        <Link to="/dashboard" className="btn-accent" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}

function AppInner({ onLogout }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useMediaQuery('(max-width: 780px), ((pointer: coarse) and (max-height: 520px))')
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch (err) { void err; return false }
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const goNewInstance = useCallback(
    () => navigate('/containers/new', { state: { from: location.pathname } }),
    [navigate, location.pathname]
  )

  const toggleSidebar = useCallback(() => {
    if (isMobile) return
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('sidebar-collapsed', String(next)) } catch (err) { void err }
      return next
    })
  }, [isMobile])

  const currentPath = location.pathname
  const explicitFrom = typeof location.state?.from === 'string' ? location.state.from : null
  const fallbackFrom = (() => {
    if (currentPath === '/containers/new') return '/containers'
    if (currentPath.startsWith('/containers/')) return '/containers'
    return null
  })()
  const backTarget = explicitFrom && explicitFrom !== currentPath ? explicitFrom : fallbackFrom

  function routeLabel(pathname) {
    if (!pathname) return ''
    const path = pathname.split('?')[0].split('#')[0]
    if (path === '/dashboard') return 'Dashboard'
    if (path === '/containers') return 'Containers'
    if (path.startsWith('/containers/')) return 'Containers'
    if (path === '/projects') return 'Projects'
    if (path.startsWith('/containers/')) return 'Containers'
    if (path === '/networks') return 'Networks'
    if (path === '/images') return 'Images'
    if (path === '/volumes') return 'Volumes'
    if (path === '/builder') return 'Builder'
    if (path === '/users') return 'Users'
    if (path === '/logs') return 'Activity'
    if (path === '/settings') return 'Settings'
    return 'Previous page'
  }

  const pageTitle = routeTitle(location.pathname)

  // Document title
  useEffect(() => {
    document.title = pageTitle ? `Eve | ${pageTitle}` : 'Eve'
  }, [pageTitle])

  // Global keyboard shortcuts
  useEffect(() => {
    const fn = (e) => {
      const tag = document.activeElement?.tagName
      const key = (e.key || '').toLowerCase()
      const code = (e.code || '').toLowerCase()
      const shortcutKey = code.startsWith('key') ? code.slice(3) : key
      if (tag === 'TEXTAREA') return
      if (tag === 'INPUT' && shortcutKey !== 'k') return
      if (!(e.metaKey || e.ctrlKey)) return
      if (shortcutKey === 'b') { e.preventDefault(); toggleSidebar() }
      else if (shortcutKey === 'd') { e.preventDefault(); navigate('/dashboard', { state: { from: location.pathname } }) }
      else if (shortcutKey === 'n') { e.preventDefault(); goNewInstance() }
    }
    document.addEventListener('keydown', fn, true)
    return () => document.removeEventListener('keydown', fn, true)
  }, [toggleSidebar, goNewInstance, navigate, location.pathname])

  useStats()
  useInstances()
  const sidebarCollapsed = !isMobile && collapsed
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to Main Content</a>
      <div className={`layout${isMobile ? ' layout-mobile' : ''}`}>
      {!isMobile ? (
        <Sidebar
          onNewInstance={goNewInstance}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          onLogout={onLogout}
        />
      ) : (
        <>
          <MobileTopbar
            navOpen={mobileNavOpen}
            onToggleNav={() => setMobileNavOpen((prev) => !prev)}
            onNewInstance={goNewInstance}
            title={pageTitle || 'Eve'}
            backLabel={backTarget ? routeLabel(backTarget) : ''}
            onBack={backTarget ? () => navigate(backTarget, { state: { from: location.pathname } }) : null}
          />
          <MobileNavDrawer
            open={mobileNavOpen}
            onClose={() => setMobileNavOpen(false)}
          >
            <Sidebar
              onNewInstance={goNewInstance}
              collapsed={false}
              onToggle={() => {}}
              onLogout={onLogout}
              isMobile
              disableCollapse
              onNavigate={() => setMobileNavOpen(false)}
            />
          </MobileNavDrawer>
        </>
      )}

      <main id="main-content" className={`main-content${isMobile ? ' main-content-mobile' : ''}`}>
        <ContainerSystemNotice />
        {backTarget && !isMobile && (
          <div className="global-back-link-wrap">
            <Link
              to={backTarget}
              state={{ from: location.pathname }}
              className="global-back-link"
            >
              <ChevronLeft size={17} />
              Back to {routeLabel(backTarget)}
            </Link>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard onNewInstance={goNewInstance} />} />
          <Route path="/containers" element={<Containers />} />
          <Route path="/containers/new" element={<NewContainer />} />
          <Route path="/containers/:name" element={<ContainerDetails />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/instances" element={<Instances onNewInstance={goNewInstance} />} />
          <Route path="/instances/:name" element={<MachineDetails />} />
          <Route path="/networks" element={<Networks />} />
          <Route path="/images" element={<Images />} />
          <Route path="/volumes" element={<Volumes />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/users" element={<Users />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
<Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <GuidedTour isMobile={isMobile} setMobileNavOpen={setMobileNavOpen} />
      </div>
    </>
  )
}

export default function App() {
  const [authState, setAuthState] = useState('loading') // 'loading' | 'authenticated' | 'unauthenticated'

  useEffect(() => {
    authMe().then(user => {
      setAuthState(user ? 'authenticated' : 'unauthenticated')
    })
  }, [])

  useEffect(() => {
    setOnUnauthorized(() => setAuthState('unauthenticated'))
  }, [])

  if (authState === 'loading') {
    return (
      <ThemeProvider>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
          <div className="daemon-dot running" style={{ width: 10, height: 10 }} />
        </div>
      </ThemeProvider>
    )
  }

  if (authState === 'unauthenticated') {
    return (
      <ThemeProvider>
        <LoginPage onLogin={() => setAuthState('authenticated')} />
        <ThemedToaster />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppInner onLogout={() => setAuthState('unauthenticated')} />
      </BrowserRouter>
      <ThemedToaster />
    </ThemeProvider>
  )
}
