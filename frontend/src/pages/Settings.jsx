import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import CustomSelect from '../components/CustomSelect'
import IOSToggle from '../components/IOSToggle'
import DetailsTabs from '../components/instance-details/DetailsTabs'
import Modal from '../components/Modal'
import PermissionNotice from '../components/PermissionNotice'
import { RegistryProviderIcon } from '../components/RegistryProviderIcon'
import useShortcutPlatform from '../hooks/useShortcutPlatform'
import { prepareCreationOptions, parseCredential } from '../utils/webauthn'
import { Plus } from 'lucide-react'
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
  { value: 'system',        label: 'System' },
  { value: 'auth',          label: 'Auth' },
  { value: 'security',      label: 'Security' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'shortcuts',     label: 'Shortcuts' },
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

          <div className="settings-auth-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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

          <div className="settings-auth-3col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
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

          <div className="settings-auth-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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

function normalizeRegistryProvider(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'ghcr' || raw === 'ghcr.io') return 'ghcr.io'
  return 'docker.io'
}

function RegistrySection() {
  const qc = useQueryClient()
  const loaded = useRef(false)
  const [form, setForm] = useState({ defaultProvider: 'docker.io', ghcrToken: '' })
  const [tokenDirty, setTokenDirty] = useState(false)
  const registryProviderOptions = useMemo(() => [
    { value: 'docker.io', label: 'Docker Hub', icon: <RegistryProviderIcon provider="docker.io" /> },
    { value: 'ghcr.io', label: 'GHCR', icon: <RegistryProviderIcon provider="ghcr.io" /> },
  ], [])

  const settingsQuery = useQuery({
    queryKey: ['registry-settings'],
    queryFn: async () => {
      const [providerSetting, tokenSetting] = await Promise.all([
        api.getSetting('registry.default_provider'),
        api.getSetting('registry.ghcr_token'),
      ])
      return {
        defaultProvider: normalizeRegistryProvider(providerSetting?.value),
        hasGhcrToken: Boolean(tokenSetting?.value),
      }
    },
    staleTime: 30000,
    retry: false,
  })

  useEffect(() => {
    if (!settingsQuery.data || loaded.current) return
    loaded.current = true
    const timer = setTimeout(() => {
      setForm({
        defaultProvider: settingsQuery.data.defaultProvider,
        ghcrToken: settingsQuery.data.hasGhcrToken ? REDACTED_DISPLAY : '',
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [settingsQuery.data])

  const save = useMutation({
    mutationFn: async () => {
      await api.setSetting('registry.default_provider', form.defaultProvider)
      if (tokenDirty) {
        await api.setSetting('registry.ghcr_token', form.ghcrToken)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['registry-settings'] })
      qc.invalidateQueries({ queryKey: ['setting', 'registry.default_provider'] })
      setTokenDirty(false)
      setForm((current) => ({
        ...current,
        ghcrToken: current.ghcrToken ? REDACTED_DISPLAY : '',
      }))
      toast.success({ title: 'Registry settings saved' })
    },
    onError: (e) => toast.error({ title: e.message }),
  })

  return (
    <SectionShell>
      {settingsQuery.isLoading ? (
        <div className="skeleton" style={{ height: 150, borderRadius: 12, maxWidth: 620 }} />
      ) : settingsQuery.isError ? (
        <p className="mono" style={{ marginTop: 8, color: 'var(--stopped)', fontSize: 12.5 }}>
          {settingsQuery.error?.message || 'Failed to load registry settings'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 14, maxWidth: 620 }}>
          <div>
            <label className="input-label" htmlFor="registry-provider">Default provider</label>
            <CustomSelect
              value={form.defaultProvider}
              onChange={(value) => setForm((current) => ({ ...current, defaultProvider: normalizeRegistryProvider(value) }))}
              options={registryProviderOptions}
              controlHeight={34}
              style={{ width: 190 }}
            />
          </div>

          <div>
            <label className="input-label" htmlFor="registry-ghcr-token">GHCR token</label>
            <input
              id="registry-ghcr-token"
              className="input"
              type="password"
              value={form.ghcrToken}
              onFocus={() => {
                setForm((current) => (
                  current.ghcrToken === REDACTED_DISPLAY
                    ? { ...current, ghcrToken: '' }
                    : current
                ))
              }}
              onChange={(e) => {
                setTokenDirty(true)
                setForm((current) => ({ ...current, ghcrToken: e.target.value }))
              }}
              placeholder="Optional GitHub token for GHCR search"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-accent" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save Registry'}
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

function SecuritySection() {
  const passkeysQuery = useQuery({
    queryKey: ['my-passkeys'],
    queryFn: () => api.getMyPasskeys(),
    staleTime: 15000,
  })
  const [showModal, setShowModal] = useState(false)
  const passkeys = passkeysQuery.data?.passkeys || []

  async function revoke(id) {
    try {
      await api.deleteMyPasskey(id)
      passkeysQuery.refetch()
    } catch (err) {
      toast.error({ title: err.message })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
      <SectionShell>
        <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px' }}>Passkeys</p>
        {passkeys.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 16px' }}>No passkeys registered. Add one to sign in without a password.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            {passkeys.map(pk => (
              <div key={pk.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{pk.name || 'Unnamed'}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 12 }}>
                    Created {pk.created_at ? new Date(pk.created_at).toLocaleDateString() : '—'}
                    {pk.last_used_at && ` · Last used ${new Date(pk.last_used_at).toLocaleDateString()}`}
                  </span>
                </div>
                <button className="btn" onClick={() => revoke(pk.id)} style={{ fontSize: 11, height: 28, padding: '0 10px', color: 'var(--stopped)' }}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="btn-accent" onClick={() => setShowModal(true)}>
          <Plus size={14} /> Add passkey
        </button>
      </SectionShell>

      {showModal && <AddPasskeyModal existingCount={passkeys.length} onClose={() => setShowModal(false)} onDone={() => { setShowModal(false); passkeysQuery.refetch() }} />}
    </div>
  )
}

function AddPasskeyModal({ existingCount, onClose, onDone }) {
  const [step, setStep] = useState(existingCount > 0 ? 'confirm' : 'form') // confirm | form | registering
  const [name, setName] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setStep('registering')
    try {
      const { session_id, options } = await api.registerPasskeyBegin(name)
      const cred = await navigator.credentials.create(prepareCreationOptions(options))
      const parsed = parseCredential(cred)
      await api.registerPasskeyFinish(session_id, parsed, name)
      onDone()
    } catch (err) {
      toast.error({ title: err.message })
      setStep('form')
    }
  }

  return (
    <Modal title="Add Passkey" size="sm" onClose={onClose}>
      {step === 'confirm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>This device already has a passkey</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              You have {existingCount} passkey{existingCount > 1 ? 's' : ''} registered. Adding another from the same device or browser will overwrite the existing one in your keychain, making the old one unusable.
            </p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-accent" onClick={() => setStep('form')}>Continue anyway</button>
          </div>
        </div>
      )}
      {step === 'registering' && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Follow your browser prompt</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Use Touch ID, Face ID, Windows Hello, or your security key.</p>
          <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto' }} />
        </div>
      )}
      {step === 'form' && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="input-label" htmlFor="pk-name">Passkey name</label>
            <input id="pk-name" className="input" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. YubiKey, MacBook Touch ID" autoFocus required />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-accent">Register passkey</button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function NotificationSection() {
  const { data: meData } = useQuery({ queryKey: ['current-user'], queryFn: () => api.getCurrentUser(), staleTime: 60000 })
  const userID = meData?.user?.id

  const smtpQuery = useQuery({
    queryKey: ['smtp-settings'],
    queryFn: async () => {
      const keys = ['smtp.host', 'smtp.port', 'smtp.username', 'smtp.password', 'smtp.from', 'smtp.use_tls']
      const results = {}
      for (const k of keys) {
        try { results[k] = (await api.getSetting(k))?.value || '' } catch { results[k] = '' }
      }
      return results
    },
    staleTime: 30000,
  })

  const notifQuery = useQuery({
    queryKey: ['notif-prefs', userID],
    queryFn: () => api.getNotificationPrefs(userID),
    enabled: Boolean(userID),
    staleTime: 30000,
  })

  const [smtp, setSmtp] = useState({ host: '', port: '587', username: '', password: '', from: '', use_tls: true })
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [smtpPasswordFocused, setSmtpPasswordFocused] = useState(false)
  const loadedSmtp = useRef(false)
  const loadedTestEmail = useRef(false)
  useEffect(() => {
    if (!smtpQuery.data || loadedSmtp.current) return
    const d = smtpQuery.data
    setSmtp({ host: d['smtp.host'] || '', port: d['smtp.port'] || '587', username: d['smtp.username'] || '', password: '', from: d['smtp.from'] || '', use_tls: d['smtp.use_tls'] !== 'false' })
    loadedSmtp.current = true
  }, [smtpQuery.data])
  useEffect(() => {
    if (loadedTestEmail.current || meData?.user?.email === undefined) return
    loadedTestEmail.current = true
    const timer = setTimeout(() => {
      setTestEmail(meData.user.email || '')
    }, 0)
    return () => clearTimeout(timer)
  }, [meData?.user?.email])

  async function saveSmtp() {
    setSmtpSaving(true)
    try {
      await api.setSetting('smtp.host', smtp.host)
      await api.setSetting('smtp.port', smtp.port)
      await api.setSetting('smtp.username', smtp.username)
      if (smtp.password) await api.setSetting('smtp.password', smtp.password)
      await api.setSetting('smtp.from', smtp.from)
      await api.setSetting('smtp.use_tls', smtp.use_tls ? 'true' : 'false')
      toast.success({ title: 'SMTP settings saved' })
    } catch (err) {
      toast.error({ title: err.message })
    } finally {
      setSmtpSaving(false)
    }
  }

  async function testSmtp() {
    if (!testEmail.trim()) { toast.error({ title: 'Enter a test email address' }); return }
    setSmtpTesting(true)
    try {
      await api.testSMTP(testEmail.trim())
      toast.success({ title: `Test email sent to ${testEmail}` })
    } catch (err) {
      toast.error({ title: err.message })
    } finally {
      setSmtpTesting(false)
    }
  }

  const [notifs, setNotifs] = useState({ login_alert: false, container_update: false, suspicious_activity: false })
  useEffect(() => {
    if (notifQuery.data?.preferences) {
      setNotifs({
        login_alert: notifQuery.data.preferences.login_alert === 'true',
        container_update: notifQuery.data.preferences.container_update === 'true',
        suspicious_activity: notifQuery.data.preferences.suspicious_activity === 'true',
      })
    }
  }, [notifQuery.data])

  async function toggleNotif(key, value) {
    const next = { ...notifs, [key]: value }
    setNotifs(next)
    try {
      await api.setNotificationPrefs(userID, next)
    } catch (err) {
      toast.error({ title: err.message })
      setNotifs(notifs)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 760 }}>
      {/* SMTP */}
      <SectionShell>
        <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px' }}>Email (SMTP)</p>
        <div className="settings-auth-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="input-label" htmlFor="smtp-host">SMTP Host</label>
            <input id="smtp-host" className="input" value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))} placeholder="smtp.example.com" />
          </div>
          <div>
            <label className="input-label" htmlFor="smtp-port">Port</label>
            <input id="smtp-port" className="input" value={smtp.port} onChange={e => setSmtp(s => ({ ...s, port: e.target.value }))} placeholder="587" />
          </div>
          <div>
            <label className="input-label" htmlFor="smtp-user">Username</label>
            <input id="smtp-user" className="input" value={smtp.username} onChange={e => setSmtp(s => ({ ...s, username: e.target.value }))} placeholder="user@example.com" />
          </div>
          <div>
            <label className="input-label" htmlFor="smtp-pass">Password</label>
            <input id="smtp-pass" className="input" type="password" value={smtpPasswordFocused ? smtp.password : (smtp.password ? REDACTED_DISPLAY : '')}
              onFocus={() => { setSmtpPasswordFocused(true); setSmtp(s => ({ ...s, password: '' })) }}
              onChange={e => setSmtp(s => ({ ...s, password: e.target.value }))} placeholder="••••••••" />
          </div>
          <div>
            <label className="input-label" htmlFor="smtp-from">From Address</label>
            <input id="smtp-from" className="input" value={smtp.from} onChange={e => setSmtp(s => ({ ...s, from: e.target.value }))} placeholder="eve@example.com" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 20 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>Use TLS</span>
            <IOSToggle checked={smtp.use_tls} onChange={v => setSmtp(s => ({ ...s, use_tls: v }))} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14, gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input mono"
              placeholder="test@email.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              style={{ width: 180, fontSize: 12, height: 34 }}
            />
            <button className="btn" onClick={testSmtp} disabled={smtpTesting} style={{ height: 34, fontSize: 12 }}>
              {smtpTesting ? <><span style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> Testing...</> : 'Test SMTP'}
            </button>
          </div>
          <button className="btn-accent" onClick={saveSmtp} disabled={smtpSaving}>
            {smtpSaving ? 'Saving…' : 'Save SMTP'}
          </button>
        </div>
      </SectionShell>

      {/* Notification Preferences */}
      <SectionShell>
        <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px' }}>Notification Preferences</p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          Choose which events you want to receive email notifications for.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { key: 'login_alert', label: 'Login alerts', desc: 'Get notified when someone logs into your account' },
            { key: 'container_update', label: 'Container updates', desc: 'Get notified when container images have updates available' },
            { key: 'suspicious_activity', label: 'Suspicious activity', desc: 'Get notified about unusual or suspicious actions' },
          ].map(({ key, label, desc }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 3px', color: 'var(--text-primary)' }}>{label}</p>
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0 }}>{desc}</p>
              </div>
              <IOSToggle checked={notifs[key]} onChange={v => toggleNotif(key, v)} />
            </div>
          ))}
        </div>
      </SectionShell>
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
        {activeTab === 'security' && <SecuritySection />}
        {activeTab === 'registry' && <RegistrySection />}
        {activeTab === 'notifications' && <NotificationSection />}
        {activeTab === 'shortcuts' && <ShortcutsSection />}
      </div>
    </div>
  )
}
