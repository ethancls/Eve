import React, { useMemo, useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Play, Square, XCircle, Trash2, FileText, X, ArrowUpRight, Info, ArrowRight, RotateCw, RefreshCw, MoreVertical, Columns, Eye, EyeOff, ChevronUp, ChevronDown, HelpCircle, Unlink } from 'lucide-react'
import { toast } from '../toast'
import { api } from '../api/client'
import ContainerDataTable from '../components/ContainerDataTable'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import BrandIcon from '../components/BrandIcon'
import ResourceActionButton from '../components/ResourceActionButton'
import CustomSelect from '../components/CustomSelect'
import Tooltip from '../components/Tooltip'
import ImageUpdateCell from '../components/ImageUpdateCell'
import { SkeletonTable } from '../components/Skeletons'

const EMPTY_CONTAINERS = []
const CONTAINER_PROJECT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']

function displayNameText(item) {
  return item.name || item.id || item.raw?.name || item.raw?.id || '-'
}

function displayImage(item) {
  return item.image || item.raw?.image || item.raw?.configuration?.image?.reference || '-'
}

function displayState(item) {
  return item.state || item.status || item.raw?.status || '-'
}

function normalizedContainerState(item) {
  return String(displayState(item)).toLowerCase()
}

function isContainerRunning(item) {
  return normalizedContainerState(item) === 'running'
}

function isContainerStopped(item) {
  const state = normalizedContainerState(item)
  return state === 'exited' || state === 'stopped' || state === 'created'
}

function getProject(item) {
  const labels = item.raw?.Labels || {}
  return labels['com.docker.compose.project'] || displayNameText(item).split(/[-_]/)[0] || displayNameText(item)
}

function ProjectColorDot({ color }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 9,
        height: 9,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 0 3px ${color}22`,
        display: 'inline-block',
      }}
    />
  )
}

function InlineMetricSkeleton({ width = 48 }) {
  return (
    <div
      className="skeleton"
      style={{
        width,
        height: 12,
        borderRadius: 5,
      }}
    />
  )
}

function BatchIconButton({ label, icon, onClick, color, disabled = false }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          border: 'none',
          background: 'transparent',
          color: disabled ? 'var(--text-muted)' : color,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 0.12s, color 0.12s',
          flexShrink: 0,
          opacity: disabled ? 0.42 : 1,
        }}
        onMouseEnter={(e) => {
          if (disabled) return
          e.currentTarget.style.background = `color-mix(in srgb, ${color} 14%, transparent)`
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

function ContainerBatchActions({
  selectedCount,
  actionsEnabled,
  onStart,
  onStop,
  onKill,
  onRestart,
  onRecreate,
  onDelete,
  onClear,
}) {
  if (!selectedCount) return null
  return (
    <div
      className="instances-batch-actions"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        marginBottom: 10,
        padding: '0 2px',
      }}
    >
      <div
        className="instances-batch-toolbar"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <BatchIconButton label="Start selected" icon={<Play size={16} />} onClick={onStart} color="var(--running)" disabled={!actionsEnabled.start} />
        <BatchIconButton label="Stop selected" icon={<Square size={16} />} onClick={onStop} color="var(--stopped)" disabled={!actionsEnabled.stop} />
        <BatchIconButton label="Kill selected" icon={<XCircle size={16} />} onClick={onKill} color="var(--stopped)" disabled={!actionsEnabled.kill} />
        <BatchIconButton label="Restart selected" icon={<RotateCw size={16} />} onClick={onRestart} color="#facc15" disabled={!actionsEnabled.restart} />
        <BatchIconButton label="Recreate selected" icon={<RefreshCw size={16} />} onClick={onRecreate} color="#60a5fa" disabled={!actionsEnabled.recreate} />
        <BatchIconButton label="Delete selected" icon={<Trash2 size={16} />} onClick={onDelete} color="var(--stopped)" disabled={!actionsEnabled.delete} />
        <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
        <BatchIconButton label="Clear selection" icon={<X size={16} />} onClick={onClear} color="var(--text-secondary)" />
      </div>
    </div>
  )
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  const day = date.getDate()
  const month = date.toLocaleString('default', { month: 'short' })
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${month} ${hours}:${minutes}`
}

