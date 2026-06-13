import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import IOSToggle from '../components/IOSToggle'
import DetailsTabs from '../components/instance-details/DetailsTabs'
import PermissionNotice from '../components/PermissionNotice'
import useShortcutPlatform from '../hooks/useShortcutPlatform'
import { toast } from '../toast'
import { canReadAuthSettings, canWriteAuthSettings, normalizeRole } from '../utils/rbac'

function fmtRam(mb) {
  if (!mb) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

function parseVersion(v) {
  if (!v) return '—'
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'object') {
    const app = v.container || v['container-apiserver'] || Object.values(v)[0]
    return typeof app === 'string' ? app.trim() : JSON.stringify(v)
  }
  return String(v)
}

const SETTINGS_TABS = [
  { value: 'system',     label: 'System' },
  { value: 'auth',       label: 'Auth' },
  { value: 'shortcuts',  label: 'Shortcuts' },
]
const SETTINGS_TAB_VALUES = new Set(SETTINGS_TABS.map((tab) => tab.value))

const REDACTED_DISPLAY = '••••••••••••'

function normalizeSettingsTab(tab) {
  const candidate = String(tab || '')
  return SETTINGS_TAB_VALUES.has(candidate) ? candidate : 'system'
}

function SectionShell({ children }) {
  return (
    <section style={{ paddingTop: 2 }}>
      {children}
    </section>
  )
}

function HostIpInput() {
  const qc = useQueryClient()
  const { data: ipData } = useQuery({
    queryKey: ['setting', 'host_ip'],
    queryFn: () => api.getSetting('host_ip'),
    staleTime: 60000,
  })
  const [ip, setIp] = useState(ipData?.value || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (ipData?.value !== undefined && ip === '') setIp(ipData.value)
  }, [ip, ipData])

  async function save() {
    setSaving(true)
    try {
      await api.setSetting('host_ip', ip)
      qc.invalidateQueries({ queryKey: ['setting', 'host_ip'] })
      toast.success({ title: 'Host IP saved' })
    } catch (err) {
      toast.error({ title: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        className="input"
        value={ip}
        onChange={(e) => setIp(e.target.value)}
        placeholder="External host IP"
        style={{ width: 180, fontSize: 12 }}
        onKeyDown={(e) => { if (e.key === 'Enter') save() }}
      />
      <button className="btn-accent" onClick={save} disabled={saving} style={{ fontSize: 12, padding: '4px 12px' }}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  )
}

function SystemSection() {
  const versionQuery = useQuery({ queryKey: ['system-version'], queryFn: () => api.getVersion(), staleTime: 60000 })
  const hostQuery = useQuery({ queryKey: ['system-host'], queryFn: () => api.getHostInfo(), staleTime: 60000 })
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: () => api.getHealth(), refetchInterval: 15000 })

  const containerVersion = versionQuery.data?.lines?.length ? versionQuery.data.lines.join('\n') : parseVersion(versionQuery.data?.version)
  const host = hostQuery.data || {}
  const health = healthQuery.data || {}
  const loading = versionQuery.isLoading || hostQuery.isLoading

  const rows = [
    { label: 'Hostname', value: host.hostname || '—' },
    { label: 'OS / Arch', value: host.os ? `${host.os} / ${host.arch}` : '—' },
    { label: 'Host vCPUs', value: host.cpus ? `${host.cpus} cores` : '—' },
    { label: 'Host memory', value: fmtRam(host.memory_mb) },
    { label: 'Disk free', value: host.disk_free_gb != null ? `${host.disk_free_gb} GB` : '—' },
    { label: 'Docker Engine', value: health.daemon_running ? 'Running' : 'Offline', color: health.daemon_running ? 'var(--running)' : 'var(--stopped)' },
    { label: 'Docker API', value: containerVersion || '—' },
    { label: 'WS clients', value: health.ws_clients != null ? String(health.ws_clients) : '—' },
    { label: 'Host IP', value: <HostIpInput /> },
  ]

  return (
    <SectionShell>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map(({ label, value, color }, idx) => (
          <div
            key={label}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px, 240px) 1fr',
              alignItems: 'center',
              gap: 12,
              padding: '12px 2px',
              borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
            {loading && typeof value === 'string'
              ? <span className="skeleton" style={{ width: 90, height: 12, borderRadius: 4 }} />
              : typeof value === 'string'
                ? <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: color || 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{value}</span>
                : value}
          </div>
        ))}
      </div>
    </SectionShell>
  )
}


