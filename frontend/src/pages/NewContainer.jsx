import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Rocket, Plus, Minus, Dices, Search, X, Star, ChevronDown, Box } from 'lucide-react'
import Tooltip from '../components/Tooltip'
import IOSToggle from '../components/IOSToggle'
import { toast } from '../toast'
import { api } from '../api/client'

const ADJECTIVES = ['swift', 'calm', 'bold', 'bright', 'cool', 'dark', 'eager', 'fine', 'grand', 'happy', 'icy', 'keen', 'light', 'mild', 'neat', 'odd', 'proud', 'quick', 'rare', 'safe', 'tiny', 'vast', 'warm', 'young', 'zealous']
const NOUNS = ['shadow', 'lake', 'mountain', 'river', 'cloud', 'storm', 'reef', 'forest', 'glacier', 'peak', 'canyon', 'island', 'ocean', 'desert', 'valley']
function randomName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${a}-${n}`
}

const PRICE_VCPU_HR  = 0.0208
const PRICE_GBRAM_HR = 0.0052
const PRICE_GBDISK_HR = 0.00011

function lines(v) { return String(v || '').split('\n').map(l => l.trim()).filter(Boolean) }
function words(v) { return String(v || '').trim().split(/\s+/).filter(Boolean) }
function fmtMem(mb) { return mb >= 1024 ? `${(mb/1024).toFixed(mb%1024===0?0:1)} GB` : `${mb} MB` }
function fmtCost(usd) { return `$${usd.toFixed(2)}` }

function Stepper({ label, value, min, max, step, onChange }) {
  const clamp = (n) => Math.max(min, Math.min(max, n))
  return (
    <div>
      <label className="input-label">{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="btn-ghost" style={{ width: 32, height: 32, padding: 0, justifyContent: 'center' }}
          onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Decrease ${label}`}>
          <Minus size={12} />
        </button>
        <input type="text" inputMode="numeric" pattern="[0-9]*" className="input mono"
          value={String(value)}
          onChange={e => { const d = e.target.value.replace(/[^\d]/g, ''); if (d) onChange(clamp(Number(d))); else onChange(min) }}
          style={{ textAlign: 'center', minWidth: 86, paddingInline: 8, lineHeight: 1 }}
        />
        <button type="button" className="btn-ghost" style={{ width: 32, height: 32, padding: 0, justifyContent: 'center' }}
          onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`Increase ${label}`}>
          <Plus size={12} />
        </button>
      </div>
    </div>
  )
}

