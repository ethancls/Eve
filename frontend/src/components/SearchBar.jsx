import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import { Search, X, Box, CornerDownLeft, LayoutGrid, EthernetPort, Layers2, History, Settings, Users } from 'lucide-react'
import ContainerIcon from './icons/ContainerIcon'
import { useInstances } from '../hooks/useInstances'
import useShortcutPlatform from '../hooks/useShortcutPlatform'
import { api } from '../api/client'
import { canAccessUsers, canReadAuthSettings, normalizeRole } from '../utils/rbac'

// Add new pages here (labels, routes, keywords) to extend navigation + categories quickly.
const PAGE_ITEMS = [
  { label: 'Dashboard', to: '/dashboard', group: 'Overview', Icon: LayoutGrid, keywords: ['home', 'overview'] },
  { label: 'Containers', to: '/containers', group: 'Compute', Icon: ContainerIcon, keywords: ['vm', 'machines', 'compute', 'instances'] },
  { label: 'Networks', to: '/networks', group: 'Resources', Icon: EthernetPort, keywords: ['bridge', 'network', 'br0'] },
  { label: 'Images', to: '/images', group: 'Resources', Icon: Layers2, keywords: ['image', 'template', 'ubuntu'] },
  { label: 'Users', to: '/users', group: 'System', Icon: Users, keywords: ['rbac', 'accounts'] },
  { label: 'Activity', to: '/logs', group: 'System', Icon: History, keywords: ['logs', 'history'] },
  { label: 'Settings', to: '/settings', group: 'System', Icon: Settings, keywords: ['preferences', 'config', 'oidc'] },
]

function canAccessSearchPage(role, to) {
  if (to === '/users') return canAccessUsers(role)
  return true
}

function scoreText(text, query, weight = 1) {
  const source = String(text || '')
    .toLowerCase()
    .replace(/[_./:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const q = String(query || '')
    .toLowerCase()
    .replace(/[_./:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!source || !q) return 0
  if (source === q) return 160 * weight
  if (source.startsWith(q)) return 125 * weight
  if (source.includes(q)) return 78 * weight
  return 0
}

function scoreEntry(entry, query) {
  const titleScore = scoreText(entry.title, query, 1.65)
  const subtitleScore = scoreText(entry.subtitle, query, 1.08)
  const tokenAggregate = scoreText((entry.tokens || []).join(' '), query, 1.32)
  const tokenPieceScore = (entry.tokens || []).reduce((best, token) => Math.max(best, scoreText(token, query, 1.25)), 0)
  const tokenScore = Math.max(tokenAggregate, tokenPieceScore)
  const sectionScore = scoreText(entry.section, query, 0.65)
  const base = Math.max(titleScore, subtitleScore, tokenScore, sectionScore)
  if (!base) return 0

  let boost = 0
  if (entry.section === 'Pages') boost += 5
  if (entry.kind === 'instance') boost += 3
  return base + boost
}

function safeEntries(input) {
  if (!input) return []
  if (Array.isArray(input)) {
    return input
      .map((item, index) => [String(item?.name || item?.image || item?.id || `item-${index}`), item])
      .filter(([key]) => Boolean(key))
  }
  if (typeof input === 'object') return Object.entries(input)
  return []
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function flattenTokens(value, depth = 0) {
  if (value == null || depth > 3) return []
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) {
    return value.slice(0, 24).flatMap((item) => flattenTokens(item, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .slice(0, 36)
      .flatMap(([k, v]) => [k, ...flattenTokens(v, depth + 1)])
  }
  return []
}

function uniqueTokens(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))]
}

function flattenSettingLeaves(input, prefix = '') {
  if (!isPlainObject(input)) return [{ key: prefix || 'value', value: input }]
  return Object.entries(input).flatMap(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) return flattenSettingLeaves(value, nextPrefix)
    return [{ key: nextPrefix, value }]
  })
}

