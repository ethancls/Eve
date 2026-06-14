import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X, ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import { api } from '../api/client'
import { SkeletonTable } from '../components/Skeletons'
import CustomSelect from '../components/CustomSelect'
import Tooltip from '../components/Tooltip'

const STATUS_FILTERS = ['ALL', 'ok', 'error']
const PAGE_SIZE = 50
const TIME_PRESETS = [
  { label: 'All time', hours: 0 },
  { label: 'Last 24h', hours: 24 },
  { label: 'Last 7d', hours: 168 },
  { label: 'Last 30d', hours: 720 },
]

function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtRelative(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now - d
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function statusColor(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'ok') return 'var(--running)'
  if (s === 'error') return 'var(--stopped)'
  return 'var(--text-secondary)'
}

const ACTION_ICONS = {
  'login': '🔑',
  'logout': '🚪',
  'container create': '📦',
  'container start': '▶️',
  'container stop': '⏹️',
  'container restart': '🔄',
  'container delete': '🗑️',
  'container remove': '🗑️',
  'container recreate': '♻️',
  'image pull': '⬇️',
  'image delete': '🗑️',
  'volume remove': '🗑️',
  'shell open': '💻',
  'setting update': '⚙️',
  'prune': '🧹',
}
function actionIcon(action) {
  for (const [key, icon] of Object.entries(ACTION_ICONS)) {
    if (action === key || action?.startsWith(key)) return icon
  }
  return '•'
}

function DetailPanel({ entry, onClose }) {
  const navigate = useNavigate()
  if (!entry) return null
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)',
        }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 501,
        width: 'min(440px, 90vw)', background: 'var(--card-1)',
        borderLeft: '1px solid var(--border)', overflowY: 'auto',
        padding: 24, animation: 'slide-in-right 0.2s ease',
      }}>
        <style>{`@keyframes slide-in-right{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Details</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { label: 'Timestamp', value: fmtDate(entry.timestamp) },
            { label: 'Action', value: `${actionIcon(entry.action)} ${entry.action || '—'}` },
            {
              label: 'User',
              value: entry.user_login || '—',
              link: entry.user_id ? `/users` : null,
            },
            {
              label: 'Target',
              value: entry.vm_name || '—',
            },
            {
              label: 'Status',
              value: entry.status || '—',
              color: statusColor(entry.status),
            },
          ].map(({ label, value, color, link }) => (
            <div key={label}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{label}</p>
              {link ? (
                <button onClick={() => { navigate(link); onClose() }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Mono' }}>
                  {value}
                </button>
              ) : (
                <p className="mono" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</p>
              )}
            </div>
          ))}
          {entry.error && (
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Error</p>
              <pre className="mono" style={{ margin: 0, fontSize: 11.5, color: 'var(--stopped)', whiteSpace: 'pre-wrap', lineHeight: 1.5, background: 'var(--card-2)', padding: 10, borderRadius: 8 }}>{entry.error}</pre>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default function Logs() {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [actionFilter, setActionFilter] = useState('ALL')
  const [timePreset, setTimePreset] = useState(0)
  const [detail, setDetail] = useState(null)

  const since = timePreset > 0
    ? new Date(Date.now() - timePreset * 3600000).toISOString()
    : ''

  const activityQuery = useQuery({
    queryKey: ['activity', 'logs-page', page, statusFilter, actionFilter, timePreset],
    queryFn: () => api.getActivity({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
      ...(actionFilter !== 'ALL' ? { action: actionFilter } : {}),
      ...(since ? { since } : {}),
    }),
    refetchInterval: 15000,
    retry: false,
  })

  const activity = activityQuery.data?.activity ?? []
  const total = activityQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const actionFilters = useMemo(() => {
    const actions = Array.from(new Set(activity.map(e => String(e.action || '').trim()).filter(Boolean)))
    return ['ALL', ...actions]
  }, [activity])
  const actionOptions = actionFilters.map(a => ({ value: a, label: a === 'ALL' ? 'All actions' : a }))

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title">Activity</h1>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {TIME_PRESETS.map(p => (
            <button key={p.hours} onClick={() => { setTimePreset(p.hours); setPage(0) }}
              className={`filter-pill${timePreset === p.hours ? ' active' : ''}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(0) }}
              className={`filter-pill${statusFilter === s ? ' active' : ''}`}>
              {s}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <CustomSelect
            value={actionFilter}
            onChange={(v) => { setActionFilter(v); setPage(0) }}
            options={actionOptions}
            controlHeight={32}
            searchable
            style={{ minWidth: 160, width: 220 }}
          />
        </div>
      </div>

      {/* Table */}
      {activityQuery.isLoading ? (
        <SkeletonTable cols={[{ w: 180 }, { w: 130 }, { w: 100 }, { w: 180 }, { w: 90 }]} rows={8} minWidth={700} />
      ) : activityQuery.isError ? (
        <div className="card">
          <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--stopped)' }}>{activityQuery.error?.message || 'Failed to load activity'}</p>
        </div>
      ) : (
        <>
          <div className="instances-table-shell" style={{ background: 'var(--card-1)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', overflow: 'visible' }}>
            <div className="instances-table-scroll no-scrollbar" style={{ overflowX: 'auto', overflowY: 'visible' }}>
              <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Time', 'User', 'Action', 'Target', 'Status', ''].map(label => (
                      <th key={label} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activity.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '28px 16px', textAlign: 'center' }}>
                        <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>No activity for current filters.</p>
                      </td>
                    </tr>
                  ) : activity.map((entry, idx) => {
                    const isContainer = entry.action?.includes('container') || entry.action === 'shell open'
                    const targetLink = entry.vm_name && isContainer
                    return (
                      <tr key={`${entry.timestamp}-${idx}`}
                        onClick={() => setDetail(entry)}
                        style={{ borderBottom: idx < activity.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--card-2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '10px 16px' }}>
                          <Tooltip label={fmtDate(entry.timestamp)}>
                            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{fmtRelative(entry.timestamp)}</span>
                          </Tooltip>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          {entry.user_login ? (
                            <button onClick={e => { e.stopPropagation(); navigate('/users') }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, fontFamily: 'IBM Plex Mono' }}>
                              {entry.user_login}
                            </button>
                          ) : (
                            <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span className="mono" style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                            {actionIcon(entry.action)} {entry.action || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          {targetLink ? (
                            <button onClick={e => { e.stopPropagation(); navigate(`/containers/${entry.vm_name}`) }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, fontFamily: 'IBM Plex Mono' }}>
                              {entry.vm_name}
                            </button>
                          ) : (
                            <span className="mono" style={{ fontSize: 12, color: entry.vm_name ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{entry.vm_name || '—'}</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span className="mono" style={{ fontSize: 11.5, color: statusColor(entry.status), fontWeight: 700 }}>{entry.status || '—'}</span>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          <Eye size={13} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="btn" style={{ height: 32, padding: '0 12px', fontSize: 12 }}>
              <ChevronLeft size={14} /> Prev
            </button>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              Page {page + 1} of {totalPages} ({total} events)
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="btn" style={{ height: 32, padding: '0 12px', fontSize: 12 }}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}

      {/* Detail panel */}
      <DetailPanel entry={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
