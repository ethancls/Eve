import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Power, PowerOff, Pause, Files, RotateCcw, CopyPlus, Trash2, Loader2, ChevronsUpDown, ChevronUp, ChevronDown, Key, CircleArrowUp, ArchiveRestore, ArrowUpRight } from 'lucide-react'
import { toast } from '../toast'
import { api } from '../api/client'
import ConfirmModal from './ConfirmModal'
import Tooltip from './Tooltip'
import InstanceStateBadge from './instances/InstanceStateBadge'
import InstancesCheckbox from './instances/InstancesCheckbox'
import ActionRadialMenu from './instances/ActionRadialMenu'
import CloneInstanceModal from './instances/CloneInstanceModal'
import SshAccessModal from './instances/SshAccessModal'
import UpdatesModal from './instances/UpdatesModal'
import CopyIP from './instances/CopyIP'
import ResourceUsage from './instances/ResourceUsage'
import { fmtResource, sortValue, invalidateInstanceQueries, randomSnapshotName } from './instances/instancesUtils'

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'state', label: 'State' },
  { key: 'ipv4', label: 'IPv4' },
  { key: 'image', label: 'Image' },
  { key: 'cpus', label: 'vCPUs' },
  { key: 'memory', label: 'RAM' },
  { key: 'disk', label: 'Disk' },
  { key: 'usage', label: 'Usage' },
  { key: null, label: 'Actions' },
]

const CENTERED_HEADERS = new Set(['vCPUs', 'RAM', 'Disk', 'Usage', 'Actions'])

// Terminal state to wait for after each action (via WebSocket updates)
const TARGET_STATE = {
  start:   'Running',
  stop:    'Stopped',
  suspend: 'Suspended',
  restart: 'Running',
  recover: 'Stopped',
  // delete / snapshot / clone: no stable target — cleared immediately after API response
}

const EMPTY_INSTANCES = []
const EMPTY_NAMES = new Set()

const ACTION_BUTTON_SIZE = 44
const ACTION_BUTTON_GAP = 5
const ACTION_CELL_HORIZONTAL_PADDING = 36
const MAX_VISIBLE_ACTION_SLOTS = 4 // Grip included

const ACTION_VISIBILITY_PRIORITY = {
  stop: 400,
  start: 390,
  ssh: 380,
  updates: 370,
}