function HostIpModal({ onClose, onSave }) {
  const [ip, setIp] = useState('')
  const [saving, setSaving] = useState(false)
  
  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.setSetting('host_ip', ip)
      onSave(ip)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Set Host IP" onClose={onClose} size="sm">
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
          To open forwarded ports, please set the external IP address of this machine. This will be saved in your settings.
        </p>
        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Host IP Address</label>
          <input 
            value={ip} 
            onChange={(e) => setIp(e.target.value)} 
            placeholder="e.g. 192.168.1.100" 
            className="input" 
            autoFocus
            required
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-accent" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ColumnsModal({ config, setConfig, onClose }) {
  const [dragIdx, setDragIdx] = useState(null)
  const [dropIdx, setDropIdx] = useState(null)
  const visibleCount = config.filter((c) => c.visible).length

  const toggle = (idx) => {
    if (config[idx].visible && visibleCount <= 1) return
    const newCfg = [...config]
    newCfg[idx].visible = !newCfg[idx].visible
    setConfig(newCfg)
  }

  const handleDragStart = (e, idx) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }

  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropIdx(idx)
  }

  const handleDragLeave = () => setDropIdx(null)

  const handleDrop = (e, idx) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) { setDropIdx(null); setDragIdx(null); return }
    const newCfg = [...config]
    const [item] = newCfg.splice(dragIdx, 1)
    newCfg.splice(idx, 0, item)
    setConfig(newCfg)
    setDragIdx(null)
    setDropIdx(null)
  }

  const handleDragEnd = () => { setDragIdx(null); setDropIdx(null) }

  return (
    <Modal title="Manage Columns" onClose={onClose} size="sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {config.map((c, i) => (
          <div
            key={c.id}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px',
              background: dragIdx === i ? 'var(--accent-dim)' : dropIdx === i ? 'rgba(111,168,255,0.08)' : 'var(--card-2)',
              borderRadius: 8, border: `1px solid ${dropIdx === i ? 'var(--accent)' : dragIdx === i ? 'var(--accent-border)' : 'var(--border)'}`,
              cursor: 'grab', opacity: dragIdx === i ? 0.4 : c.visible ? 1 : 0.5,
              transition: 'background 0.12s, border-color 0.12s, opacity 0.12s',
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
                <circle cx="9" cy="5" r="1.5" fill="currentColor" />
                <circle cx="15" cy="5" r="1.5" fill="currentColor" />
                <circle cx="9" cy="12" r="1.5" fill="currentColor" />
                <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                <circle cx="9" cy="19" r="1.5" fill="currentColor" />
                <circle cx="15" cy="19" r="1.5" fill="currentColor" />
              </svg>
              <span style={{ fontSize: 13, color: c.visible ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 500 }}>
                {c.label}
              </span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(i) }}
              disabled={c.visible && visibleCount <= 1}
              style={{
                background: 'none', border: 'none', cursor: c.visible && visibleCount <= 1 ? 'not-allowed' : 'pointer',
                color: c.visible ? 'var(--accent)' : 'var(--text-muted)',
                padding: 6, borderRadius: 4,
                transition: 'background 0.12s',
                opacity: c.visible && visibleCount <= 1 ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--card-3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {c.visible ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function VerticalActionMenu({ coords, actions, onClose }) {
  useEffect(() => {
    const handleClick = () => onClose()
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [onClose])

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: coords.x,
        top: coords.y,
        transform: 'translate(-100%, 0)', // Show to the left of the button
        marginTop: 10,
        background: 'var(--card-1)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 100000,
        minWidth: 140,
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-100%, -10px); }
          to { opacity: 1; transform: translate(-100%, 0); }
        }
      `}</style>
      {actions.map((act) => (
        <button
          key={act.key}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
            act.action()
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            color: act.color || 'var(--text-primary)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--card-2)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {React.cloneElement(act.icon, { size: 14 })}
          {act.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

function ContainersActions({ name, isRunning, runAction, setInspectContainer, setLogsFor, setDeleteName }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuCoords, setMenuCoords] = useState({ x: 0, y: 0 })

  const primaryActions = useMemo(() => [
    { key: 'stop', icon: <Square size={14} />, label: 'Stop', color: 'var(--stopped)', disabled: !isRunning, action: () => runAction(name, 'stop', `Stopped ${name}`) },
    { key: 'logs', icon: <FileText size={14} />, label: 'Logs', color: '#60a5fa', action: () => setLogsFor(name) },
    { key: 'restart', icon: <RotateCw size={14} />, label: 'Restart', color: '#facc15', disabled: !isRunning, action: () => runAction(name, 'restart', `Restarted ${name}`) },
  ], [isRunning, name, runAction, setLogsFor])

  const menuActions = useMemo(() => [
    ...(!isRunning ? [{ key: 'start', icon: <Play size={14} />, label: 'Start', color: 'var(--running)', action: () => runAction(name, 'start', `Started ${name}`) }] : []),
    ...(isRunning ? [{ key: 'kill', icon: <XCircle size={14} />, label: 'Kill', color: 'var(--stopped)', action: () => runAction(name, 'kill', `Killed ${name}`) }] : []),
    { key: 'recreate', icon: <RefreshCw size={14} />, label: 'Recreate', color: '#60a5fa', action: () => runAction(name, 'recreate', `Recreated ${name}`) },
    { key: 'inspect', icon: <Info size={14} />, label: 'Inspect', color: '#a78bfa', action: () => setInspectContainer(name) },
    { key: 'delete', icon: <Trash2 size={14} />, label: 'Delete', color: 'var(--stopped)', action: () => setDeleteName(name) },
  ], [isRunning, name, runAction, setDeleteName, setInspectContainer])

  const handleOpenMenu = (e) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setMenuCoords({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
    setMenuOpen(true)
  }

  return (
    <div style={{ width: '100%', maxWidth: '100%', display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
      {primaryActions.map(act => (
        <ResourceActionButton
          key={act.key}
          icon={act.icon}
          label={act.label}
          color={act.color}
          onClick={act.action}
          disabled={act.disabled}
        />
      ))}
      <ResourceActionButton
        icon={<MoreVertical size={15} />}
        label="More actions"
        color="var(--accent)"
        onClick={handleOpenMenu}
      />
      {menuOpen && (
        <VerticalActionMenu
          coords={menuCoords}
          actions={menuActions}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}

function NoPortPopover({ port, onClose }) {
  useEffect(() => {
    const handleClick = () => onClose()
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [onClose])

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'var(--card-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        zIndex: 100001,
        maxWidth: 420,
        width: '90vw',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <HelpCircle size={20} color="#ff7bdc" />
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Port Forwarding</h3>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        This container exposes port <code style={{ background: 'var(--card-2)', padding: '1px 6px', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }}>{port}</code> but it is not forwarded to the host.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Docker CLI</p>
          <pre className="mono" style={{ margin: 0, padding: '8px 12px', background: 'var(--card-2)', borderRadius: 6, fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
{`docker run -p 8080:${port} <image>`}
          </pre>
        </div>
        <div>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Docker Compose</p>
          <pre className="mono" style={{ margin: 0, padding: '8px 12px', background: 'var(--card-2)', borderRadius: 6, fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
{`ports:
  - "8080:${port}"`}
          </pre>
        </div>
      </div>
    </div>,
    document.body
  )
}

function MiniSparkline({ name, metricKey, color }) {
  const { data } = useQuery({
    queryKey: ['history', name],
    queryFn: () => api.getHistory(name),
    refetchInterval: 10000,
    staleTime: 5000,
  })

  const history = data?.history || []
  if (history.length < 2) {
    return <div style={{ width: 45, height: 12 }} />
  }

  const values = history.map(p => {
    if (metricKey === 'cpu') return p.cpu || 0
    if (metricKey === 'ram') return p.ram_used || 0
    return 0
  })

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min === 0 ? 1 : max - min

  const width = 48
  const height = 14
  const points = values.map((val, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((val - min) / range) * height
    return `${x},${y}`
  }).join(' ')

  const areaPoints = `0,${height} ${points} ${width},${height}`

  return (
    <svg width={width} height={height} style={{ overflow: 'visible', marginTop: 2 }}>
      <defs>
        <linearGradient id={`grad-${name}-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon
        fill={`url(#grad-${name}-${metricKey})`}
        points={areaPoints}
      />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  )
}

