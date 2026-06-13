import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from '../toast'
import ContainerDataTable from '../components/ContainerDataTable'
import ConfirmModal from '../components/ConfirmModal'
import ResourceActionButton from '../components/ResourceActionButton'
import { api } from '../api/client'
import { SkeletonTable } from '../components/Skeletons'
import BrandIcon from '../components/BrandIcon'
import CustomSelect from '../components/CustomSelect'
import TableToolbar from '../components/TableToolbar'
import { useColumnVisibility } from '../hooks/useColumnVisibility'

function fmtSize(bytes) {
  if (bytes == null) return '—'
  if (bytes === 0) return '0 B'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / (1024 ** 2)
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  const kb = bytes / 1024
  if (kb >= 1) return `${kb.toFixed(0)} KB`
  return `${bytes} B`
}

function volumeName(item) {
  const name = item.name || '-'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 6, background: 'var(--card-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--border)', flexShrink: 0
      }}>
        <BrandIcon name={name} type="volume" size={16} />
      </div>
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{name}</span>
    </div>
  )
}

function usageState(item) {
  const containers = item.containers || []
  return containers.length > 0 || Number(item.ref_count) > 0 ? 'used' : 'unused'
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

export default function Volumes() {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [usageFilter, setUsageFilter] = useState('all')
  const [deleteName, setDeleteName] = useState(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['volumes'],
    queryFn: () => api.getVolumes(),
    refetchInterval: 15000,
    retry: false,
  })
  const volumes = data?.volumes || []

  const filtered = volumes.filter(v => {
    const usage = usageState(v)
    if (usageFilter !== 'all' && usage !== usageFilter) return false
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return [v.name, v.driver, v.mountpoint, usage].join(' ').toLowerCase().includes(q)
  })
  const columns = useMemo(() => [
    { key: 'name', label: 'Name', accent: false, render: volumeName },
    { key: 'usage', label: 'Usage', render: (item) => <UsageBadge value={usageState(item)} /> },
    { key: 'driver', label: 'Driver', render: (item) => <span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'var(--accent-border)' }}>{item.driver}</span> },
    { key: 'size', label: 'Size', render: (item) => <span className="mono" style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{fmtSize(item.size)}</span> },
    { key: 'mountpoint', label: 'Mount Point', render: (item) => <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{item.mountpoint || '—'}</span> },
  ], [])
  const { columnConfig, setColumnConfig, visibleColumns } = useColumnVisibility(columns, 'volumes_cols')

  async function handleDelete(name) {
    try {
      await api.deleteVolume(name)
      qc.invalidateQueries({ queryKey: ['volumes'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success({ title: `Deleted ${name}` })
    } catch (err) {
      toast.error({ title: err.message })
    }
  }

  return (
    <div className="page">
      <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Volumes</h1>
        </div>
      </div>

      <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search volumes..."
          columnConfig={columnConfig}
          setColumnConfig={setColumnConfig}
          style={{ width: 'clamp(260px, 32vw, 420px)' }}
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
        </TableToolbar>
      </div>

      {error && <p className="mono" style={{ color: 'var(--stopped)', marginBottom: 12 }}>{error.message}</p>}

      {isLoading ? (
        <SkeletonTable cols={[{ w: 180 }, { w: 100 }, { w: 80 }, { w: 100 }, { w: 60 }]} rows={5} />
      ) : (
        <ContainerDataTable
          items={filtered}
          empty={query.trim() ? `No volumes match "${query}"` : 'No volumes available'}
          columns={visibleColumns}
          renderActions={(item) => (
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <ResourceActionButton
                icon={<Trash2 size={14} />}
                label="Delete"
                color="var(--stopped)"
                onClick={() => setDeleteName(item.name)}
              />
            </div>
          )}
        />
      )}

      {deleteName && (
        <ConfirmModal
          title={`Delete ${deleteName}`}
          description="This volume and all its data will be permanently removed."
          confirmLabel="Delete"
          variant="confirm"
          onClose={() => setDeleteName(null)}
          onConfirm={() => handleDelete(deleteName).finally(() => setDeleteName(null))}
        />
      )}
    </div>
  )
}