function TabBar({ tab, onChange, badges }) {
  const tabs = [
    { value: 'basics', label: 'Basics' },
    { value: 'resources', label: 'Resources' },
    { value: 'network', label: 'Network' },
    { value: 'advanced', label: 'Advanced', badge: badges?.advanced },
  ]
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 0 }}>
      {tabs.map(t => {
        const isActive = tab === t.value
        return (
          <button key={t.value} type="button" onClick={() => onChange(t.value)}
            style={{
              background: 'none', border: 'none', borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, padding: '8px 16px', cursor: 'pointer',
              fontSize: 13, fontWeight: isActive ? 700 : 500,
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              lineHeight: 1, transition: 'color 0.13s, border-color 0.13s',
              display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono',
                background: isActive ? 'var(--accent-dim)' : 'rgba(255,255,255,0.06)',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                border: `1px solid ${isActive ? 'var(--accent-border)' : 'var(--border)'}`,
                borderRadius: 100, padding: '1px 6px', lineHeight: 1.6,
              }}>{t.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function ImageSearch({ value, onChange }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['image-search', q],
    queryFn: () => api.searchRegistry('docker.io', q),
    enabled: q.trim().length >= 2 && open,
    staleTime: 30000,
  })

  const localQuery = useQuery({
    queryKey: ['images-local'],
    queryFn: () => api.getLocalImages(),
    staleTime: 30000,
    enabled: open,
  })

  const results = (data?.results || []).slice().sort((a, b) => (b.star_count || 0) - (a.star_count || 0))
  const localImages = localQuery.data?.images || []

  function selectImage(name) {
    onChange(name)
    setOpen(false)
    setQ('')
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            className="input mono"
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              setQ(e.target.value)
              if (e.target.value.length >= 2) setOpen(true)
            }}
            onFocus={() => { if (value.length >= 2 || localImages.length > 0) setOpen(true) }}
            placeholder="Search Docker Hub or type image:tag..."
            style={{ paddingRight: 36, height: 37 }}
          />
          {value && (
            <button type="button"
              onClick={() => { onChange(''); setQ(''); setOpen(false) }}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, borderRadius: 4 }}>
              <X size={14} />
            </button>
          )}
        </div>
        <button type="button" onClick={() => setOpen(!open)}
          className="btn" style={{ display: 'flex', alignItems: 'center', gap: 4, height: 37, padding: '0 12px', cursor: 'pointer' }}>
          <Search size={14} /> <ChevronDown size={12} />
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 43, left: 0, right: 0,
          background: 'var(--card-1)', border: '1px solid var(--border)',
          borderRadius: 12, zIndex: 100, maxHeight: 360, overflow: 'auto',
          boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
        }}>
          <div style={{ padding: 12 }}>
            {localImages.length > 0 && (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Local Images</p>
                {localImages.map(img => {
                  const name = img.name || img.id
                  return (
                    <button key={name} type="button" onClick={() => selectImage(name)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '8px 10px', borderRadius: 8, border: 'none',
                        background: value === name ? 'var(--accent-dim)' : 'transparent',
                        color: 'var(--text-primary)', cursor: 'pointer',
                        fontSize: 12.5, textAlign: 'left',
                      }}>
                      <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', flexShrink: 0 }}>
                        <Box size={14} color="var(--accent)" />
                      </div>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
                    </button>
                  )
                })}
                <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
              </>
            )}

            <p style={{ margin: '0 0 8px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Docker Hub</p>

            {isLoading && (
              <div style={{ padding: 14, textAlign: 'center' }}>
                <div style={{ width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto' }} />
              </div>
            )}

            {results.length > 0 && results.slice(0, 10).map(r => (
              <button key={r.name} type="button" onClick={() => selectImage(r.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '8px 10px', borderRadius: 8, border: 'none',
                  background: value === r.name ? 'var(--accent-dim)' : 'transparent',
                  color: 'var(--text-primary)', cursor: 'pointer',
                  fontSize: 12.5, textAlign: 'left',
                }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', flexShrink: 0 }}>
                  <Box size={14} color="var(--accent)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{r.name}</span>
                  {r.description && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</p>}
                </div>
                {r.is_official && <span style={{ fontSize: 10, background: 'rgba(74,222,128,0.12)', color: 'var(--running)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>OFFICIAL</span>}
                {r.star_count > 0 && (
                  <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    <Star size={12} style={{ color: '#f59e0b' }} /> {r.star_count}
                  </span>
                )}
              </button>
            ))}

            {!isLoading && q.length >= 2 && results.length === 0 && (
              <p style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No results for "{q}"</p>
            )}

            {!isLoading && q.length < 2 && (
              <p style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>Type to search Docker Hub...</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewPanel({ form, built }) {
  const ramMb = form.memory || 512
  const ramGb = ramMb / 1024
  const diskGb = form.disk || 10
  const hourly = (form.cpus||1)*PRICE_VCPU_HR + ramGb*PRICE_GBRAM_HR + diskGb*PRICE_GBDISK_HR
  const monthly = hourly * 730

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 30 }}>
      {/* Command preview */}
      <div className="card" style={{ padding: 16 }}>
        <p className="section-label" style={{ marginBottom: 10 }}>Command</p>
        <pre className="mono" style={{
          whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-secondary)',
          fontSize: 11, lineHeight: 1.5, background: 'var(--card-2)',
          padding: 10, borderRadius: 8, wordBreak: 'break-all',
        }}>{built.command || 'docker run ...'}</pre>
      </div>

      {/* Preview */}
      <div className="card" style={{ padding: 20 }}>
        <p className="section-label" style={{ marginBottom: 14 }}>Preview</p>
        <div style={{ marginBottom: 16 }}>
          <p className="mono" style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
            {form.name.trim() || <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>container-name</span>}
          </p>
          <p className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1 }}>
            {form.image.trim() || 'select an image'}
          </p>
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
          {[
            { label: 'vCPU', value: `${form.cpus||1}` },
            { label: 'RAM', value: fmtMem(form.memory||512) },
            { label: 'Mode', value: form.mode === 'create' ? 'Create' : 'Run' },
          ].map(({ label, value }, i) => (
            <div key={label} style={{ flex: 1, textAlign: 'center', borderLeft: i>0?'1px solid var(--border)':'none', padding: '0 6px' }}>
              <p className="mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, marginBottom: 5 }}>{value}</p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Cost */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Cost estimate</p>
            <a href="https://aws.amazon.com/ec2/pricing/on-demand/" target="_blank" rel="noreferrer"
              style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}>EC2 prices ↗</a>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{fmtCost(monthly)}</p>
            <p style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>/month est.</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { label: `${form.cpus||1} vCPU`, val: `${fmtCost((form.cpus||1)*PRICE_VCPU_HR)}/hr`, color: '#b5f23d' },
            { label: `${fmtMem(form.memory||512)} RAM`, val: `${fmtCost(ramGb*PRICE_GBRAM_HR)}/hr`, color: '#60a5fa' },
            { label: `${form.disk||10} GB Disk`, val: `${fmtCost(diskGb*PRICE_GBDISK_HR)}/hr`, color: '#a78bfa' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-primary)', flex: 1 }}>{label}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function NewContainer() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '', image: '',
    cpus: 1, memory: 512, disk: 10,
    mode: 'run', command: '', workdir: '', user: '',
    env: '', ports: '', volumes: '', network: 'bridge',
    platform: '',
    detach: true, tty: false, interactive: false,
    init: false, readOnly: false, remove: false,
  })
  const [tab, setTab] = useState('basics')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const built = useMemo(() => {
    const flags = []
    if (form.name) flags.push('--name', form.name)
    if (form.cpus > 1) flags.push('--cpus', String(form.cpus))
    if (form.memory !== 512) flags.push('--memory', `${form.memory}m`)
    lines(form.env).forEach(e => { flags.push('-e', e) })
    lines(form.ports).forEach(p => { flags.push('-p', p) })
    lines(form.volumes).forEach(v => { flags.push('-v', v) })
    if (form.network && form.network !== 'bridge') flags.push('--network', form.network)
    if (form.workdir) flags.push('-w', form.workdir)
    if (form.user) flags.push('-u', form.user)
    if (form.platform) flags.push('--platform', form.platform)
    if (form.detach) flags.push('-d')
    if (form.tty) flags.push('-t')
    if (form.interactive) flags.push('-i')
    if (form.init) flags.push('--init')
    if (form.readOnly) flags.push('--read-only')
    if (form.remove) flags.push('--rm')

    const cmd = [
      'docker',
      form.mode === 'create' ? 'create' : 'run',
      ...flags,
      form.image || '<image>',
      ...words(form.command),
    ].join(' ')

    return { command: cmd, flags, args: words(form.command) }
  }, [form])

  async function handleSubmit(e) {
    e?.preventDefault()
    const name = form.name.trim()
    if (!name) { setError('Container name is required'); return }
    const image = form.image.trim()
    if (!image) { setError('Image is required'); return }
    setError('')
    setSubmitting(true)
    try {
      const envs = {}
      lines(form.env).forEach(e => { const [k,...v]=e.split('='); if(k) envs[k]=v.join('=') })
      const ports = {}
      lines(form.ports).forEach(p => { const parts=p.split(':'); if(parts.length>=2) ports[parts[parts.length-1].split('/')[0]]=parts[0]; else ports[p]=p })

      await api.createContainer({ image, name, args: words(form.command), options: { env: envs, ports } })
      toast.success({ title: `${form.mode==='create'?'Created':'Started'} ${name}` })
      navigate(`/containers/${encodeURIComponent(name)}`)
    } catch (err) { toast.error({ title: err.message }) }
    finally { setSubmitting(false) }
  }

  const advancedBadge = (form.env.trim() ? 1 : 0) + (form.volumes.trim() ? 1 : 0) + (form.command.trim() ? 1 : 0)

  return (
    <div className="page">
      <div className="new-instance-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, gap: 14, flexWrap: 'wrap' }}>
        <h1 className="page-title">New Container</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn-accent" onClick={handleSubmit} disabled={submitting || !form.name.trim() || !form.image.trim()}>
            <Rocket size={13} /> Launch Container
          </button>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderRadius: 12, marginBottom: 20, background: 'rgba(240,71,71,0.08)', border: '1px solid rgba(240,71,71,0.22)' }}>
          <span style={{ fontSize: 12, color: 'var(--stopped)', margin: 0, lineHeight: 1.5 }}>{error}</span>
          <button type="button" onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--stopped)', padding: 2, display: 'flex', opacity: 0.6 }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}>
            <span style={{ fontSize: 14 }}>×</span>
          </button>
        </div>
      )}

      <TabBar tab={tab} onChange={setTab} badges={{ advanced: advancedBadge || null }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 340px)', gap: 24, alignItems: 'start' }}>
        <div>
          <form onSubmit={handleSubmit}>
            {tab === 'basics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
                  <div>
                    <label className="input-label" htmlFor="nc-image">Image</label>
                    <ImageSearch value={form.image} onChange={v => set('image', v)} />
                  </div>
                  <div>
                    <label className="input-label" htmlFor="nc-name">Container Name *</label>
                    <div style={{ position: 'relative', maxWidth: 400 }}>
                      <input id="nc-name" className="input" value={form.name} placeholder="my-container"
                        onChange={e => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        style={{ paddingRight: 36, height: 37 }} />
                      <Tooltip label="Generate" style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)' }}>
                        <button type="button" aria-label="Generate" onClick={() => set('name', randomName())}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 5, display: 'flex', color: 'var(--text-muted)', transition: 'color 0.13s' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                          <Dices size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'resources' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18 }}>
                  <Stepper label="CPUs" value={form.cpus} min={1} max={16} step={1} onChange={cpus => set('cpus', cpus)} />
                  <Stepper label="RAM (MB)" value={form.memory} min={64} max={32768} step={128} onChange={memory => set('memory', memory)} />
                  <Stepper label="Disk (GB)" value={form.disk} min={1} max={500} step={1} onChange={disk => set('disk', disk)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="input-label" htmlFor="nc-mode">Mode</label>
                    <select id="nc-mode" className="input" value={form.mode} onChange={e => set('mode', e.target.value)}
                      style={{ height: 37, cursor: 'pointer' }}>
                      <option value="run">Run now</option>
                      <option value="create">Create only</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label" htmlFor="nc-command">Command / Args</label>
                    <input id="nc-command" className="input mono" value={form.command} onChange={e => set('command', e.target.value)} placeholder="/bin/sh" />
                  </div>
                  <div>
                    <label className="input-label" htmlFor="nc-platform">Platform</label>
                    <input id="nc-platform" className="input mono" value={form.platform} onChange={e => set('platform', e.target.value)} placeholder="linux/amd64" />
                  </div>
                </div>
              </div>
            )}

            {tab === 'network' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="input-label" htmlFor="nc-network">Network Mode</label>
                  <input id="nc-network" className="input" value={form.network} onChange={e => set('network', e.target.value)} placeholder="bridge" style={{ maxWidth: 300 }} />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>bridge, host, none, or custom network name</p>
                </div>
                <div>
                  <label className="input-label" htmlFor="nc-ports">Ports (one per line)</label>
                  <textarea id="nc-ports" className="input mono" value={form.ports} onChange={e => set('ports', e.target.value)}
                    rows={5} placeholder={'8080:80\n3000:3000'} style={{ maxWidth: 500 }} />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Format: host:container</p>
                </div>
                <div>
                  <label className="input-label" htmlFor="nc-volumes">Volumes (one per line)</label>
                  <textarea id="nc-volumes" className="input mono" value={form.volumes} onChange={e => set('volumes', e.target.value)}
                    rows={5} placeholder={'/host/path:/container/path\nvolume_name:/container/path'} style={{ maxWidth: 500 }} />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Format: host:container or volume:container</p>
                </div>
              </div>
            )}

            {tab === 'advanced' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="input-label" htmlFor="nc-workdir">Workdir</label>
                    <input id="nc-workdir" className="input mono" value={form.workdir} onChange={e => set('workdir', e.target.value)} placeholder="/" />
                  </div>
                  <div>
                    <label className="input-label" htmlFor="nc-user">User</label>
                    <input id="nc-user" className="input mono" value={form.user} onChange={e => set('user', e.target.value)} placeholder="name|uid[:gid]" />
                  </div>
                </div>
                <div>
                  <label className="input-label" htmlFor="nc-env">Environment (KEY=value, one per line)</label>
                  <textarea id="nc-env" className="input mono" value={form.env} onChange={e => set('env', e.target.value)}
                    rows={5} placeholder={'PORT=8080\nNODE_ENV=production'} style={{ maxWidth: 500 }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                  {[
                    ['detach', 'Detach'],
                    ['tty', 'TTY'],
                    ['interactive', 'Interactive'],
                    ['init', 'Init'],
                    ['readOnly', 'Read-only root'],
                    ['remove', 'Remove on exit'],
                  ].map(([key, label]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', minHeight: 38, cursor: 'pointer' }}
                      onClick={() => set(key, !form[key])}>
                      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 700 }}>{label}</span>
                      <IOSToggle checked={form[key]} onChange={v => set(key, v)} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>

        <PreviewPanel form={form} built={built} />
      </div>
    </div>
  )
}
