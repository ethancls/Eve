import { Power, PowerOff, RotateCw, Pause, Files, Trash2, X } from 'lucide-react'
import Tooltip from '../Tooltip'

const EMPTY_ACTIONS = {}

function BatchIconButton({ label, icon, onClick, color, disabled = false }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        className="instances-batch-action-btn"
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

export default function InstancesBatchActions({
  selectedCount,
  onStart,
  onStop,
  onRestart,
  onSuspend,
  onSnapshot,
  onDelete,
  onClear,
  actionsEnabled = EMPTY_ACTIONS,
}) {
  if (!selectedCount) return null
  return (
    <div className="instances-batch-actions" style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      marginBottom: 10,
      padding: '0 2px',
    }}>
      <div className="instances-batch-toolbar" style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
      }}>
        <BatchIconButton
          label="Start selected"
          icon={<Power size={16} />}
          onClick={onStart}
          color="var(--running)"
          disabled={!actionsEnabled.start}
        />
        <BatchIconButton
          label="Stop selected"
          icon={<PowerOff size={16} />}
          onClick={onStop}
          color="var(--stopped)"
          disabled={!actionsEnabled.stop}
        />
        <BatchIconButton
          label="Restart selected"
          icon={<RotateCw size={16} />}
          onClick={onRestart}
          color="#60a5fa"
          disabled={!actionsEnabled.restart}
        />
        <BatchIconButton
          label="Suspend selected"
          icon={<Pause size={16} />}
          onClick={onSuspend}
          color="var(--suspended)"
          disabled={!actionsEnabled.suspend}
        />
        <BatchIconButton
          label="Snapshot selected"
          icon={<Files size={16} />}
          onClick={onSnapshot}
          color="#a78bfa"
          disabled={!actionsEnabled.snapshot}
        />
        <BatchIconButton
          label="Delete selected"
          icon={<Trash2 size={16} />}
          onClick={onDelete}
          color="var(--stopped)"
          disabled={!actionsEnabled.delete}
        />
        <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
        <BatchIconButton label="Clear selection" icon={<X size={16} />} onClick={onClear} color="var(--text-secondary)" />
      </div>
    </div>
  )
}