function splitVisibleAndOverflowActions(actions, containerWidth) {
  if (!actions.length) return { visibleActions: [], overflowActions: [] }
  const usableWidth = Math.max(ACTION_BUTTON_SIZE, containerWidth)
  const maxByWidth = Math.max(
    1,
    Math.floor((usableWidth + ACTION_BUTTON_GAP) / (ACTION_BUTTON_SIZE + ACTION_BUTTON_GAP)),
  )
  const maxSlots = Math.min(MAX_VISIBLE_ACTION_SLOTS, maxByWidth)

  if (actions.length <= maxSlots) {
    return { visibleActions: actions, overflowActions: [] }
  }

  const visibleCount = Math.max(0, maxSlots - 1) // reserve one slot for Grip menu
  const prioritizedIndexes = actions
    .map((action, index) => ({
      index,
      score: (ACTION_VISIBILITY_PRIORITY[action.key] || 0) + (action.isLoading ? 1000 : 0),
    }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, visibleCount)
    .map((item) => item.index)
  const visibleIndexSet = new Set(prioritizedIndexes)
  const visibleActions = actions.filter((_, index) => visibleIndexSet.has(index))
  const overflowActions = actions.filter((_, index) => !visibleIndexSet.has(index))

  // Preserve original order for visual consistency.
  visibleActions.sort((a, b) => actions.indexOf(a) - actions.indexOf(b))
  overflowActions.sort((a, b) => actions.indexOf(a) - actions.indexOf(b))

  return { visibleActions, overflowActions }
}

function ActionBtn({ icon, color, label, onClick, isLoading = false, disabled = false }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={!isLoading && !disabled ? onClick : undefined}
        style={{
          width: ACTION_BUTTON_SIZE, height: ACTION_BUTTON_SIZE, borderRadius: 10, border: 'none',
          background: 'transparent',
          color: disabled && !isLoading ? 'var(--text-muted)' : color,
          cursor: isLoading || disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.12s, color 0.12s, opacity 0.12s',
          flexShrink: 0,
          opacity: disabled && !isLoading ? 0.3 : 1,
          touchAction: 'manipulation',
        }}
        onMouseEnter={(e) => {
          if (!isLoading && !disabled) e.currentTarget.style.background = `color-mix(in srgb, ${color} 12%, transparent)`
        }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {isLoading
          ? <Loader2 size={15} style={{ animation: 'spin 0.7s linear infinite' }} />
          : icon
        }
      </button>
    </Tooltip>
  )
}

export default function InstancesTable({
  instances = EMPTY_INSTANCES,
  selectedNames = EMPTY_NAMES,
  onToggleSelect,
  onToggleSelectAll,
  searchQuery = '',
}) {
  const location = useLocation()
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  // loading[name] = action key ('start', 'stop', …) while in progress, null/undefined otherwise
  const [loading, setLoading] = useState({})
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [cloneDialog, setCloneDialog] = useState(null)
  const [sshDialogInstance, setSshDialogInstance] = useState('')
  const [updatesDialogInstance, setUpdatesDialogInstance] = useState('')
  const [actionsCellWidth, setActionsCellWidth] = useState(240)
  const qc = useQueryClient()
  const updatesItems = useQuery({
    queryKey: ['updates'],
    queryFn: () => api.getUpdates(),
    staleTime: 60000,
    refetchInterval: 120000,
  }).data?.updates || []

  // Watch WebSocket-updated instances to clear spinner when target state is reached
  useEffect(() => {
    const id = setTimeout(() => {
      setLoading(prev => {
        const entries = Object.entries(prev).filter(([, v]) => v)
        if (!entries.length) return prev
        let changed = false
        const next = { ...prev }
        for (const [name, action] of entries) {
          const target = TARGET_STATE[action]
          if (!target) continue
          const inst = instances.find(i => i.name === name)
          if (inst?.state === target) {
            next[name] = null
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 0)
    return () => clearTimeout(id)
  }, [instances])

  function toggleSort(key) {
    if (!key) return
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const sorted = [...instances].sort((a, b) => {
    if (!sort.key) return 0
    const av = sortValue(a, sort.key)
    const bv = sortValue(b, sort.key)
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
    return sort.dir === 'asc' ? cmp : -cmp
  })

  const allSelected = sorted.length > 0 && sorted.every((i) => selectedNames.has(i.name))
  const firstRowName = sorted[0]?.name || ''

  useEffect(() => {
    const cell = document.querySelector('.instances-table-actions-measure')
    if (!cell) return undefined

    const update = () => {
      setActionsCellWidth(Math.max(0, cell.clientWidth - ACTION_CELL_HORIZONTAL_PADDING))
    }

    update()
    if (typeof ResizeObserver === 'undefined') return undefined

    const ro = new ResizeObserver(update)
    ro.observe(cell)
    return () => ro.disconnect()
  }, [firstRowName, sorted.length])

  async function doAction(name, actionKey, fn, successMsg) {
    setLoading(l => ({ ...l, [name]: actionKey }))
    try {
      await fn()
      invalidateInstanceQueries(qc)
      toast.success({ title: successMsg })
      if (!TARGET_STATE[actionKey]) {
        setLoading(l => ({ ...l, [name]: null }))
        return
      }
      // Wait for WebSocket to push the new state, with a 30s safety fallback
      setTimeout(() => {
        setLoading(l => l[name] === actionKey ? { ...l, [name]: null } : l)
      }, 30_000)
    } catch (err) {
      toast.error({ title: err.message })
      setLoading(l => ({ ...l, [name]: null }))
    }
  }

  return (
    <>
      <div className="instances-table-shell" style={{ background: 'var(--card-1)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', overflow: 'visible' }}>
        <div className="instances-table-scroll no-scrollbar" style={{ overflowX: 'auto', overflowY: 'visible' }}>
          <table className="instances-table" style={{ width: '100%', minWidth: 1120, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '12px 10px 12px 14px', width: 40 }}>
                <InstancesCheckbox checked={allSelected} onChange={() => onToggleSelectAll(sorted.map((s) => s.name), allSelected)} />
              </th>
              {COLUMNS.map(({ key, label }) => {
                const active = sort.key === key
                const SortIcon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
                const centered = CENTERED_HEADERS.has(label)
                const ariaSort = key
                  ? (active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none')
                  : undefined
                return (
                  <th
                    key={label}
                    aria-sort={ariaSort}
                    style={{
                      padding: '12px 18px',
                      textAlign: centered ? 'center' : 'left',
                      fontSize: 12.5, fontWeight: 700, color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                      textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap',
                      cursor: key ? 'pointer' : 'default', userSelect: 'none',
                    }}
                  >
                    {key ? (
                      <button
                        type="button"
                        className="instances-table-sort-button"
                        onClick={() => toggleSort(key)}
                        aria-label={`Sort by ${label}${active ? `, currently ${sort.dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          justifyContent: centered ? 'center' : 'flex-start',
                          width: '100%',
                          border: 'none',
                          background: 'transparent',
                          padding: 0,
                          margin: 0,
                          font: 'inherit',
                          color: 'inherit',
                          cursor: 'pointer',
                          textTransform: 'inherit',
                          letterSpacing: 'inherit',
                        }}
                      >
                        {label}
                        <SortIcon size={13} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: centered ? 'center' : 'flex-start' }}>
                        {label}
                      </div>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14 }}>
                  {searchQuery.trim() ? `No results for "${searchQuery}"` : 'No instances'}
                </td>
              </tr>
            )}
            {sorted.map((inst, idx) => {
              const { name, state, ipv4 = [], image, cpus, memory, disk } = inst
              const activeAction = loading[name] // e.g. 'start', 'stop', null
              const busy = !!activeAction
              const updatesEntry      = updatesItems.find(u => u.instance === name)
              const hasPendingUpdates = (updatesEntry?.upgradable || 0) > 0
              const updatesColor      = hasPendingUpdates ? '#22d3ee' : 'var(--text-muted)'
              const actionItems = [
                state !== 'Running' && {
                  key: 'start',
                  Icon: Power,
                  color: 'var(--running)',
                  label: 'Start',
                  isLoading: activeAction === 'start',
                  disabled: busy && activeAction !== 'start',
                  onClick: () => doAction(name, 'start', () => api.startInstance(name), `Started ${name}`),
                },
                state === 'Running' && {
                  key: 'stop',
                  Icon: PowerOff,
                  color: 'var(--stopped)',
                  label: 'Shutdown',
                  isLoading: activeAction === 'stop',
                  disabled: busy && activeAction !== 'stop',
                  onClick: () => doAction(name, 'stop', () => api.stopInstance(name), `Stopped ${name}`),
                },
                state === 'Running' && {
                  key: 'suspend',
                  Icon: Pause,
                  color: 'var(--suspended)',
                  label: 'Suspend',
                  isLoading: activeAction === 'suspend',
                  disabled: busy && activeAction !== 'suspend',
                  onClick: () => doAction(name, 'suspend', () => api.suspendInstance(name), `Suspended ${name}`),
                },
                state === 'Running' && {
                  key: 'restart',
                  Icon: RotateCcw,
                  color: '#60a5fa',
                  label: 'Restart',
                  isLoading: activeAction === 'restart',
                  disabled: busy && activeAction !== 'restart',
                  onClick: () => doAction(name, 'restart', () => api.restartInstance(name), `Restarted ${name}`),
                },
                state === 'Running' && {
                  key: 'ssh',
                  Icon: Key,
                  color: '#facc15',
                  label: 'SSH Access',
                  isLoading: false,
                  disabled: busy,
                  onClick: () => setSshDialogInstance(name),
                },
                state === 'Running' && {
                  key: 'updates',
                  Icon: CircleArrowUp,
                  color: updatesColor,
                  label: hasPendingUpdates ? 'Updates' : 'No updates',
                  isLoading: false,
                  disabled: busy || !hasPendingUpdates,
                  onClick: () => setUpdatesDialogInstance(name),
                },
                state === 'Stopped' && {
                  key: 'snapshot',
                  Icon: Files,
                  color: '#a78bfa',
                  label: 'Snapshot',
                  isLoading: false,
                  disabled: busy,
                  onClick: () => doAction(name, 'snapshot', () => api.createSnapshot(name, randomSnapshotName(name)), `Snapshot created for ${name}`),
                },
                state === 'Stopped' && {
                  key: 'clone',
                  Icon: CopyPlus,
                  color: '#34d399',
                  label: 'Clone',
                  isLoading: false,
                  disabled: busy,
                  onClick: () => setCloneDialog({ source: name, suggested: `${name}-clone` }),
                },
                state === 'Deleted' && {
                  key: 'recover',
                  Icon: ArchiveRestore,
                  color: '#34d399',
                  label: 'Recover',
                  isLoading: activeAction === 'recover',
                  disabled: busy && activeAction !== 'recover',
                  onClick: () => doAction(name, 'recover', () => api.recoverInstance(name), `Recovered ${name}`),
                },
                {
                  key: 'delete',
                  Icon: Trash2,
                  color: 'var(--stopped)',
                  label: state === 'Deleted' ? 'Purge' : 'Delete',
                  isLoading: activeAction === 'delete',
                  disabled: busy && activeAction !== 'delete',
                  onClick: () => setConfirmDelete(name),
                },
              ].filter(Boolean)
              const { visibleActions, overflowActions } = splitVisibleAndOverflowActions(actionItems, actionsCellWidth)

              return (
                <tr
                  key={name}
                  style={{ borderBottom: idx < sorted.length - 1 ? '1px solid var(--border)' : 'none', transition: 'background 0.1s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.018)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '14px 10px 14px 14px' }}>
                    <InstancesCheckbox checked={selectedNames.has(name)} onChange={() => onToggleSelect(name)} />
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <Link
                        to={`/instances/${encodeURIComponent(name)}`}
                        state={{ from: location.pathname }}
                        className="mono"
                        style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {name}
                      </Link>
                      <Link
                        to={`/instances/${encodeURIComponent(name)}`}
                        state={{ from: location.pathname }}
                        aria-label={`Open ${name}`}
                        style={{
                          color: 'var(--text-secondary)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          flexShrink: 0,
                          transition: 'color 0.13s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                      >
                        <ArrowUpRight size={14} />
                      </Link>
                    </div>
                  </td>
                  <td style={{ padding: '14px 18px' }}><InstanceStateBadge state={state} /></td>
                  <td style={{ padding: '14px 18px' }}><CopyIP ips={ipv4} /></td>
                  <td style={{ padding: '14px 18px' }}>
                    <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{image || '—'}</span>
                  </td>
                  <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{cpus || '—'}</span>
                  </td>
                  <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {fmtResource(memory?.total)}
                    </span>
                  </td>
                  <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {fmtResource(disk?.total)}
                    </span>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'nowrap' }}>
                      <ResourceUsage used={memory?.used} total={memory?.total} compact mode="percent" label="RAM" showTooltip />
                      <ResourceUsage used={disk?.used} total={disk?.total} compact mode="percent" label="DSK" showTooltip />
                    </div>
                  </td>
                  <td className={idx === 0 ? 'instances-table-actions-measure' : ''} style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}>
                      {visibleActions.map((action) => (
                        <ActionBtn
                          key={action.key}
                          icon={<action.Icon size={15} />}
                          color={action.color}
                          label={action.label}
                          isLoading={action.isLoading}
                          disabled={action.disabled}
                          onClick={action.onClick}
                        />
                      ))}
                      {overflowActions.length > 0 && (
                        <ActionRadialMenu
                          actions={overflowActions.map((action) => ({
                            label: action.label,
                            icon: <action.Icon size={15} />,
                            color: action.color,
                            onClick: action.onClick,
                            disabled: action.disabled || action.isLoading,
                          }))}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          </table>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete}`}
          description={`The instance "${confirmDelete}" will be permanently deleted and purged. All data inside will be lost.`}
          confirmLabel="Delete"
          confirmValue={confirmDelete}
          variant="name"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => doAction(confirmDelete, 'delete', () => api.deleteInstance(confirmDelete), `Deleted ${confirmDelete}`)}
        />
      )}

      {cloneDialog && (
        <CloneInstanceModal
          sourceName={cloneDialog.source}
          initialName={cloneDialog.suggested}
          onClose={() => setCloneDialog(null)}
          onConfirm={(cloneName) => doAction(
            cloneDialog.source,
            'clone',
            () => api.cloneInstance(cloneDialog.source, cloneName),
            `Cloned ${cloneDialog.source} → ${cloneName}`,
          )}
        />
      )}

      {sshDialogInstance && (
        <SshAccessModal
          instanceName={sshDialogInstance}
          onClose={() => setSshDialogInstance('')}
        />
      )}

      {updatesDialogInstance && (
        <UpdatesModal
          instanceName={updatesDialogInstance}
          onClose={() => setUpdatesDialogInstance('')}
        />
      )}
    </>
  )
}
