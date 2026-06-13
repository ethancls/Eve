import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleArrowUp, Loader2 } from 'lucide-react'
import { toast } from '../../toast'
import Modal from '../Modal'
import { api } from '../../api/client'

function parseAptLine(line) {
  // "package-name/channel 2.0-1 amd64 [upgradable from: 1.0-1]"
  const name    = (line.split(/\s+/)[0] || '').split('/')[0]
  const newVer  = line.split(/\s+/)[1] || '—'
  const fromMatch = line.match(/\[upgradable from:\s*([^\]]+)\]/)
  const oldVer  = fromMatch ? fromMatch[1].trim() : '—'
  return { name, oldVer, newVer }
}

export default function UpdatesModal({ instanceName, onClose }) {
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)
  const [actionError, setActionError] = useState('')

  const updatesQuery = useQuery({
    queryKey: ['instance-updates', instanceName],
    queryFn:  () => api.getInstanceUpdates(instanceName),
    enabled:  Boolean(instanceName),
  })

  const item = useMemo(() => {
    const list = updatesQuery.data?.updates
    return Array.isArray(list) && list.length > 0 ? list[0] : null
  }, [updatesQuery.data])

  const loading     = updatesQuery.isLoading
  const error       = updatesQuery.error?.message
  const hasUpdates  = (item?.upgradable || 0) > 0
  const hasSecurity = (item?.security || 0) > 0
  const canRun      = item?.state === 'Running' && !running && !updatesQuery.isFetching

  const packages = useMemo(() =>
    (item?.packages || []).map(parseAptLine),
    [item?.packages]
  )

  function getErrorMessage(err) {
    if (!err) return 'Failed to run updates'
    if (typeof err === 'string') return err
    if (typeof err?.message === 'string' && err.message.trim()) return err.message.trim()
    return 'Failed to run updates'
  }

  async function runUpdates() {
    setRunning(true)
    setActionError('')
    try {
      const result = await api.runInstanceUpdates(instanceName, { full_upgrade: false, refresh: true, autoremove: true })
      const remaining = Number(result?.upgradable_remaining || 0)
      await Promise.all([
        updatesQuery.refetch(),
        qc.invalidateQueries({ queryKey: ['updates'] }),
        qc.invalidateQueries({ queryKey: ['instance-updates', instanceName] }),
        qc.invalidateQueries({ queryKey: ['activity'] }),
      ])
      qc.refetchQueries({ queryKey: ['updates'], type: 'active' }) // best-effort
      setActionError('')
      if (result?.checked === false) {
        toast.warning({
          title: 'Updates completed, verification failed',
          description: result?.error || 'Could not verify remaining updates.',
        })
      } else if (result?.checked === true && remaining > 0) {
        toast.warning({
          title: 'Updates completed with pending packages',
          description: `${remaining} update${remaining > 1 ? 's' : ''} still pending on ${instanceName}.`,
        })
      } else {
        toast.success({ title: 'Updates completed' })
      }
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal
      title={`Updates · ${instanceName}`}
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-accent"
            disabled={!canRun}
            onClick={runUpdates}
          >
            {running
              ? (
                <>
                  <Loader2
                    size={13}
                    style={{
                      animation: 'spin 0.7s linear infinite',
                      transformOrigin: '50% 50%',
                      backfaceVisibility: 'hidden',
                      transform: 'translateZ(0)',
                      display: 'block',
                    }}
                  />
                  Updating…
                </>
              )
              : <><CircleArrowUp size={13} /> Run updates</>
            }
          </button>
        </>
      )}
    >
      {loading && (
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
          Checking…
        </p>
      )}

      {!loading && error && (
        <p
          className="mono"
          style={{
            fontSize: 12, color: 'var(--stopped)', margin: 0,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
          }}
        >
          {error}
        </p>
      )}

      {!loading && !error && actionError && (
        <p
          className="mono"
          style={{
            fontSize: 12, color: 'var(--stopped)', margin: 0,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
          }}
        >
          {actionError}
        </p>
      )}

      {!loading && !error && item && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* ── Status line ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingInline: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5, color: hasUpdates ? '#facc15' : 'var(--running)' }}>
              {hasUpdates
                ? `${item.upgradable} package${item.upgradable > 1 ? 's' : ''} to update`
                : 'System up to date'}
            </span>
            {hasSecurity && (
              <span style={{ fontSize: 12, color: 'var(--stopped)', fontWeight: 600 }}>
                · {item.security} security
              </span>
            )}
            {item.reboot_required && (
              <span style={{ fontSize: 12, color: '#facc15', fontWeight: 600 }}>
                · reboot required
              </span>
            )}
            {item.state !== 'Running' && (
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginLeft: 4 }}>
                · start instance to apply updates
              </span>
            )}
          </div>

          {/* ── Package table ── */}
          {packages.length > 0 && (
            <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Package', 'Current', 'New'].map((h) => (
                      <th key={h} style={{
                        padding: '7px 4px 8px', textAlign: 'left',
                        fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {packages.map(({ name, oldVer, newVer }, idx) => (
                    <tr
                      key={name || `pkg-${idx}`}
                      style={{ borderBottom: idx < packages.length - 1 ? '1px solid var(--border)' : 'none' }}
                    >
                      <td className="mono" style={{ padding: '8px 4px', fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                        {name}
                      </td>
                      <td className="mono" style={{ padding: '8px 4px', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {oldVer}
                      </td>
                      <td className="mono" style={{ padding: '8px 4px', fontSize: 11.5, color: 'var(--accent)' }}>
                        {newVer}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── No package detail available ── */}
          {!packages.length && hasUpdates && (
            <p className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
              {item.upgradable} update{item.upgradable > 1 ? 's' : ''} available — no package detail
            </p>
          )}

          {/* ── Error from check ── */}
          {!item.checked && item.error && (
            <p className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0 }}>
              Check error: {item.error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