function mapNetworkEntries(data) {
  const rows = Array.isArray(data?.networks) ? data.networks : []
  return rows.map((item, index) => {
    const name = String(item?.name || `network-${index}`)
    const type = String(item?.type || 'unknown')
    const address = String(item?.address || '')
    const status = String(item?.status || 'unknown')
    const instances = Array.isArray(item?.instances) ? item.instances.map((v) => String(v)) : []

    return {
      key: `net:${name}`,
      kind: 'route',
      to: '/networks',
      section: 'Networks',
      Icon: EthernetPort,
      title: name,
      subtitle: [type, address || status].filter(Boolean).join(' · '),
      tokens: uniqueTokens([name, type, address, status, ...instances]),
    }
  })
}

function mapImageEntries(data) {
  const catalog = data && typeof data === 'object' && data.images ? data.images : data
  if (!catalog || typeof catalog !== 'object') return []

  const rawImages = safeEntries(catalog.images)
  const rawBlueprints = safeEntries(catalog['blueprints (deprecated)'] || catalog.blueprints)

  const imageEntries = rawImages.map(([name, meta]) => {
    const aliases = Array.isArray(meta?.aliases) ? meta.aliases : []
    const description = [meta?.os, meta?.release].filter(Boolean).join(' ').trim()
    return {
      key: `img:${name}`,
      kind: 'route',
      to: '/images',
      section: 'Images',
      Icon: Layers2,
      title: name,
      subtitle: description || 'Image',
      tokens: uniqueTokens([name, description, ...(aliases || []), ...flattenTokens(meta)]),
    }
  })

  const blueprintEntries = rawBlueprints.map(([name, meta]) => {
    const aliases = Array.isArray(meta?.aliases) ? meta.aliases : []
    const description = [meta?.os, meta?.release].filter(Boolean).join(' ').trim()
    return {
      key: `bp:${name}`,
      kind: 'route',
      to: '/images',
      section: 'Images',
      Icon: Layers2,
      title: name,
      subtitle: description ? `${description} · Deprecated` : 'Deprecated blueprint',
      tokens: uniqueTokens([name, description, 'deprecated', ...(aliases || []), ...flattenTokens(meta)]),
    }
  })

  return [...imageEntries, ...blueprintEntries]
}

function mapSettingsEntries(data) {
  const valuesRoot = isPlainObject(data?.values)
    ? data.values
    : isPlainObject(data?.settings?.values)
      ? data.settings.values
      : isPlainObject(data?.settings)
        ? data.settings
        : isPlainObject(data)
          ? data
          : null
  if (!valuesRoot) return []

  const tabLabel = {
    system: 'System',
    container: 'Apple Container',
    auth: 'Auth',
    shortcuts: 'Shortcuts',
  }

  return flattenSettingLeaves(valuesRoot)
    .slice(0, 140)
    .map(({ key, value }) => {
      const settingKey = String(key || '')
        .replace(/^values\./, '')
        .replace(/^settings\./, '')
      const values = flattenTokens(value)
      const normalizedKey = settingKey.toLowerCase()
      const humanKey = settingKey.replace(/[._-]+/g, ' ').trim()
      let tab = 'system'
      if (normalizedKey.startsWith('build.') || normalizedKey.startsWith('container.') || normalizedKey.startsWith('machine.') || normalizedKey.startsWith('kernel.') || normalizedKey.startsWith('registry.') || normalizedKey.startsWith('vminit.') || normalizedKey.startsWith('network.')) tab = 'container'
      if (normalizedKey.startsWith('auth.') || normalizedKey.includes('oidc') || normalizedKey.includes('openid')) tab = 'auth'
      const focus = null
      const valueText = String(value ?? '').trim()

      return {
        key: `setting:${settingKey}`,
        kind: 'route',
        to: '/settings',
        section: 'Settings',
        Icon: Settings,
        title: settingKey,
        subtitle: [tabLabel[tab], valueText || values.slice(0, 2).join(' · ')].filter(Boolean).join(' · ') || 'Setting',
        tokens: uniqueTokens([settingKey, humanKey, valueText, ...values]),
        tab,
        focus,
      }
    })
}

