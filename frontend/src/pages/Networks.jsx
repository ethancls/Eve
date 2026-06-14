import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Network } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import Tooltip from '../components/Tooltip'
import { SkeletonTable } from '../components/Skeletons'
import ContainerDataTable from '../components/ContainerDataTable'
import TableToolbar from '../components/TableToolbar'
import { useColumnVisibility } from '../hooks/useColumnVisibility'

const DRIVER_TONES = {
  bridge: { color: '#ff8ccf', bg: 'rgba(255, 140, 207, 0.13)', border: 'rgba(255, 140, 207, 0.34)' },
  host: { color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.14)', border: 'rgba(167, 139, 250, 0.34)' },
  null: { color: 'var(--text-muted)', bg: 'var(--card-2)', border: 'var(--border)' },
  none: { color: 'var(--text-muted)', bg: 'var(--card-2)', border: 'var(--border)' },
  unused: { color: '#7f9bb8', bg: 'rgba(127, 155, 184, 0.12)', border: 'rgba(127, 155, 184, 0.26)' },
}

const FALLBACK_COLORS = ['#6fa8ff', '#22c55e', '#f59e0b', '#06b6d4', '#f97316', '#ec4899']

function driverOf(item) {
  return String(item.driver || item.network_type || item.mode || item.type || 'unknown').toLowerCase()
}

function toneForDriver(driver) {
  const key = String(driver || 'unknown').toLowerCase()
  if (DRIVER_TONES[key]) return DRIVER_TONES[key]
  let hash = 0
  for (const char of key) hash = (hash + char.charCodeAt(0)) % FALLBACK_COLORS.length
  const color = FALLBACK_COLORS[hash]
  return { color, bg: `color-mix(in srgb, ${color} 14%, transparent)`, border: `color-mix(in srgb, ${color} 34%, transparent)` }
}

function TypeBadge({ driver }) {
  const tone = toneForDriver(driver)
  return (
    <span className="badge" style={{ background: tone.bg, color: tone.color, borderColor: tone.border, textTransform: 'uppercase' }}>
      {driver || '-'}
    </span>
  )
}

function UsageBadge({ value }) {
  const used = value === 'used'
  const tone = used ? { bg: 'var(--accent-dim)', color: 'var(--accent)', border: 'var(--accent-border)' } : DRIVER_TONES.unused
  return (
    <span className="badge" style={{
      background: tone.bg,
      color: tone.color,
      borderColor: tone.border,
      textTransform: 'uppercase',
    }}>
      {used ? 'Used' : 'Unused'}
    </span>
  )
}

function usageState(item) {
  const names = item.containers || item.instances || []
  return names.length > 0 ? 'used' : 'unused'
}

function ipToInt(ip) {
  const parts = String(ip || '').split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function intToIp(value) {
  const n = Number(value) >>> 0
  return [
    Math.floor(n / 16777216) % 256,
    Math.floor(n / 65536) % 256,
    Math.floor(n / 256) % 256,
    n % 256,
  ].join('.')
}

function usableRange(cidr) {
  const [ip, prefixRaw] = String(cidr || '').split('/')
  const prefix = Number(prefixRaw)
  const base = ipToInt(ip)
  if (base == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32 || prefix >= 31) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (base & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const first = network + 1
  const last = broadcast - 1
  if (first > last) return null
  return `${intToIp(first)} -> ${intToIp(last)}`
}

function ipv4Only(value) {
  return String(value || '').split('/')[0] || ''
}

function SubnetPopover({ item }) {
  const subnet = item.ipv4_subnet || item.address || ''
  if (!subnet) return <span style={{ color: 'var(--text-muted)' }}>-</span>
  const gateway = ipv4Only(item.ipv4_gateway)
  const range = usableRange(item.ipv4_ip_range || subnet)
  const label = (
    <span style={{ display: 'grid', gap: 6, minWidth: 210, whiteSpace: 'normal', lineHeight: 1.25 }}>
      <span><span style={{ color: 'var(--text-muted)' }}>Subnet</span> <span style={{ color: 'var(--text-primary)' }}>{subnet}</span></span>
      <span><span style={{ color: 'var(--text-muted)' }}>Gateway</span> <span style={{ color: 'var(--text-primary)' }}>{gateway || '-'}</span>{gateway ? <span style={{ color: 'var(--text-muted)' }}> reserved</span> : null}</span>
      <span><span style={{ color: 'var(--text-muted)' }}>Assignable</span> <span style={{ color: 'var(--text-primary)' }}>{range || '-'}</span></span>
    </span>
  )
  return (
    <Tooltip label={label}>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-primary)', cursor: 'help' }}>{subnet}</span>
    </Tooltip>
  )
}

function ContainerPills({ item, max = 3 }) {
  const [expanded, setExpanded] = useState(false)
  const names = item.containers || item.instances || []
  const details = item.containers_detail || []
  const detailByName = new Map(details.map((detail) => [detail.name, detail]))
  if (!names.length) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>
  const visible = expanded ? names : names.slice(0, max)
  const hidden = names.length - max
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {visible.map((name) => {
        const detail = detailByName.get(name)
        const ip = ipv4Only(detail?.ipv4_address)
        const label = (
          <span style={{ display: 'grid', gap: 5, minWidth: 150, whiteSpace: 'normal', lineHeight: 1.25 }}>
            <span style={{ color: 'var(--text-primary)' }}>{name}</span>
            <span><span style={{ color: 'var(--text-muted)' }}>IPv4</span> <span style={{ color: 'var(--text-primary)' }}>{ip || '-'}</span></span>
          </span>
        )
        return (
          <Tooltip key={name} label={label}>
            <Link
              to={`/containers/${encodeURIComponent(name)}`}
              className="mono"
              style={{
                fontSize: 11, fontWeight: 700,
                background: 'var(--accent-dim)', color: 'var(--accent)',
                border: '1px solid var(--accent-border)', borderRadius: 6,
                padding: '2px 7px', textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              {name}
            </Link>
          </Tooltip>
        )
      })}
      {!expanded && hidden > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
          className="mono"
          style={{
            fontSize: 11, fontWeight: 700, cursor: 'pointer',
            background: 'var(--card-3)', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '2px 7px', whiteSpace: 'nowrap',
          }}
        >
          +{hidden}
        </button>
      )}
      {expanded && names.length > max && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
          className="mono"
          style={{
            fontSize: 11, cursor: 'pointer',
            background: 'none', color: 'var(--text-muted)',
            border: 'none', padding: '2px 4px',
          }}
        >
          less
        </button>
      )}
    </div>
  )
}

