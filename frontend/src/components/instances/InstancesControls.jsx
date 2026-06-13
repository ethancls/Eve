import { Search, X, Grid3X3, Table2 } from 'lucide-react'
import CustomSelect from '../CustomSelect'
import { STATE_FILTERS } from './instancesUtils'

export default function InstancesControls({
  stateFilter,
  onStateFilterChange,
  imageFilter,
  onImageFilterChange,
  imageOptions,
  query,
  onQueryChange,
  viewMode,
  onViewModeChange,
  counts,
}) {
  return (
    <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
      <div className="instances-state-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 320px' }}>
        {STATE_FILTERS.map((state) => (
          <button
            key={state}
            onClick={() => onStateFilterChange(state)}
            className={`filter-pill${stateFilter === state ? ' active' : ''}`}
            style={{ minHeight: 40, padding: '0 15px', fontSize: 14, gap: 8 }}
          >
            {state}
            <span className="pill-count" style={{ minWidth: 22, height: 22, fontSize: 12.5 }}>{counts?.[state] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="instances-controls-right" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto', minWidth: 0 }}>
        <div className="instances-search-control" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--card-2)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', padding: '0 12px', height: 42, width: 'clamp(170px, 24vw, 250px)',
        }}>
          <Search size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search instances..."
            style={{
              background: 'none', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontFamily: 'IBM Plex Mono', fontSize: 14,
              width: '100%',
            }}
          />
          {query && (
            <button
              onClick={() => onQueryChange('')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', width: 22, height: 22, justifyContent: 'center',
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        <CustomSelect
          value={imageFilter}
          onChange={onImageFilterChange}
          options={imageOptions}
          searchable
          controlHeight={42}
          style={{ minWidth: 140, width: 'clamp(160px, 24vw, 240px)', flex: '0 1 auto' }}
        />

        <div className="instances-view-toggle" style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)',
          overflow: 'hidden',
          height: 42,
        }}>
          <button
            type="button"
            aria-label="Table view"
            className="btn-ghost"
            onClick={() => onViewModeChange('table')}
            style={{
              border: 'none',
              borderRadius: 0,
              height: '100%',
              background: viewMode === 'table' ? 'var(--accent-dim)' : 'transparent',
              color: viewMode === 'table' ? 'var(--accent)' : 'var(--text-secondary)',
              padding: '0 14px',
            }}
          >
            <Table2 size={15} />
          </button>
          <button
            type="button"
            aria-label="Card view"
            className="btn-ghost"
            onClick={() => onViewModeChange('cards')}
            style={{
              border: 'none',
              borderRadius: 0,
              height: '100%',
              background: viewMode === 'cards' ? 'var(--accent-dim)' : 'transparent',
              color: viewMode === 'cards' ? 'var(--accent)' : 'var(--text-secondary)',
              padding: '0 14px',
            }}
          >
            <Grid3X3 size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