function AuthSection({ currentRole }) {
  const qc = useQueryClient()
  const normalizedRole = normalizeRole(currentRole)
  const canRead = canReadAuthSettings(normalizedRole)
  const canWrite = canWriteAuthSettings(normalizedRole)

  const authQuery = useQuery({
    queryKey: ['auth-settings'],
    queryFn: () => api.getAuthSettings(),
    enabled: canRead,
    retry: false,
  })

  const [form, setForm] = useState({
    local_password_enabled: true,
    enabled: false,
    issuer: '',
    client_id: '',
    client_secret: '',
    redirect_url: '',
    scopes: 'openid profile email',
    claim_login: 'preferred_username',
    claim_name: 'name',
    claim_avatar: 'picture',
    claim_groups: 'groups',
    admin_groups: '',
  })

  useEffect(() => {
    const oidc = authQuery.data?.oidc
    if (!oidc) return
    const nextValues = {
      local_password_enabled: authQuery.data?.local?.password_enabled ?? true,
      enabled: Boolean(oidc.enabled),
      issuer: oidc.issuer || '',
      client_id: oidc.client_id || '',
      client_secret: oidc.has_client_secret ? REDACTED_DISPLAY : '',
      redirect_url: oidc.redirect_url || '',
      scopes: oidc.scopes || 'openid profile email',
      claim_login: oidc.claim_login || 'preferred_username',
      claim_name: oidc.claim_name || 'name',
      claim_avatar: oidc.claim_avatar || 'picture',
      claim_groups: oidc.claim_groups || 'groups',
      admin_groups: oidc.admin_groups || '',
    }
    const timer = setTimeout(() => {
      setForm((f) => ({ ...f, ...nextValues }))
    }, 0)
    return () => clearTimeout(timer)
  }, [authQuery.data])

  const save = useMutation({
    mutationFn: () => {
      const oidc = {
        enabled: Boolean(form.enabled),
        issuer: form.issuer,
        client_id: form.client_id,
        redirect_url: form.redirect_url,
        scopes: form.scopes,
        claim_login: form.claim_login,
        claim_name: form.claim_name,
        claim_avatar: form.claim_avatar,
        claim_groups: form.claim_groups,
        admin_groups: form.admin_groups,
      }
      if (form.client_secret && form.client_secret !== REDACTED_DISPLAY) {
        oidc.client_secret = form.client_secret
      }
      return api.updateAuthSettings({
        local: { password_enabled: Boolean(form.local_password_enabled) },
        oidc,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-settings'] })
      toast.success({ title: 'Auth settings updated', duration: 2500 })
    },
    onError: (e) => toast.error({ title: e.message }),
  })

  if (!canRead) {
    return (
      <SectionShell>
        <PermissionNotice
          title="Action Not Permitted"
          description="Administrator or owner role is required to view authentication settings."
        />
      </SectionShell>
    )
  }

  return (
    <SectionShell>
      {authQuery.isLoading ? (
        <div className="skeleton" style={{ height: 180, borderRadius: 12, maxWidth: 760 }} />
      ) : authQuery.isError ? (
        <p className="mono" style={{ marginTop: 8, color: 'var(--stopped)', fontSize: 12.5 }}>
          {authQuery.error?.message || 'Failed to load auth settings'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 12, maxWidth: 760 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 0',
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Enable password login</p>
            </div>
            <IOSToggle
              checked={form.local_password_enabled}
              disabled={!canWrite}
              onChange={(next) => setForm((f) => ({ ...f, local_password_enabled: next }))}
            />
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 0',
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Enable OIDC login</p>
            </div>
            <IOSToggle
              checked={form.enabled}
              disabled={!canWrite}
              onChange={(next) => setForm((f) => ({ ...f, enabled: next }))}
            />
          </div>

          <div>
            <label className="input-label" htmlFor="auth-issuer">Issuer URL</label>
            <input
              id="auth-issuer"
              className="input"
              value={form.issuer}
              onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))}
              placeholder="https://id.example.com"
              disabled={!canWrite}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="input-label" htmlFor="auth-client-id">Client ID</label>
              <input
                id="auth-client-id"
                className="input"
                value={form.client_id}
                onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
                disabled={!canWrite}
              />
            </div>
            <div>
              <label className="input-label" htmlFor="auth-client-secret">Client Secret</label>
              <input
                id="auth-client-secret"
                className="input"
                type="password"
                value={form.client_secret}
                onFocus={() => {
                  if (!canWrite) return
                  setForm((f) => (
                    f.client_secret === REDACTED_DISPLAY
                      ? { ...f, client_secret: '' }
                      : f
                  ))
                }}
                onChange={(e) => setForm((f) => ({ ...f, client_secret: e.target.value }))}
                disabled={!canWrite}
              />
            </div>
          </div>

          <div>
            <label className="input-label" htmlFor="auth-redirect-url">Redirect URL (optional)</label>
            <input
              id="auth-redirect-url"
              className="input"
              value={form.redirect_url}
              onChange={(e) => setForm((f) => ({ ...f, redirect_url: e.target.value }))}
              placeholder="eve.example.com"
              disabled={!canWrite}
            />
          </div>

          <div>
            <label className="input-label" htmlFor="auth-scopes">Scopes</label>
            <input
              id="auth-scopes"
              className="input"
              value={form.scopes}
              onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))}
              disabled={!canWrite}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label className="input-label" htmlFor="auth-claim-login">Login claim</label>
              <input
                id="auth-claim-login"
                className="input"
                value={form.claim_login}
                onChange={(e) => setForm((f) => ({ ...f, claim_login: e.target.value }))}
                disabled={!canWrite}
              />
            </div>
            <div>
              <label className="input-label" htmlFor="auth-claim-name">Name claim</label>
              <input
                id="auth-claim-name"
                className="input"
                value={form.claim_name}
                onChange={(e) => setForm((f) => ({ ...f, claim_name: e.target.value }))}
                disabled={!canWrite}
              />
            </div>
            <div>
              <label className="input-label" htmlFor="auth-claim-avatar">Avatar claim</label>
              <input
                id="auth-claim-avatar"
                className="input"
                value={form.claim_avatar}
                onChange={(e) => setForm((f) => ({ ...f, claim_avatar: e.target.value }))}
                disabled={!canWrite}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="input-label" htmlFor="auth-claim-groups">Groups claim</label>
              <input
                id="auth-claim-groups"
                className="input"
                value={form.claim_groups}
                onChange={(e) => setForm((f) => ({ ...f, claim_groups: e.target.value }))}
                disabled={!canWrite}
              />
            </div>
            <div>
              <label className="input-label" htmlFor="auth-admin-groups">Admin groups</label>
              <input
                id="auth-admin-groups"
                className="input"
                value={form.admin_groups}
                onChange={(e) => setForm((f) => ({ ...f, admin_groups: e.target.value }))}
                placeholder="admins"
                disabled={!canWrite}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-accent" onClick={() => save.mutate()} disabled={!canWrite || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </SectionShell>
  )
}

