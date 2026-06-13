import Checkbox from './InstancesCheckbox'
import InstanceCard from '../InstanceCard'

const EMPTY_ARRAY = []
const EMPTY_SET = new Set()

export default function InstancesCardsView({ instances = EMPTY_ARRAY, selectedNames = EMPTY_SET, onToggleSelect }) {
  if (instances.length === 0) {
    return (
      <div style={{
        background: 'var(--card-1)', borderRadius: 'var(--r-card)', border: '1px dashed var(--border)',
        padding: '32px 24px', textAlign: 'center',
      }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>No instances in this view</p>
      </div>
    )
  }

  return (
    <div className="instances-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 12 }}>
      {instances.map((inst) => (
        <div key={inst.name} style={{ position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              right: 24,
              zIndex: 8,
              background: 'var(--card-1)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 2,
            }}
          >
            <Checkbox checked={selectedNames.has(inst.name)} onChange={() => onToggleSelect(inst.name)} />
          </div>
          <InstanceCard instance={inst} />
        </div>
      ))}
    </div>
  )
}