function mapAuthEntries(data) {
  if (!data || typeof data !== 'object') return []

  const oidc = data.oidc || {}
  const local = data.local || {}
  const oidcTokens = uniqueTokens([
    'oidc',
    'openid',
    oidc.enabled ? 'enabled' : 'disabled',
    oidc.issuer,
    oidc.client_id,
    oidc.redirect_url,
    oidc.scopes,
    oidc.claim_login,
    oidc.claim_name,
    oidc.claim_avatar,
    oidc.claim_groups,
    oidc.admin_groups,
    ...flattenTokens(oidc),
  ])

  const localTokens = uniqueTokens([
    'local',
    'password',
    local.password_enabled ? 'enabled' : 'disabled',
    ...flattenTokens(local),
  ])

  return [
    {
      key: 'auth:oidc',
      kind: 'route',
      to: '/settings',
      section: 'Settings',
      Icon: Settings,
      title: 'OIDC configuration',
      subtitle: oidc.issuer ? `Issuer: ${oidc.issuer}` : 'OpenID Connect settings',
      tokens: oidcTokens,
      tab: 'auth',
      focus: 'auth-issuer',
    },
    {
      key: 'auth:local-password',
      kind: 'route',
      to: '/settings',
      section: 'Settings',
      Icon: Settings,
      title: 'Password login',
      subtitle: local.password_enabled ? 'Enabled' : 'Disabled',
      tokens: localTokens,
      tab: 'auth',
    },
  ]
}

const SEARCH_SOURCES = [
  {
    id: 'networks',
    queryKey: ['networks'],
    queryFn: () => api.getNetworks(),
    staleTime: 30000,
    mapEntries: mapNetworkEntries,
  },
  {
    id: 'images',
    queryKey: ['images-catalog'],
    queryFn: () => api.getImages(),
    staleTime: 5 * 60 * 1000,
    mapEntries: mapImageEntries,
  },
  {
    id: 'settings',
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: 60000,
    mapEntries: mapSettingsEntries,
  },
  {
    id: 'auth-settings',
    queryKey: ['auth-settings'],
    queryFn: () => api.getAuthSettings(),
    staleTime: 60000,
    allow: (role) => canReadAuthSettings(role),
    mapEntries: mapAuthEntries,
  },
]

const SEARCH_SECTION_ORDER = ['Pages', 'Containers', 'Networks', 'Images', 'Settings']

