import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import Tooltip from '../Tooltip'

const EMPTY_IPS = []

export default function CopyIP({ ips = EMPTY_IPS }) {
  const [copiedIp, setCopiedIp] = useState('')
  const items = Array.isArray(ips) ? ips.filter(Boolean) : []
  if (items.length === 0) return <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>—</span>

  function doCopy(e, ip) {
    e.stopPropagation()
    navigator.clipboard.writeText(ip).then(() => {
      setCopiedIp(ip)
      setTimeout(() => setCopiedIp((current) => (current === ip ? '' : current)), 1800)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {items.map((ip) => (
        <div key={ip} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, lineHeight: 1 }}>
            {ip}
          </span>
          <Tooltip label={copiedIp === ip ? 'Copied!' : 'Copy IP'}>
            <button
              type="button"
              aria-label={copiedIp === ip ? 'Copied!' : 'Copy IP'}
              onClick={(e) => doCopy(e, ip)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '2px 3px', flexShrink: 0,
                color: copiedIp === ip ? 'var(--running)' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center',
                borderRadius: 4, transition: 'color 0.2s',
              }}
              onMouseEnter={e => { if (copiedIp !== ip) e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { if (copiedIp !== ip) e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {copiedIp === ip ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  )
}