const SHORTCUTS = [
  { label: 'Open search in Dashboard', key: 'K' },
  { label: 'Go to Dashboard',          key: 'D' },
  { label: 'Toggle sidebar',           key: 'B' },
  { label: 'New container',            key: 'N' },
]

function ShortcutKeys({ keys }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {keys.map((k) => (
        <kbd
          key={k}
          style={{
            fontSize: 11.5,
            fontFamily: 'IBM Plex Mono',
            fontWeight: 500,
            background: 'var(--card-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '3px 8px',
            color: 'var(--text-primary)',
            lineHeight: 1,
            minWidth: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {k === '⌘'
            ? <span style={{ fontSize: 13.5, lineHeight: 1, transform: 'translateY(1px)' }}>⌘</span>
            : k}
        </kbd>
      ))}
    </div>
  )
}

function ShortcutsSection() {
  const { modifierKeyDisplay } = useShortcutPlatform()

  return (
    <SectionShell>
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 600 }}>
        {SHORTCUTS.map(({ label, key }, idx) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              padding: '10px 0',
              borderBottom: idx < SHORTCUTS.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
            <ShortcutKeys keys={[modifierKeyDisplay, key]} />
          </div>
        ))}
      </div>
    </SectionShell>
  )
}

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = normalizeSettingsTab(searchParams.get('tab'))
  const meQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: () => api.getCurrentUser(),
    retry: false,
  })
  const currentRole = normalizeRole(meQuery.data?.user?.role || 'user')

  useEffect(() => {
    const focusId = searchParams.get('focus')
    if (!focusId) return undefined
    const targetTab = normalizeSettingsTab(searchParams.get('tab'))
    if (targetTab !== activeTab) return undefined

    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(focusId)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (typeof el.focus === 'function') el.focus({ preventScroll: true })
    })

    const timer = setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      next.delete('focus')
      setSearchParams(next, { replace: true })
    }, 280)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [activeTab, searchParams, setSearchParams])

  function handleTabChange(nextTab) {
    const normalized = normalizeSettingsTab(nextTab)
    const nextParams = new URLSearchParams(searchParams)
    if (normalized === 'system') nextParams.delete('tab')
    else nextParams.set('tab', normalized)
    nextParams.delete('focus')
    setSearchParams(nextParams, { replace: true })
  }

  return (
    <div className="page">
      <div style={{ marginBottom: 28 }}>
        <h1 className="page-title">Settings</h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 980 }}>
        <DetailsTabs tabs={SETTINGS_TABS} value={activeTab} onChange={handleTabChange} />

        {activeTab === 'system' && <SystemSection />}
        {activeTab === 'auth' && <AuthSection currentRole={currentRole} />}
        {activeTab === 'shortcuts' && <ShortcutsSection />}
      </div>
    </div>
  )
}