function networkName(item) {
  const name = item.name || '-'
  const driver = driverOf(item)
  const tone = toneForDriver(driver)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Network size={18} color={tone.color} style={{ flexShrink: 0 }} />
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{name}</span>
    </div>
  )
}

export default function Networks() {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [usageFilter, setUsageFilter] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['networks'],
    queryFn: () => api.getNetworks(),
    refetchInterval: 30000,
  })

  const networks = useMemo(() => data?.networks || [], [data?.networks])

  const typeOptions = useMemo(() => {
    const counts = new Map()
    for (const network of networks) {
      const driver = driverOf(network)
      counts.set(driver, (counts.get(driver) || 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [networks])

  const unusedCount = useMemo(() => networks.filter((network) => usageState(network) === 'unused').length, [networks])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return networks.filter((n) => {
      const driver = driverOf(n)
      if (typeFilter !== 'all' && driver !== typeFilter) return false
      const usage = usageState(n)
      if (usageFilter !== 'all' && usage !== usageFilter) return false
      if (!q) return true
      return [n.name, driver, n.status, n.ipv4_subnet, n.ipv4_gateway, usage].join(' ').toLowerCase().includes(q)
    })
  }, [networks, query, typeFilter, usageFilter])

  const columns = useMemo(() => [
    { key: 'name', label: 'Name', accent: false, render: networkName },
    { key: 'usage', label: 'Usage', render: (item) => <UsageBadge value={usageState(item)} /> },
    { key: 'type', label: 'Mode', render: (item) => <TypeBadge driver={driverOf(item)} /> },
    { key: 'address', label: 'IPv4', render: (item) => <SubnetPopover item={item} /> },
    { key: 'containers', label: 'Containers', render: (item) => <ContainerPills item={item} /> },
  ], [])
  const { columnConfig, setColumnConfig, visibleColumns } = useColumnVisibility(columns, 'networks_cols')

  function selectAll() {
    setTypeFilter('all')
    setUsageFilter('all')
  }

  function selectType(driver) {
    setTypeFilter(driver)
    setUsageFilter('all')
  }

  function selectUnused() {
    setTypeFilter('all')
    setUsageFilter('unused')
  }

  return (
    <div className="page">
      <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Networks</h1>
        </div>
      </div>

      <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div className="instances-state-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 360px' }}>
          <button className={`filter-pill ${typeFilter === 'all' && usageFilter === 'all' ? 'active' : ''}`} type="button" onClick={selectAll}>
            All <span className="pill-count">{networks.length}</span>
          </button>
          {typeOptions.map(([driver, count]) => {
            const tone = toneForDriver(driver)
            const active = typeFilter === driver && usageFilter === 'all'
            return (
              <button
                key={driver}
                className={`filter-pill ${active ? 'active' : ''}`}
                type="button"
                onClick={() => selectType(driver)}
                style={active ? { background: tone.bg, color: tone.color, borderColor: tone.border } : { color: tone.color, borderColor: tone.border }}
              >
                {driver} <span className="pill-count">{count}</span>
              </button>
            )
          })}
          <button
            className={`filter-pill ${usageFilter === 'unused' ? 'active' : ''}`}
            type="button"
            onClick={selectUnused}
            style={usageFilter === 'unused'
              ? { background: DRIVER_TONES.unused.bg, color: DRIVER_TONES.unused.color, borderColor: DRIVER_TONES.unused.border }
              : { color: DRIVER_TONES.unused.color, borderColor: DRIVER_TONES.unused.border }}
          >
            unused <span className="pill-count">{unusedCount}</span>
          </button>
        </div>
        <div className="instances-controls-right" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto' }}>
          <TableToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder="Search networks..."
            columnConfig={columnConfig}
            setColumnConfig={setColumnConfig}
            style={{ width: 'clamp(360px, 42vw, 560px)', minWidth: 320 }}
          />
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable cols={[{ w: 140 }, { w: 80 }, { w: 70 }, { w: 140 }, { w: 180 }]} rows={5} />
      ) : (
        <ContainerDataTable
          items={filtered}
          empty={query.trim() ? `No networks match "${query}"` : 'No networks available'}
          columns={visibleColumns}
          tableMinWidth={820}
        />
      )}
    </div>
  )
}
