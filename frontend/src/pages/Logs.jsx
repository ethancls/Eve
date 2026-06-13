import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { SkeletonTable } from '../components/Skeletons'
import CustomSelect from '../components/CustomSelect'
import TableToolbar from '../components/TableToolbar'
import { useColumnVisibility } from '../hooks/useColumnVisibility'

const STATUS_FILTERS = ['ALL', 'success', 'error']

function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function activityStatusColor(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'success') return 'var(--running)'
  if (normalized === 'error') return 'var(--stopped)'
  return 'var(--text-secondary)'
}

export default function Logs() {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [actionFilter, setActionFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const columns = useMemo(() => [
    { key: 'time', label: 'Time' },
    { key: 'action', label: 'Action' },
    { key: 'instance', label: 'Instance' },
    { key: 'status', label: 'Status' },
    { key: 'error', label: 'Error' },
  ], [])
  const { columnConfig, setColumnConfig, visibleColumns } = useColumnVisibility(columns, 'activity_cols')

  const activityQuery = useQuery({
    queryKey: ['activity', 'logs-page'],
    queryFn: () => api.getActivity(1000),
    refetchInterval: 15000,
    retry: false,
  })

  const activityRows = activityQuery.data?.activity
  const activity = useMemo(() => activityRows ?? [], [activityRows])

  const actionFilters = useMemo(() => {
    const actions = Array.from(
      new Set(
        activity
          .map((entry) => String(entry.action || '').trim())
          .filter(Boolean),
      ),
    )
    return ['ALL', ...actions]
  }, [activity])
  const actionOptions = useMemo(
    () => actionFilters.map((action) => ({
      value: action,
      label: action === 'ALL' ? 'All actions' : action,
    })),
    [actionFilters],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return activity.filter((entry) => {
      const status = String(entry.status || '').toLowerCase()
      if (statusFilter !== 'ALL' && status !== statusFilter) return false
      const action = String(entry.action || '').trim()
      if (actionFilter !== 'ALL' && action !== actionFilter) return false
      if (!q) return true
      const hay = [
        entry.action,
        entry.vm_name,
        entry.status,
        entry.error,
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [activity, statusFilter, actionFilter, search])

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Activity</h1>
        </div>
      </div>

      <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div className="instances-state-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 300px' }}>
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`filter-pill${statusFilter === status ? ' active' : ''}`}
            >
              {status}
            </button>
          ))}
        </div>
        <div className="instances-controls-right" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto' }}>
          <TableToolbar
            query={search}
            onQueryChange={setSearch}
            placeholder="Search activity..."
            columnConfig={columnConfig}
            setColumnConfig={setColumnConfig}
            style={{ width: 'clamp(320px, 42vw, 560px)' }}
          >
            <CustomSelect
              value={actionFilter}
              onChange={setActionFilter}
              options={actionOptions}
              controlHeight={30}
              searchable
              style={{ minWidth: 140, width: 'clamp(160px, 24vw, 240px)', flex: '0 1 auto' }}
            />
          </TableToolbar>
        </div>
      </div>

      {activityQuery.isLoading ? (
        <SkeletonTable
          cols={[{ w: 160 }, { w: 180 }, { w: 180 }, { w: 120 }, { w: 420 }]}
          rows={8}
          minWidth={1060}
        />
      ) : activityQuery.isError ? (
        <div className="card">
          <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--stopped)' }}>
            {activityQuery.error?.message || 'Failed to load activity'}
          </p>
        </div>
      ) : (
        <div className="instances-table-shell" style={{ background: 'var(--card-1)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', overflow: 'visible' }}>
          <div className="instances-table-scroll no-scrollbar" style={{ overflowX: 'auto', overflowY: 'visible' }}>
            <table style={{ width: '100%', minWidth: 1060, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      style={{
                        padding: '12px 18px',
                        textAlign: 'left',
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: 'var(--text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} style={{ padding: '28px 18px', textAlign: 'center' }}>
                      <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                        No activity for current filters.
                      </p>
                    </td>
                  </tr>
                ) : filtered.map((entry, idx) => (
                  <tr key={entry.timestamp || `${entry.vm_name || ''}-${entry.action || ''}-${idx}`} style={{ borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    {visibleColumns.map((col) => (
                      <td key={col.key} style={{ padding: '13px 18px', maxWidth: col.key === 'error' ? 500 : undefined }}>
                        {col.key === 'time' && (
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{fmtDate(entry.timestamp)}</span>
                        )}
                        {col.key === 'action' && (
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-primary)', fontWeight: 700 }}>
                            {entry.action || '—'}
                          </span>
                        )}
                        {col.key === 'instance' && (
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                            {entry.vm_name || '—'}
                          </span>
                        )}
                        {col.key === 'status' && (
                          <span className="mono" style={{ fontSize: 11.5, color: activityStatusColor(entry.status), fontWeight: 700 }}>
                            {entry.status || '—'}
                          </span>
                        )}
                        {col.key === 'error' && (
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                            {entry.error || '—'}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
