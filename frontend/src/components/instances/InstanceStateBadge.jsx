const STATE_CLASS = {
  Running:   'state-badge-running',
  Stopped:   'state-badge-stopped',
  Suspended: 'state-badge-suspended',
  Deleted:   'state-badge-deleted',
  Starting:  'state-badge-starting',
  Stopping:  'state-badge-stopping',
}

export default function InstanceStateBadge({ state }) {
  const cls = STATE_CLASS[state] ?? 'state-badge-unknown'
  return (
    <span className={`state-badge ${cls}`}>
      <span className={state === 'Running' ? 'state-badge-dot state-badge-dot--pulse' : 'state-badge-dot'} />
      {state}
    </span>
  )
}