export default function Containers() {
  const qc = useQueryClient()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [filterState, setFilterState] = useState('All')
  const [filterProject, setFilterProject] = useState('All')
  const [logsFor, setLogsFor] = useState(null)
  const [inspectContainer, setInspectContainer] = useState(null)
  const [deleteName, setDeleteName] = useState(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [selectedNames, setSelectedNames] = useState(() => new Set())

  const [showNoPortPopover, setShowNoPortPopover] = useState(null)
  const [showHostIpModal, setShowHostIpModal] = useState(false)
  const [pendingPort, setPendingPort] = useState(null)
  const hostIpQuery = useQuery({ queryKey: ['setting', 'host_ip'], queryFn: () => api.getSetting('host_ip') })

  const handlePortClick = (port) => {
    const ip = hostIpQuery.data?.value
    if (!ip) {
      setPendingPort(port)
      setShowHostIpModal(true)
    } else {
      window.open(`http://${ip}:${port}`, '_blank')
    }
  }

  const defaultCols = [
    { id: 'name', label: 'Name', visible: true },
    { id: 'state', label: 'State', visible: true },
    { id: 'image', label: 'Image', visible: true },
    { id: 'update', label: 'Upd', visible: true },
    { id: 'cpus', label: '% CPU', visible: true },
    { id: 'memory', label: 'RAM', visible: true },
    { id: 'network', label: 'Ports', visible: true },
    { id: 'created', label: 'Created', visible: true },
  ]
  const [colConfig, setColConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('containers_cols')
      if (saved) {
        const parsed = JSON.parse(saved)
        // Merge any new columns from defaultCols that aren't in saved config
        const savedIds = new Set(parsed.map(c => c.id))
        let insertIdx = parsed.length
        for (const def of defaultCols) {
          if (!savedIds.has(def.id)) {
            parsed.splice(insertIdx, 0, def)
            insertIdx++
          }
        }
        return parsed
      }
    } catch {
      // Ignore invalid persisted column preferences and fall back to defaults.
    }
    return defaultCols
  })
  useEffect(() => {
    localStorage.setItem('containers_cols', JSON.stringify(colConfig))
  }, [colConfig])
  const [showColumnsModal, setShowColumnsModal] = useState(false)

  const containersQuery = useQuery({
    queryKey: ['containers'],
    queryFn: () => api.getContainers(),
    refetchInterval: 10000,
    retry: false,
  })

  const containers = containersQuery.data?.containers || EMPTY_CONTAINERS

  // Extract project names from compose labels or container name prefix
  const projects = useMemo(() => {
    const set = new Set()
    for (const c of containers) {
      const labels = c.raw?.Labels || {}
      const composeProject = labels['com.docker.compose.project']
      if (composeProject) {
        set.add(composeProject)
      } else {
        // Try to infer project from name pattern: project-service-#
        const name = displayNameText(c)
        const match = name.match(/^(.+?)[-_][^-_]+(?:[-_]\d+)?$/)
        if (match) set.add(match[1])
        else set.add(name)
      }
    }
    return ['All', ...[...set].sort()]
  }, [containers])

  const containerColors = useMemo(() => {
    const map = {}
    let i = 0
    for (const c of containers) {
      const proj = getProject(c)
      if (!map[proj]) {
        map[proj] = CONTAINER_PROJECT_COLORS[i % CONTAINER_PROJECT_COLORS.length]
        i++
      }
    }
    return map
  }, [containers])

  const filtered = useMemo(() => {
    let list = containers
    if (filterState !== 'All') {
      const want = filterState.toLowerCase()
      list = list.filter(item => {
        if (want === 'running') return isContainerRunning(item)
        if (want === 'stopped') return isContainerStopped(item)
        return normalizedContainerState(item) === want
      })
    }
    if (filterProject !== 'All') {
      list = list.filter(item => getProject(item) === filterProject)
    }
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((item) => [displayNameText(item), displayImage(item), displayState(item)].join(' ').toLowerCase().includes(q))
  }, [containers, query, filterState, filterProject])

  const selectedContainers = useMemo(
    () => containers.filter((item) => selectedNames.has(displayNameText(item))),
    [containers, selectedNames],
  )

  async function runAction(name, action, title) {
    const promise = api.containerAction(name, action).then(() => {
      qc.invalidateQueries({ queryKey: ['containers'] })
      qc.invalidateQueries({ queryKey: ['instances'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
    })
    toast.promise(promise, {
      loading: { title: `${title}...` },
      success: { title },
      error: (e) => ({ title: e.message }),
    })
    await promise
  }

  function toggleSelect(name) {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleSelectAll(names, allSelected) {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      for (const name of names) {
        if (allSelected) next.delete(name)
        else next.add(name)
      }
      return next
    })
  }

  function clearSelection() {
    setSelectedNames(new Set())
  }

  function removeSelected(names) {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      for (const name of names) next.delete(name)
      return next
    })
  }

  async function runBatchAction(action, title, targets) {
    if (!targets.length) return
    const names = targets.map(displayNameText)
    const promise = (async () => {
      const results = await Promise.allSettled(names.map((name) => api.containerAction(name, action)))
      const succeeded = []
      let failed = 0

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') succeeded.push(names[index])
        else failed += 1
      })

      qc.invalidateQueries({ queryKey: ['containers'] })
      qc.invalidateQueries({ queryKey: ['instances'] })
      qc.invalidateQueries({ queryKey: ['activity'] })

      if (succeeded.length) removeSelected(succeeded)
      if (failed > 0) {
        throw new Error(`${failed}/${names.length} container action${failed > 1 ? 's' : ''} failed`)
      }
      return succeeded
    })()

    toast.promise(promise, {
      loading: { title: `${title} ${names.length} container${names.length > 1 ? 's' : ''}...` },
      success: { title: `${title} ${names.length} container${names.length > 1 ? 's' : ''}` },
      error: (err) => ({ title: err.message }),
    })
    await promise.catch(() => {})
  }

  const stateCounts = useMemo(() => ({
    All: containers.length,
    Running: containers.filter(isContainerRunning).length,
    Stopped: containers.filter(isContainerStopped).length,
  }), [containers])

  const selectedRunning = useMemo(
    () => selectedContainers.filter(isContainerRunning),
    [selectedContainers],
  )
  const selectedNotRunning = useMemo(
    () => selectedContainers.filter((item) => !isContainerRunning(item)),
    [selectedContainers],
  )
  const batchActionsEnabled = useMemo(() => ({
    start: selectedNotRunning.length > 0,
    stop: selectedRunning.length > 0,
    kill: selectedRunning.length > 0,
    restart: selectedRunning.length > 0,
    recreate: selectedContainers.length > 0,
    delete: selectedContainers.length > 0,
  }), [selectedContainers.length, selectedNotRunning.length, selectedRunning.length])

  const projectOptions = useMemo(() => (
    projects.map((project) => {
      const color = project === 'All' ? '#ffffff' : containerColors[project] || 'var(--text-muted)'
      return {
        value: project,
        label: project === 'All' ? 'All projects' : project,
        icon: <ProjectColorDot color={color} />,
      }
    })
  ), [projects, containerColors])

  const allColumns = [
    {
      key: 'name',
      label: 'Name',
      accent: false,
      width: '17%',
      render: (item) => {
        const name = displayNameText(item)
        const proj = getProject(item)
        const projColor = containerColors[proj] || 'var(--accent)'
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <BrandIcon name={name} type="container" size={16} color={projColor} />
            </span>
            <Link to={`/containers/${encodeURIComponent(name)}`} state={{ from: location.pathname }} className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </Link>
            <Link to={`/containers/${encodeURIComponent(name)}`} state={{ from: location.pathname }} aria-label={`Open ${name}`} style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
              <ArrowUpRight size={13} />
            </Link>
          </div>
        )
      },
    },
    { key: 'state', label: 'State', render: (item) => {
      const state = displayState(item)
      const color = isContainerRunning(item)
        ? 'var(--running)'
        : isContainerStopped(item)
          ? 'var(--text-secondary)'
          : 'var(--text-muted)'
      return (
        <span className="mono" style={{ color, fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
          {state}
        </span>
      )
    }},
    { key: 'image', label: 'Image', width: '20%', maxWidth: 360, render: (item) => {
      const img = displayImage(item)
      let url = '#'
      if (img && !img.includes('/')) url = `https://hub.docker.com/_/${img.split(':')[0]}`
      else if (img) url = `https://hub.docker.com/r/${img.split(':')[0]}`
      return (
        <a href={url} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          {img}
          <ArrowUpRight size={12} style={{ opacity: 0.5 }} />
        </a>
      )
    }},
    { key: 'update', label: 'Upd', width: 58, textAlign: 'center', render: (item) => <ImageUpdateCell image={displayImage(item)} /> },
    { key: 'cpus', label: '% CPU', render: (item) => {
      if (!isContainerRunning(item)) {
        return <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
      }
      let val = item.cpu != null ? item.cpu.toFixed(1) : null
      if (val == null) return <InlineMetricSkeleton width={46} />
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span className="mono" style={{ color: '#ff7bdc', fontWeight: 600, fontSize: 12 }}>
            {val}%
          </span>
          <MiniSparkline name={displayNameText(item)} metricKey="cpu" color="#ff7bdc" />
        </div>
      )
    }},
    { key: 'memory', label: 'RAM', render: (item) => {
      if (!isContainerRunning(item)) {
        return <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
      }
      let used = item.memory?.used
      if (used == null) return <InlineMetricSkeleton width={62} />
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span className="mono" style={{ color: '#6fa8ff', fontWeight: 600, fontSize: 12 }}>
            {used < 1024 * 1024 ? `${(used / 1024).toFixed(2)} KB` : `${(used / 1024 / 1024).toFixed(2)} MB`}
          </span>
          <MiniSparkline name={displayNameText(item)} metricKey="ram" color="#6fa8ff" />
        </div>
      )
    }},
    { key: 'network', label: 'Ports', width: '14%', render: (item) => {
        const rawPorts = item.raw?.Ports || []
        const seen = new Set()
        const entries = []
        for (const p of rawPorts) {
          const privatePort = p.PrivatePort
          const publicPort = p.PublicPort
          if (!privatePort) continue
          const key = `${publicPort || 'none'}-${privatePort}`
          if (seen.has(key)) continue
          seen.add(key)
          entries.push({ publicPort, privatePort, hasForward: !!(publicPort && publicPort !== 0) })
        }
        if (entries.length === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {entries.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {p.hasForward ? (
                  <>
                    <button onClick={() => handlePortClick(p.publicPort)} className="mono" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0, fontWeight: 600, fontSize: 12 }} title="Open port">{p.publicPort}</button>
                    <ArrowRight size={12} color="#999" />
                    <span className="mono" style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12 }}>{p.privatePort}</span>
                  </>
                ) : (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); setShowNoPortPopover(p.privatePort) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }} title="No port forward - click for info">
                      <HelpCircle size={14} color="#ff7bdc" />
                    </button>
                    <Unlink size={11} style={{ color: 'var(--text-muted)' }} />
                    <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 12 }}>{p.privatePort}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )
    }},
    { key: 'created', label: 'Created', render: (item) => formatDate(item.created || item.raw?.configuration?.creationDate) },
  ]

  const visibleColumns = []
  for (const cfg of colConfig) {
    if (cfg.visible) {
      const col = allColumns.find(c => c.key === cfg.id)
      if (col) visibleColumns.push(col)
    }
  }

  return (
    <div className="page">
      <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Containers</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link to="/containers/new" className="btn-accent page-action-btn">
            <Plus size={15} /> New Container
          </Link>
        </div>
      </div>

      <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div className="instances-state-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 280px' }}>
          {['All', 'Running', 'Stopped'].map((state) => (
            <button
              key={state}
              className={`filter-pill ${filterState === state ? 'active' : ''}`}
              style={{ minHeight: 40, padding: '0 15px', fontSize: 14, gap: 8 }}
              onClick={() => setFilterState(state)}
              type="button"
            >
              {state}
              <span className="pill-count" style={{ minWidth: 22, height: 22, fontSize: 12.5 }}>
                {stateCounts[state] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="instances-search-control" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '0 10px', height: 36, minWidth: 260, background: 'var(--card-1)', position: 'relative', marginLeft: 'auto' }}>
          <button type="button" onClick={() => setShowColumnsModal(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4 }} title="Manage columns">
            <Columns size={15} />
          </button>
          {showColumnsModal && <ColumnsModal config={colConfig} setConfig={setColConfig} onClose={() => setShowColumnsModal(false)} />}
          {projects.length > 2 && (
            <CustomSelect
              value={filterProject}
              onChange={setFilterProject}
              options={projectOptions}
              controlHeight={30}
              dropdownWidth="content"
              fontFamily="var(--font-sans)"
              optionFontSize={13}
              style={{ width: 168, flexShrink: 0 }}
            />
          )}
          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <Search size={14} color="var(--text-muted)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search containers..."
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 0, color: 'var(--text-primary)', fontSize: 13 }}
          />
          {query && <button type="button" onClick={() => setQuery('')} style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}><X size={14} /></button>}
        </div>
      </div>

      <ContainerBatchActions
        selectedCount={selectedContainers.length}
        actionsEnabled={batchActionsEnabled}
        onStart={() => runBatchAction('start', 'Started', selectedNotRunning)}
        onStop={() => runBatchAction('stop', 'Stopped', selectedRunning)}
        onKill={() => runBatchAction('kill', 'Killed', selectedRunning)}
        onRestart={() => runBatchAction('restart', 'Restarted', selectedRunning)}
        onRecreate={() => runBatchAction('recreate', 'Recreated', selectedContainers)}
        onDelete={() => setBulkDeleteOpen(true)}
        onClear={clearSelection}
      />

      {containersQuery.isLoading ? (
        <SkeletonTable cols={[{ w: 140 }, { w: 100 }, { w: 220 }, { w: 70 }, { w: 90 }, { w: 90 }, { w: 120 }]} rows={5} hasCheckbox />
      ) : (
        <ContainerDataTable
          items={filtered}
          empty={query ? `No containers match "${query}"` : 'No containers'}
          columns={visibleColumns}
          selectedKeys={selectedNames}
          getItemKey={displayNameText}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          tableMinWidth={0}
          tableLayout="fixed"
          actionsWidth={180}
          renderActions={(item) => {
            const name = displayNameText(item)
            const state = displayState(item)
            const isRunning = String(state).toLowerCase() === 'running'
            return <ContainersActions name={name} isRunning={isRunning} runAction={runAction} setInspectContainer={setInspectContainer} setLogsFor={setLogsFor} setDeleteName={setDeleteName} />
          }}
        />
      )}

      {showNoPortPopover && <NoPortPopover port={showNoPortPopover} onClose={() => setShowNoPortPopover(null)} />}
      {showHostIpModal && (
        <HostIpModal 
          onClose={() => {
            setShowHostIpModal(false)
            setPendingPort(null)
          }} 
          onSave={(ip) => {
            setShowHostIpModal(false)
            qc.invalidateQueries({ queryKey: ['setting', 'host_ip'] })
            if (pendingPort) {
              window.open(`http://${ip}:${pendingPort}`, '_blank')
              setPendingPort(null)
            }
          }}
        />
      )}
      {logsFor && <ContainerLogsModal name={logsFor} onClose={() => setLogsFor(null)} />}
      {inspectContainer && <ContainerInspectModal name={inspectContainer} onClose={() => setInspectContainer(null)} />}
      {deleteName && (
        <ConfirmModal
          title={`Delete ${deleteName}`}
          description="This container will be removed."
          confirmLabel="Delete"
          variant="confirm"
          onClose={() => setDeleteName(null)}
          onConfirm={() => runAction(deleteName, 'delete', `Deleted ${deleteName}`).finally(() => setDeleteName(null))}
        />
      )}
      {bulkDeleteOpen && (
        <ConfirmModal
          title={`Delete ${selectedContainers.length} selected container${selectedContainers.length > 1 ? 's' : ''}`}
          description="Selected containers will be force removed."
          confirmLabel="Delete selected"
          variant="confirm"
          onClose={() => setBulkDeleteOpen(false)}
          onConfirm={() => runBatchAction('delete', 'Deleted', selectedContainers).finally(() => setBulkDeleteOpen(false))}
        />
      )}
    </div>
  )
}

function ContainerInspectModal({ name, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['container', name],
    queryFn: () => api.getContainer(name),
    enabled: Boolean(name),
    retry: false,
  })
  return (
    <Modal title={`Inspect · ${name}`} onClose={onClose} size="lg">
      <pre className="mono" style={{ minHeight: 260, maxHeight: '60vh', overflow: 'auto', margin: 0, padding: 14, background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
        {isLoading ? 'Loading container...' : error ? error.message : JSON.stringify(data?.container || data || {}, null, 2)}
      </pre>
    </Modal>
  )
}

function ContainerLogsModal({ name, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['container-logs', name],
    queryFn: () => api.getContainerLogs(name),
    enabled: Boolean(name),
    retry: false,
  })
  return (
    <Modal title={`Logs · ${name}`} onClose={onClose} size="lg">
      <pre className="mono" style={{ minHeight: 260, maxHeight: '60vh', overflow: 'auto', margin: 0, padding: 14, background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
        {isLoading ? 'Loading logs...' : error ? error.message : (data?.logs || 'No logs')}
      </pre>
    </Modal>
  )
}
