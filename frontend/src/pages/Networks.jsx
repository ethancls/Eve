import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Network } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import CustomSelect from '../components/CustomSelect'
import { SkeletonTable } from '../components/Skeletons'
import BrandIcon from '../components/BrandIcon'
import ContainerDataTable from '../components/ContainerDataTable'
import TableToolbar from '../components/TableToolbar'
import { useColumnVisibility } from '../hooks/useColumnVisibility'

function StatusBadge({ status }) {
  const cfg = {
    up:      { bg: 'transparent',            color: 'var(--running)',    border: 'var(--accent-border)', dot: 'var(--running)' },
    configured: { bg: 'transparent',         color: 'var(--accent)',      border: 'var(--accent-border)', dot: 'var(--accent)' },
    down:    { bg: 'var(--card-2)',          color: 'var(--text-muted)', border: 'var(--border)',         dot: 'var(--text-muted)' },
    unknown: { bg: 'var(--card-2)',          color: 'var(--text-muted)', border: 'var(--border)',         dot: 'var(--text-muted)' },
  }[status] || { bg: 'var(--card-2)', color: 'var(--text-muted)', border: 'var(--border)', dot: 'var(--text-muted)' }

  return (
    <span className="badge" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
      <span className="badge-dot" style={{ background: cfg.dot }} />
      {status === 'down' ? 'inactive' : status}
    </span>
  )
}

function ContainerPills({ names, max = 3 }) {
  const [expanded, setExpanded] = useState(false)
  if (!names || !names.length) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
  const visible = expanded ? names : names.slice(0, max)
  const hidden = names.length - max
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {visible.map((name) => (
        <Link
          key={name}
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
      ))}
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

function usageState(item) {
  const names = item.containers || item.instances || []
  return names.length > 0 ? 'used' : 'unused'
}

function UsageBadge({ value }) {
  const used = value === 'used'
  return (
    <span className="badge" style={{
      background: used ? 'var(--accent-dim)' : 'var(--card-2)',
      color: used ? 'var(--accent)' : 'var(--text-muted)',
      borderColor: used ? 'var(--accent-border)' : 'var(--border)',
      textTransform: 'uppercase',
    }}>
      {used ? 'Used' : 'Unused'}
    </span>
  )
}

function networkName(item) {
  const name = item.name || '-'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ 
        width: 28, height: 28, borderRadius: 6, background: 'var(--card-2)', 
        display: 'flex', alignItems: 'center', justifyContent: 'center', 
        border: '1px solid var(--border)', flexShrink: 0 
      }}>
        <BrandIcon name={name} type="network" size={16} />
      </div>
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{name}</span>
    </div>
  )
}

export default function Networks() {
  const [query, setQuery]           = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [usageFilter, setUsageFilter] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['networks'],
    queryFn: () => api.getNetworks(),
    refetchInterval: 30000,
  })

  const networks = useMemo(() => data?.networks || [], [data?.networks])

  const typeOptions = useMemo(() => {
    const types = [...new Set(networks.map((n) => n.type).filter(Boolean))].sort()
    return [{ value: 'all', label: 'All types' }, ...types.map((t) => ({ value: t, label: t }))]
  }, [networks])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return networks.filter((n) => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false
      const usage = usageState(n)
      if (usageFilter !== 'all' && usage !== usageFilter) return false
      if (!q) return true
      return [n.name, n.type, n.status, n.address, usage].join(' ').toLowerCase().includes(q)
    })
  }, [networks, query, typeFilter, usageFilter])
  const columns = useMemo(() => [
    { key: 'name', label: 'Name', accent: false, render: networkName },
    { key: 'usage', label: 'Usage', render: (item) => <UsageBadge value={usageState(item)} /> },
    { key: 'type', label: 'Mode', render: (item) => <span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'var(--accent-border)', textTransform: 'uppercase' }}>{item.mode || item.type || '—'}</span> },
    { key: 'address', label: 'IPv4', render: (item) => [item.ipv4_subnet, item.ipv4_gateway].filter(Boolean).join(' · ') || item.address || '—' },
    { key: 'containers', label: 'Containers', render: (item) => <ContainerPills names={item.containers || item.instances} /> },
  ], [])
  const { columnConfig, setColumnConfig, visibleColumns } = useColumnVisibility(columns, 'networks_cols')

  return (
    <div className="page">
      <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Networks</h1>
        </div>
      </div>

      <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div className="instances-state-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 280px' }}>
          <button className="filter-pill active" type="button">All <span className="pill-count">{networks.length}</span></button>
        </div>
        <div className="instances-controls-right" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto' }}>
          <TableToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder="Search networks..."
            columnConfig={columnConfig}
            setColumnConfig={setColumnConfig}
            style={{ width: 'clamp(280px, 34vw, 460px)' }}
          >
            <CustomSelect
              value={usageFilter}
              onChange={setUsageFilter}
              options={[
                { value: 'all', label: 'All usage' },
                { value: 'used', label: 'Used' },
                { value: 'unused', label: 'Unused' },
              ]}
              controlHeight={30}
              style={{ width: 130 }}
            />
            <CustomSelect
              value={typeFilter}
              onChange={setTypeFilter}
              options={typeOptions}
              controlHeight={30}
              style={{ width: 160 }}
            />
          </TableToolbar>
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable cols={[{ w: 140 }, { w: 80 }, { w: 70 }, { w: 140 }, { w: 180 }]} rows={5} />
      ) : (
        <ContainerDataTable
          items={filtered}
          empty={query.trim() ? `No networks match "${query}"` : 'No networks available'}
          columns={visibleColumns}
        />
      )}
    </div>
  )
}
