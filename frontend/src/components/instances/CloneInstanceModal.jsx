import { useMemo, useState } from 'react'
import Modal from '../Modal'

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

export default function CloneInstanceModal({ sourceName, initialName, onClose, onConfirm }) {
  const [name, setName] = useState(initialName || '')
  const [loading, setLoading] = useState(false)

  const trimmed = name.trim()
  const error = useMemo(() => {
    if (!trimmed) return 'Clone name is required'
    if (!NAME_RE.test(trimmed)) return 'Use lowercase letters, digits and hyphens only'
    if (trimmed === sourceName) return 'Clone name must be different from source instance'
    return ''
  }, [trimmed, sourceName])

  async function handleConfirm() {
    if (error || loading) return
    setLoading(true)
    try {
      await onConfirm(trimmed)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={`Clone ${sourceName}`}
      size="sm"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-accent" onClick={handleConfirm} disabled={loading || Boolean(error)}>
            {loading ? 'Cloning…' : 'Clone'}
          </button>
        </>
      )}
    >
      <label className="input-label" htmlFor="clone-name">New Instance Name</label>
      <input
        id="clone-name"
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
        autoFocus
      />
      {error && (
        <p className="mono" style={{ marginTop: 8, fontSize: 11.5, color: 'var(--stopped)' }}>
          {error}
        </p>
      )}
    </Modal>
  )
}
