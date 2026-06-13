import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Info, Play, Skull, Square, Trash2 } from 'lucide-react'
import { toast } from '../toast'
import { api } from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import ResourceActionButton from '../components/ResourceActionButton'
import DetailsTabs from '../components/instance-details/DetailsTabs'
import ShellPanel from '../components/instance-details/ShellPanel'
import ResourceUsage from '../components/instances/ResourceUsage'
import InstanceStateBadge from '../components/instances/InstanceStateBadge'

const TABS = [
  { value: 'shell', label: 'Shell' },
  { value: 'logs', label: 'Logs' },
  { value: 'inspect', label: 'Inspect' },
  { value: 'stats', label: 'Stats' },
]

function rawContainer(data) {
  return data?.container || data || {}
}

function valueAt(item, paths, fallback = '—') {
  for (const path of paths) {
    const value = path.split('.').reduce((current, part) => current?.[part], item)
    if (value != null && value !== '') return value
  }
  return fallback
}

function toBytes(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value
  const text = String(value).trim()
  const match = /^([\d.]+)\s*([kmgt]?i?b?|b)?$/i.exec(text)
  if (!match) return Number(value) || 0
  const n = Number(match[1])
  const unit = (match[2] || 'b').toLowerCase()
  const scale = unit.startsWith('t') ? 1024 ** 4 : unit.startsWith('g') ? 1024 ** 3 : unit.startsWith('m') ? 1024 ** 2 : unit.startsWith('k') ? 1024 : 1
  return n * scale
}

function formatDate(value) {
  if (!value || value === '—') return value || '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function extractStats(data) {
  const stats = data?.stats || data?.raw || data || {}
  const item = Array.isArray(stats) ? stats[0] || {} : stats
  const memoryUsed = toBytes(valueAt(item, ['memory.used', 'memory_usage', 'mem_used', 'MemUsage.used'], 0))
  const memoryTotal = toBytes(valueAt(item, ['memory.total', 'memory_limit', 'mem_limit', 'MemUsage.total'], 0))
  return {
    item,
    cpu: valueAt(item, ['cpu', 'cpu_percent', 'cpuPercentage', 'CPUPerc'], 'Unavailable'),
    memoryUsed,
    memoryTotal,
  }
}

function Stat({ label, value, accent = false, children = null }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', height: 62, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <p className="section-label" style={{ margin: 0, lineHeight: 1 }}>{label}</p>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
        {children ?? (
          <span className="mono" style={{ fontSize: 13, color: accent ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value}
          </span>
        )}
      </div>
    </div>
  )
}

const LOG_COLORS = {
  error: '#ef4444',
  err: '#ef4444',
  fatal: '#ef4444',
  warn: '#f59e0b',
  warning: '#f59e0b',
  info: '#6fa8ff',
  debug: '#888',
  trace: '#666',
}
const LOG_BG = {
  error: 'rgba(239,68,68,0.06)',
  err: 'rgba(239,68,68,0.06)',
  fatal: 'rgba(239,68,68,0.08)',
  warn: 'rgba(245,158,11,0.05)',
  warning: 'rgba(245,158,11,0.05)',
}

function parseLogLine(line) {
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^ ]*)\s+(.*)$/)
  let timestamp = ''
  let rest = line
  if (tsMatch) {
    timestamp = tsMatch[1]
    rest = tsMatch[2]
  }
  let level = ''
  let message = rest
  try {
    const parsed = JSON.parse(rest)
    if (parsed.level) {
      level = String(parsed.level).toLowerCase()
      message = parsed.message || parsed.msg || rest
    }
    if (parsed.time && !timestamp) timestamp = parsed.time
    if (!level && parsed.error) level = 'error'
  } catch {
    const lvlMatch = rest.match(/"?level"?\s*[=:]\s*"?(\w+)"?/i)
    if (lvlMatch) level = lvlMatch[1].toLowerCase()
    else if (/error|fail|fatal/i.test(rest)) level = 'error'
    else if (/warn/i.test(rest)) level = 'warn'
  }

  if (typeof message === 'object') message = JSON.stringify(message, null, 2)
  return { timestamp, level, message: String(message) }
}

