import { useState } from 'react'
import { Camera, History, Trash2, Dices } from 'lucide-react'
import { randomSnapshotName } from '../instances/instancesUtils'
import Tooltip from '../Tooltip'

const EMPTY_SNAPSHOTS = []

function snapshotName(item) {
  if (!item || typeof item !== 'object') return ''
  if (item.name) return String(item.name)
  if (item.snapshot) return String(item.snapshot)
  if (item.id) return String(item.id)
  return ''
}

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ActionBtn({ icon, color, label, onClick, disabled }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        style={{
          width: 32, height: 32, borderRadius: 8, border: 'none',
          background: 'transparent', color: disabled ? 'var(--text-muted)' : color,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.12s', flexShrink: 0,
          opacity: disabled ? 0.35 : 1,
        }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = `color-mix(in srgb, ${color} 12%, transparent)` }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

export default function SnapshotsPanel({
  instanceName = '',
  snapshots = EMPTY_SNAPSHOTS,
  loading = false,
  onCreate,
  onRestore,
  onDelete,
}) {
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')

  async function submitCreate(event) {
    event.preventDefault()
    await onCreate(name.trim(), comment.trim() || undefined)
    setName('')
    setComment('')
  }

  return (
    <div>
      <p className="section-title" style={{ marginBottom: 12 }}>Snapshots</p>

      <form onSubmit={submitCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 16 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Snapshot name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ paddingRight: 34, width: '100%' }}
            required
          />
          <button
            type="button"
            title="Random name"
            onClick={() => setName(randomSnapshotName(instanceName))}
            style={{
              position: 'absolute', right: 6,
              background: 'none', border: 'none', padding: 2,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              color: 'var(--text-secondary)', opacity: 0.7,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
          >
            <Dices size={14} />
          </button>
        </div>
        <input
          className="input"
          placeholder="Comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <button className="btn-accent" style={{ height: 38 }} type="submit" disabled={loading}>
          <Camera size={13} /> Snapshot
        </button>
      </form>

      {snapshots.length === 0 ? (
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          No snapshots for this instance.
        </p>
      ) : (
        <div className="instances-table-shell" style={{ background: 'var(--card-1)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Name', 'Created', 'Comment', 'Actions'].map((col) => (
                  <th key={col} style={{
                    padding: '10px 16px', textAlign: 'left',
                    fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((item, index) => {
                const nameValue = snapshotName(item)
                const canAct = Boolean(nameValue)
                const created = item.created_at || item.created || ''
                const commentVal = item.comment || ''
                return (
                  <tr
                    key={nameValue || `snap-${index}`}
                    style={{ borderBottom: index < snapshots.length - 1 ? '1px solid var(--border)' : 'none', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.018)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {nameValue || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {fmtDate(created)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', maxWidth: 220 }}>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                        {commentVal || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <ActionBtn
                          icon={<History size={14} />}
                          color="#a78bfa"
                          label="Restore"
                          disabled={!canAct || loading}
                          onClick={() => onRestore(nameValue)}
                        />
                        <ActionBtn
                          icon={<Trash2 size={14} />}
                          color="var(--stopped)"
                          label="Delete"
                          disabled={!canAct || loading}
                          onClick={() => onDelete(nameValue)}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