export default function SearchBar({ fluid = false, triggerLabel = 'Search…', controlHeight = 36, tourId = null }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { instances } = useInstances()
  const { isApple, modifierKeyDisplay } = useShortcutPlatform()

  const { data: meData } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => api.getCurrentUser(),
    staleTime: 60000,
    retry: false,
  })

  const currentRole = normalizeRole(meData?.user?.role)

  const sourceDefs = useMemo(
    () => SEARCH_SOURCES.filter((source) => (source.allow ? source.allow(currentRole) : true)),
    [currentRole],
  )

  const sourceQueries = useQueries({
    queries: sourceDefs.map((source) => ({
      queryKey: source.queryKey,
      queryFn: source.queryFn,
      staleTime: source.staleTime,
      retry: false,
      enabled: open,
    })),
  })

  const sourceEntries = useMemo(
    () => sourceDefs.flatMap((source, index) => source.mapEntries(sourceQueries[index]?.data)),
    [sourceDefs, sourceQueries],
  )

  const accessiblePages = useMemo(
    () => PAGE_ITEMS.filter((item) => canAccessSearchPage(currentRole, item.to)),
    [currentRole],
  )

  const pageEntries = useMemo(
    () => accessiblePages.map((item) => ({
      key: `page:${item.to}`,
      kind: 'route',
      to: item.to,
      section: 'Pages',
      Icon: item.Icon,
      title: item.label,
      subtitle: item.group,
      tokens: uniqueTokens([item.label, item.to, ...(item.keywords || [])]),
    })),
    [accessiblePages],
  )

  const instanceEntries = useMemo(
    () => instances.map((instance) => ({
      key: `container:${instance.name}`,
      kind: 'instance',
      name: instance.name,
      section: 'Containers',
      Icon: Box,
      title: String(instance.name || ''),
      subtitle: String(instance.state || 'Unknown'),
      tokens: uniqueTokens([
        instance.name,
        instance.state,
        instance.image,
        ...(instance.ipv4 || []),
      ]),
      badge: String(instance.state || ''),
    })),
    [instances],
  )

  const allEntries = useMemo(
    () => [...pageEntries, ...instanceEntries, ...sourceEntries],
    [pageEntries, instanceEntries, sourceEntries],
  )

  const quickItems = useMemo(
    () => [...instances]
      .filter((instance) => instance.state === 'Running')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .slice(0, 3),
    [instances],
  )

  // Cmd/Ctrl+K toggles the search modal.
  useEffect(() => {
    const fn = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (e.repeat) return
        setOpen((prev) => !prev)
        return
      }
      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    let raf1 = null
    let raf2 = null

    const focusInput = () => {
      inputRef.current?.focus({ preventScroll: true })
    }

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(focusInput)
    })

    document.body.style.overflow = 'hidden'
    return () => {
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const q = query.trim()

  const queryResults = useMemo(() => {
    if (!q) return []

    return allEntries
      .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
      .slice(0, 50)
      .map((item) => item.entry)
  }, [allEntries, q])

  const queryResultsBySection = useMemo(() => {
    if (!q) return []

    const grouped = new Map()
    queryResults.forEach((entry) => {
      if (!grouped.has(entry.section)) grouped.set(entry.section, [])
      grouped.get(entry.section).push(entry)
    })

    return SEARCH_SECTION_ORDER
      .filter((section) => grouped.has(section))
      .map((section) => ({ section, items: grouped.get(section) }))
  }, [q, queryResults])

  const topResult = useMemo(() => {
    if (q) return queryResults[0] || null

    if (quickItems.length > 0) {
      return { key: `instance:${quickItems[0].name}` }
    }

    if (accessiblePages.length > 0) {
      return { key: `page:${accessiblePages[0].to}` }
    }

    return null
  }, [q, queryResults, quickItems, accessiblePages])

  const topResultKey = topResult?.key || ''

  function openInstance(name) {
    setOpen(false)
    setQuery('')
    navigate(`/containers/${encodeURIComponent(name)}`, { state: { from: location.pathname } })
  }

  function openRoute(path, options = {}) {
    const params = new URLSearchParams()
    if (options.tab) params.set('tab', options.tab)
    if (options.focus) params.set('focus', options.focus)
    const target = params.toString() ? `${path}?${params.toString()}` : path
    setOpen(false)
    setQuery('')
    navigate(target, { state: { from: location.pathname } })
  }

  function openEntry(entry) {
    if (!entry) {
      setOpen(false)
      return
    }

    if (entry.kind === 'instance') {
      openInstance(entry.name)
      return
    }

    openRoute(entry.to, { tab: entry.tab, focus: entry.focus })
  }

  function openTopResult() {
    if (q) {
      openEntry(queryResults[0] || null)
      return
    }

    if (quickItems.length > 0) {
      openInstance(quickItems[0].name)
      return
    }

    if (accessiblePages.length > 0) {
      openRoute(accessiblePages[0].to)
      return
    }

    setOpen(false)
  }

  function stateColor(state) {
    if (state === 'Running') return 'var(--running)'
    if (state === 'Stopped') return 'var(--stopped)'
    return 'var(--suspended)'
  }

  function renderResultRow(entry) {
    const isTop = entry.key === topResultKey
    const badgeColor = entry.badge ? stateColor(entry.badge) : null

    return (
      <button
        key={entry.key}
        type="button"
        onClick={() => openEntry(entry)}
        className="global-search-result-row"
      >
        <div className="global-search-result-icon" style={badgeColor ? { color: badgeColor } : undefined}>
          <entry.Icon size={13} />
        </div>
        <div className="global-search-result-main">
          <p className="mono global-search-result-name">{entry.title}</p>
          {entry.subtitle && <p className="global-search-result-subtle">{entry.subtitle}</p>}
        </div>
        {isTop && (
          <kbd className="global-search-enter-hint">
            <CornerDownLeft size={11.5} strokeWidth={2.1} />
            <span>Enter</span>
          </kbd>
        )}
        {entry.badge && (
          <span
            className="badge global-search-result-badge"
            style={{
              background: entry.badge === 'Running' ? 'rgba(111,168,255,0.12)' : entry.badge === 'Stopped' ? 'rgba(240,71,71,0.1)' : 'rgba(255,159,10,0.1)',
              color: badgeColor,
              border: `1px solid ${badgeColor}33`,
            }}
          >
            {entry.badge}
          </span>
        )}
      </button>
    )
  }

  const indexing = open && sourceQueries.some((queryState) => queryState.isLoading)

  return (
    <div
      className="global-search"
      style={{
        position: 'relative',
        flexShrink: 0,
        minWidth: 0,
        ...(fluid ? { flex: '1 1 auto' } : null),
      }}
    >
      <button
        onClick={() => { setOpen(true) }}
        className="global-search-trigger"
        data-tour={tourId || undefined}
        style={{
          width: fluid ? '100%' : 'clamp(140px, 23vw, 200px)', display: 'flex', alignItems: 'center', gap: 9,
          background: 'var(--card-2)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '0 13px', cursor: 'text',
          color: 'var(--text-secondary)', transition: 'border-color 0.15s',
          fontSize: 13, height: controlHeight, lineHeight: 1,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        <Search size={13} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5 }}>{triggerLabel}</span>
        <kbd
          className="global-search-kbd"
          style={{
            fontSize: 11.5, fontFamily: 'IBM Plex Mono', fontWeight: 500,
            background: 'var(--card-3)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '3px 7px', color: 'var(--text-primary)', flexShrink: 0,
            lineHeight: 1, display: 'inline-flex', alignItems: 'center', gap: 3,
          }}
        >
          {isApple
            ? <span style={{ fontSize: 13.5, lineHeight: 1, transform: 'translateY(1px)' }}>⌘</span>
            : <span style={{ fontSize: 10.8, lineHeight: 1 }}>{modifierKeyDisplay}</span>}
          <span>K</span>
        </kbd>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="global-search-modal-root" role="presentation">
          <button
            type="button"
            className="global-search-modal-backdrop"
            aria-label="Close search"
            onClick={() => setOpen(false)}
          />
          <div className="global-search-modal-panel" role="dialog" aria-modal="true" aria-label="Global search">
            <div className="global-search-modal-input-row">
              <Search size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <input
                ref={inputRef}
                autoFocus
                className="global-search-modal-input-field"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    openTopResult()
                  }
                }}
                placeholder="Search pages, containers, images, networks, settings..."
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="global-search-modal-clear">
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="global-search-results-shell">
              {!q && (
                <p className="global-search-section-label">QUICK ACCESS</p>
              )}
              {!q && quickItems.length === 0 && (
                <p className="global-search-empty">No running containers for quick access</p>
              )}
              {!q && quickItems.map((instance) => renderResultRow({
                key: `instance:${instance.name}`,
                kind: 'instance',
                name: instance.name,
                section: 'Instances',
                Icon: Box,
                title: String(instance.name || ''),
                subtitle: String(instance.state || 'Unknown'),
                badge: String(instance.state || ''),
              }))}

              {!q && (
                <>
                  <p className="global-search-section-label">CATEGORIES</p>
                  <div className="global-search-categories-grid">
                    {accessiblePages.map((item) => (
                      <button
                        key={item.to}
                        type="button"
                        className="global-search-category-chip"
                        onClick={() => openRoute(item.to)}
                      >
                        <item.Icon size={14} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {q && queryResultsBySection.map((sectionGroup) => (
                <div key={sectionGroup.section}>
                  <p className="global-search-section-label">{sectionGroup.section.toUpperCase()}</p>
                  {sectionGroup.items.map((entry) => renderResultRow(entry))}
                </div>
              ))}

              {q && queryResults.length === 0 && !indexing && (
                <p className="global-search-empty">No results for "{q}"</p>
              )}

              {q && indexing && (
                <p className="global-search-empty">Indexing data…</p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
