import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import OverviewCard from '../components/OverviewCard'
import ActivityFeed from '../components/ActivityFeed'
import SearchBar from '../components/SearchBar'
import { Plus } from 'lucide-react'
import InstanceStateBadge from '../components/instances/InstanceStateBadge'
import BrandIcon from '../components/BrandIcon'

const ResourceChart  = lazy(() => import('../components/ResourceChart'))
const CostEstimator  = lazy(() => import('../components/CostEstimator'))

const COLORS = ['#6fa8ff','#ff7bdc','#a78bfa','#f472b6','#818cf8','#ec4899','#4f7cff','#e11d48','#8ec5ff','#f8719e','#6366f1','#fb7185']

function fmtRam(bytes) {
  if (!bytes) return '—'
  if (bytes >= 1024**3) return `${(bytes / 1024**3).toFixed(2)} GB`
  if (bytes >= 1024**2) return `${(bytes / 1024**2).toFixed(2)} MB`
  return `${(bytes / 1024).toFixed(2)} KB`
}

function OverviewSkeleton() {
  return (
    <div className="dashboard-overview-card" style={{ minHeight: 220 }}>
      <div className="dashboard-overview-content">
        <div className="skeleton" style={{ width: 60, height: 10, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 120, height: 20, marginBottom: 20 }} />
        <div className="dashboard-overview-stats" style={{ background: 'rgba(255,255,255,0.05)', padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i}>
                <div className="skeleton" style={{ width: 50, height: 10, marginBottom: 4 }} />
                <div className="skeleton" style={{ width: i % 2 ? 30 : 60, height: 18 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ContainerCard({ container }) {
  return (
    <div
      className="card"
      style={{ position: 'relative', transition: 'border-color 0.18s, background 0.18s', height: '100%', boxSizing: 'border-box' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-border)'; e.currentTarget.style.background = 'var(--card-2)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--card-1)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <BrandIcon name={container.name} type="machine" size={16} />
            <p className="mono" style={{ fontWeight: 600, fontSize: 14, lineHeight: 1, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {container.name}
            </p>
          </div>
          <InstanceStateBadge state={container.state === 'running' ? 'Running' : 'Stopped'} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span className="mono" style={{ fontSize: 12, color: '#ff7bdc', fontWeight: 600 }}>
            {container.cpu != null ? `${Number(container.cpu).toFixed(1)}%` : '—'}
          </span>
          <span className="mono" style={{ fontSize: 11, color: '#6fa8ff', fontWeight: 600 }}>
            {container.memory?.used != null ? fmtRam(container.memory.used) : '—'}
          </span>
        </div>
      </div>
      <div className="stat-cell" style={{ marginBottom: 10 }}>
        <span className="stat-label">Image</span>
        <span className="mono stat-value" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{container.image || '-'}</span>
      </div>
      <div className="stat-cell">
        <span className="stat-label">Created</span>
        <span className="stat-value" style={{ fontSize: 12 }}>{container.created ? new Date(container.created).toLocaleDateString() : container.status || '-'}</span>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="dashboard-skeleton-card">
      <div className="dashboard-skeleton-card-top">
        <div className="skeleton" style={{ width: 90, height: 14 }} />
        <div className="skeleton" style={{ width: 54, height: 20, borderRadius: 100 }} />
      </div>
      <div className="skeleton" style={{ width: '60%', height: 11, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: '40%', height: 11, marginBottom: 18 }} />
      <div className="dashboard-skeleton-card-actions">
        <div className="skeleton" style={{ flex: 1, height: 30, borderRadius: 8 }} />
        <div className="skeleton" style={{ width: 32, height: 30, borderRadius: 8 }} />
      </div>
    </div>
  )
}


export default function Dashboard({ onNewInstance }) {
  const query = useQuery({ queryKey: ['containers'], queryFn: () => api.getContainers(), refetchInterval: 10000 })
  const containers = query.data?.containers || []
  const isLoading = query.isLoading

  const running = containers.filter(i => i.state === 'running')
  const totalRam = running.reduce((s, i) => s + (i.memory?.total ?? 0), 0)

  // Stable color per container name
  const colorMap = {}
  containers.forEach((c, i) => { colorMap[c.name] = COLORS[i % COLORS.length] })

  return (
    <div className="page dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-header-title">
          <h1 className="page-title">Dashboard</h1>
        </div>
        <div className="dashboard-header-actions">
          <SearchBar fluid triggerLabel="Search" controlHeight={40} tourId="dashboard-search" />
          <button className="btn-accent dashboard-new-btn page-action-btn" data-tour="new-instance-primary" onClick={onNewInstance}>
            <Plus size={13} /> New Container
          </button>
        </div>
      </div>

      <div className="dashboard-main-grid">
        <div className="dashboard-main-overview">
          {isLoading ? <OverviewSkeleton /> : <OverviewCard />}
        </div>

        <div className="dashboard-main-instances">
          <div className="dashboard-instances-head">
            <p className="section-title">Containers</p>
            <Link className="dashboard-see-all" to="/containers">
              See all ({containers.length})
            </Link>
          </div>

          {isLoading ? (
            <div className="dashboard-instances-grid">
              {['s0','s1','s2'].map(k => <SkeletonCard key={k} />)}
            </div>
          ) : containers.length === 0 ? (
            <div className="dashboard-empty-state">
              <p className="dashboard-empty-state-text">No containers yet</p>
              <button className="btn-accent" onClick={onNewInstance}><Plus size={13} /> New Container</button>
            </div>
          ) : (
            <div className="dashboard-instances-grid">
              {containers.slice(0, 3).map(inst => (
                <ContainerCard key={inst.name} container={inst} />
              ))}
            </div>
          )}

          {isLoading && running.length > 0 && (
            <div className="dashboard-ram-section">
              <div className="skeleton" style={{ width: 120, height: 10, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '100%', height: 6, borderRadius: 4 }} />
            </div>
          )}
          {!isLoading && running.length > 0 && totalRam > 0 && (
            <div className="dashboard-ram-section">
              <p className="section-label dashboard-ram-title">RAM distribution</p>
              <div className="dashboard-ram-bar">
                {running.map((inst) => (
                  <div key={inst.name}
                    style={{ width: `${((inst.memory?.total ?? 0) / totalRam) * 100}%`, background: colorMap[inst.name], transition: 'width 0.4s' }}
                    title={`${inst.name}: ${((inst.memory?.total ?? 0) / (1024**3)).toFixed(1)}G`}
                  />
                ))}
              </div>
              <div className="dashboard-ram-legend">
                {running.map((inst) => (
                  <div key={inst.name} className="dashboard-ram-legend-item">
                    <div className="dashboard-ram-legend-dot" style={{ background: colorMap[inst.name] }} />
                    <span className="mono dashboard-ram-legend-name">{inst.name}</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                      {fmtRam(inst.memory?.used || 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      <div className="dashboard-bottom-stack">
        <Suspense fallback={null}>
          <ResourceChart instances={containers} />
        </Suspense>
        <Suspense fallback={null}>
          <CostEstimator containers={containers} />
        </Suspense>
        <ActivityFeed />
      </div>
    </div>
  )
}
