import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import Modal from './Modal'

export default function ConfirmModal({
  title,
  description,
  confirmLabel = 'Delete',
  confirmValue,
  variant = 'confirm',
  onConfirm,
  onClose,
}) {
  const [input, setInput] = useState('')
  const [step, setStep] = useState(0)   // 0=ready, 1=armed (both variants)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  function doCopy() {
    if (!confirmValue) return
    navigator.clipboard.writeText(confirmValue).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const nameMatch = variant === 'name' ? input === confirmValue : true
  const canArm = variant === 'name' ? nameMatch : true

  async function handleClick() {
    if (!canArm) return
    if (step === 0) { setStep(1); return }
    setLoading(true)
    try { await onConfirm() } finally { setLoading(false) }
    onClose()
  }

  const armed = step === 1

  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            onClick={handleClick}
            disabled={loading || !canArm}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '0 18px', height: 38, borderRadius: 'var(--r-sm)',
              border: '1px solid',
              cursor: loading || !canArm ? 'not-allowed' : 'pointer',
              fontFamily: 'Syne', fontWeight: 700, fontSize: 13,
              whiteSpace: 'nowrap', lineHeight: 1,
              boxSizing: 'border-box',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s',
              ...(armed ? {
                background: 'var(--stopped)',
                borderColor: 'var(--stopped)',
                color: '#fff',
              } : {
                background: 'rgba(240,71,71,0.12)',
                borderColor: 'rgba(240,71,71,0.22)',
                color: 'var(--stopped)',
              }),
              opacity: loading || !canArm ? 0.45 : 1,
            }}
          >
            {loading ? 'Working…' : armed ? 'Confirm?' : confirmLabel}
          </button>
        </>
      }
    >
      {description && (
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0, marginBottom: variant === 'name' ? 16 : 0 }}>
          {description}
        </p>
      )}

      {variant === 'name' && confirmValue && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label className="input-label" style={{ margin: 0 }}>
              Type <span className="mono" style={{ color: 'var(--text-primary)' }}>{confirmValue}</span> to confirm
            </label>
            <button
              type="button"
              onClick={doCopy}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                color: copied ? 'var(--running)' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, fontFamily: 'Syne', fontWeight: 600,
                borderRadius: 5, transition: 'color 0.15s',
              }}
              onMouseEnter={e => { if (!copied) e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { if (!copied) e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <input
            className="input"
            value={input}
            onChange={e => { setInput(e.target.value); if (step === 1) setStep(0) }}
            placeholder={confirmValue}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && canArm && !loading) handleClick() }}
          />
        </div>
      )}
    </Modal>
  )
}