function LogsPanel({ name }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['container-logs', name],
    queryFn: () => api.getContainerLogs(name),
    enabled: Boolean(name),
    retry: false,
  })

  const rawLogs = data?.logs || data?.stderr || ''
  const lines = rawLogs ? rawLogs.split('\n').filter(Boolean) : []
  const parsed = lines.map(parseLogLine)

  const levels = ['all', ...new Set(parsed.map(l => l.level).filter(Boolean))]

  const filtered = parsed.filter(l => {
    if (filter !== 'all' && l.level !== filter) return false
    if (search && !l.message.toLowerCase().includes(search.toLowerCase()) && !l.timestamp.includes(search)) return false
    return true
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {levels.map(lvl => (
            <button
              key={lvl}
              onClick={() => setFilter(lvl)}
              className="filter-pill"
              style={{
                padding: '3px 10px', fontSize: 11,
                background: filter === lvl ? 'var(--accent-dim)' : 'var(--card-2)',
                color: filter === lvl ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1px solid ${filter === lvl ? 'var(--accent-border)' : 'var(--border)'}`,
                borderRadius: 12, cursor: 'pointer', fontWeight: 600,
              }}
            >
              {lvl === 'all' ? 'All' : lvl.toUpperCase()}
              <span style={{ marginLeft: 4, opacity: 0.5, fontSize: 10 }}>
                {lvl === 'all' ? parsed.length : parsed.filter(l => l.level === lvl).length}
              </span>
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="input mono"
          style={{ height: 32, width: 180, fontSize: 11 }}
        />
      </div>

      <div style={{ minHeight: 420, maxHeight: '70vh', overflow: 'auto', background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 12, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11.5, lineHeight: 1.65 }}>
        {isLoading ? (
          <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading logs...</div>
        ) : error ? (
          <div style={{ padding: 20, color: 'var(--stopped)' }}>{error.message}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
            {lines.length === 0 ? 'No logs' : 'No matching lines'}
          </div>
        ) : (
          filtered.map((l, i) => (
            <div
              key={i}
              style={{
                display: 'flex', padding: '1px 12px',
                background: LOG_BG[l.level] || 'transparent',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {l.timestamp && (
                <span style={{ color: '#666', flexShrink: 0, marginRight: 10, userSelect: 'none' }}>
                  {l.timestamp.replace('T', ' ').replace(/\.\d+Z?$/, '').slice(0, 23)}
                </span>
              )}
              {l.level && (
                <span style={{
                  color: LOG_COLORS[l.level] || 'var(--text-secondary)',
                  flexShrink: 0, marginRight: 8, fontWeight: 600,
                  minWidth: 40, fontSize: 10, textTransform: 'uppercase',
                }}>
                  {l.level}
                </span>
              )}
              <span style={{ color: LOG_COLORS[l.level] || 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {l.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function JsonPanel({ data, isLoading, error, loadingLabel }) {
  return (
    <pre className="mono" style={{ minHeight: 460, maxHeight: '70vh', overflow: 'auto', margin: 0, padding: 14, background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
      {isLoading ? loadingLabel : error ? error.message : JSON.stringify(data || {}, null, 2)}
    </pre>
  )
}

export default function ContainerDetails() {
  const { name: rawName } = useParams()
  const name = decodeURIComponent(rawName || '')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('shell')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activeAction, setActiveAction] = useState('')

  const containerQuery = useQuery({
    queryKey: ['container', name],
    queryFn: () => api.getContainer(name),
    enabled: Boolean(name),
    refetchInterval: 10000,
    retry: false,
  })

  const statsQuery = useQuery({
    queryKey: ['container-stats', name],
    queryFn: () => api.getContainerStats(name),
    enabled: Boolean(name),
    refetchInterval: 7000,
    retry: false,
  })

  async function runAction(action, title, after) {
    setActiveAction(action)
    try {
      await api.containerAction(name, action)
      qc.invalidateQueries({ queryKey: ['containers'] })
      qc.invalidateQueries({ queryKey: ['container', name] })
      qc.invalidateQueries({ queryKey: ['container-stats', name] })
      qc.invalidateQueries({ queryKey: ['instances'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success({ title })
      if (after) after()
    } catch (err) {
      toast.error({ title: err.message })
    } finally {
      setActiveAction('')
    }
  }

  const container = rawContainer(containerQuery.data)
  const stats = useMemo(() => extractStats(statsQuery.data), [statsQuery.data])
  const state = valueAt(container, ['state', 'raw.State.Status'], 'unknown')
  const isRunning = String(state).toLowerCase() === 'running'
  const busy = Boolean(activeAction)

  if (containerQuery.isLoading) {
    return <div className="page"><div className="skeleton" style={{ width: 260, height: 34, borderRadius: 8 }} /></div>
  }

  if (containerQuery.error) {
    return <div className="page"><p className="mono" style={{ color: 'var(--stopped)', fontSize: 12 }}>{containerQuery.error.message}</p></div>
  }

  return (
    <div className="page">
      <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, minWidth: 0 }}>
          <h1 className="page-title" style={{ fontSize: 30, lineHeight: 1, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</h1>
          <InstanceStateBadge state={state} />
        </div>
        <div className="instance-details-header-actions" style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          {!isRunning && <ResourceActionButton icon={<Play size={14} />} label="Start" color="var(--running)" disabled={busy && activeAction !== 'start'} isLoading={activeAction === 'start'} onClick={() => runAction('start', `Started ${name}`)} />}
          {isRunning && <ResourceActionButton icon={<Square size={14} />} label="Stop" color="var(--stopped)" disabled={busy && activeAction !== 'stop'} isLoading={activeAction === 'stop'} onClick={() => runAction('stop', `Stopped ${name}`)} />}
          {isRunning && <ResourceActionButton icon={<Skull size={14} />} label="Kill" color="var(--stopped)" disabled={busy && activeAction !== 'kill'} isLoading={activeAction === 'kill'} onClick={() => runAction('kill', `Killed ${name}`)} />}
          <ResourceActionButton icon={<FileText size={14} />} label="Logs" color="#60a5fa" disabled={busy} onClick={() => setTab('logs')} />
          <ResourceActionButton icon={<Info size={14} />} label="Inspect" color="#a78bfa" disabled={busy} onClick={() => setTab('inspect')} />
          <ResourceActionButton icon={<Trash2 size={14} />} label="Delete" color="var(--stopped)" disabled={busy && activeAction !== 'delete'} isLoading={activeAction === 'delete'} onClick={() => setConfirmDelete(true)} />
        </div>
      </div>

      <div className="instance-details-stats" style={{ marginBottom: 14 }}>
        <Stat label="CPU" accent>
          {statsQuery.error || !isRunning
            ? <span className="mono" style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 700 }}>—</span>
            : <ResourceUsage used={parseFloat(stats.cpu) || 0} total={100} mode="percent" donutSize={22} donutStroke={3} />
          }
        </Stat>
        <Stat label="RAM">
          {statsQuery.error || !isRunning
            ? <span className="mono" style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 700 }}>—</span>
            : <ResourceUsage used={stats.memoryUsed} total={stats.memoryTotal} donutSize={22} donutStroke={3} />
          }
        </Stat>
        <Stat label="Image" value={valueAt(container, ['image', 'raw.Config.Image', 'raw.image'])} />
        <Stat label="Command" value={valueAt(container, ['command', 'raw.Config.Cmd', 'raw.command'])} />
        <Stat label="Created" value={formatDate(valueAt(container, ['created', 'raw.Created']))} />
      </div>

      <DetailsTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'shell' && <ShellPanel name={name} isRunning={isRunning} wsBase="/ws/containers" resourceLabel="Container" storageKeyPrefix="eve-container-shell-session" />}
      {tab === 'logs' && <LogsPanel name={name} />}
      {tab === 'inspect' && <JsonPanel data={container} isLoading={containerQuery.isLoading} error={containerQuery.error} loadingLabel="Loading container..." />}
      {tab === 'stats' && <JsonPanel data={statsQuery.data} isLoading={statsQuery.isLoading} error={statsQuery.error} loadingLabel="Loading stats..." />}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${name}`}
          description="This container will be removed."
          confirmLabel="Delete"
          confirmValue={name}
          variant="name"
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => runAction('delete', `Deleted ${name}`, () => navigate('/containers'))}
        />
      )}
    </div>
  )
}
