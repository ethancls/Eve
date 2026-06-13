import { useState } from 'react'
import { Pause, Trash2, Rocket, Activity, Power, PowerOff, Files, Key } from 'lucide-react'
import { useActivity } from '../hooks/useActivity'

const ACTION_META = {
  start:    { Icon: Power,     color: 'var(--running)',   bg: 'rgba(111,168,255,0.10)', accent: '#6fa8ff' },
  stop:     { Icon: PowerOff,   color: 'var(--stopped)',   bg: 'rgba(240,71,71,0.08)',   accent: '#f04747' },
  suspend:  { Icon: Pause,    color: 'var(--suspended)', bg: 'rgba(255,159,10,0.08)',  accent: '#ff9f0a' },
  delete:   { Icon: Trash2,   color: '#555',             bg: 'rgba(255,255,255,0.04)', accent: '#555'    },
  launch:   { Icon: Rocket,   color: '#ff7bdc',          bg: 'rgba(255,123,220,0.10)', accent: '#ff7bdc' },
  snapshot: { Icon: Files,   color: '#a78bfa',          bg: 'rgba(167,139,250,0.08)', accent: '#a78bfa' },
  ssh_password:      { Icon: Key, color: '#555',             bg: 'rgba(255,255,255,0.04)', accent: '#555'    },
}

const FILTERS = ['ALL', 'START', 'STOP', 'LAUNCH', 'SNAPSHOT']

function groupByDate(entries) {
  const groups = {}
  for (const e of entries) {
    const d = new Date(e.timestamp).toLocaleDateString('en', { month: 'short', day: 'numeric' })
    if (!groups[d]) groups[d] = []
    groups[d].push(e)
  }
  return groups
}

export default function ActivityFeed() {
  const [filter, setFilter] = useState('ALL')
  const { data, isLoading } = useActivity(100)
  const all = data?.activity ?? []
  const filtered = filter === 'ALL' ? all : all.filter(e => e.action?.toUpperCase() === filter)
  const grouped = groupByDate(filtered.slice(0, 40))

  return (
    <div className="card dashboard-activity-card">
      {/* Header */}
      <div className="dashboard-activity-header">
        <p className="section-title">Recent Activity</p>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
          {all.length} event{all.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filters */}
      <div className="dashboard-activity-filters">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`filter-pill${filter === f ? ' active' : ''}`}
            style={{ fontSize: 10.5, padding: '4px 10px' }}
          >{f}</button>
        ))}
      </div>

      {/* Feed */}
      <div className="dashboard-activity-scroll">
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['s0','s1','s2','s3','s4'].map(k => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: '55%', height: 12, borderRadius: 6, marginBottom: 7 }} />
                  <div className="skeleton" style={{ width: '35%', height: 10, borderRadius: 6 }} />
                </div>
                <div className="skeleton" style={{ width: 36, height: 10, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No activity yet</p>
          </div>
        )}

        {!isLoading && Object.entries(grouped).map(([date, entries]) => (
          <div key={date} style={{ marginBottom: 20 }}>
            <p className="section-label" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              {date}
              <span style={{ flex: 1, height: 1, background: 'var(--border)', display: 'block' }} />
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {entries.map((e, i) => {
                const meta = ACTION_META[e.action] ?? { Icon: Activity, color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.04)', accent: '#555' }
                const time = new Date(e.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
                const success = e.status === 'success'
                return (
                  <div key={`${e.vm_name || ''}-${e.action || ''}-${e.timestamp || i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 12px',
                    borderRadius: 10,
                    borderLeft: `3px solid ${meta.accent}22`,
                    background: 'transparent',
                    transition: 'background 0.1s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                      background: meta.bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: meta.color,
                      border: `1px solid ${meta.accent}22`,
                    }}>
                      <meta.Icon size={12} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="mono" style={{
                        fontSize: 12.5, fontWeight: 600, lineHeight: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        color: 'var(--text-primary)', marginBottom: 4,
                      }}>
                        {e.vm_name}
                      </p>
                      <p style={{
                        fontSize: 11, color: 'var(--text-secondary)',
                        lineHeight: 1, textTransform: 'capitalize',
                      }}>
                        {e.action}
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1 }}>{time}</span>
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, lineHeight: 1,
                        color: success ? 'var(--running)' : 'var(--stopped)',
                        background: success ? 'rgba(111,168,255,0.10)' : 'rgba(240,71,71,0.08)',
                        padding: '2px 6px', borderRadius: 100,
                      }}>
                        {e.status}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
