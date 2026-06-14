import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, KeyRound, Pencil, Trash2, ChevronsUpDown, ChevronUp, ChevronDown, X, Eye } from 'lucide-react'
import { toast } from '../toast'
import { api } from '../api/client'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import CustomSelect from '../components/CustomSelect'
import TableToolbar from '../components/TableToolbar'
import { useColumnVisibility } from '../hooks/useColumnVisibility'
import Tooltip from '../components/Tooltip'
import PermissionNotice from '../components/PermissionNotice'
import ForbiddenActionModal from '../components/ForbiddenActionModal'
import InstancesCheckbox from '../components/instances/InstancesCheckbox'
import { SkeletonTable } from '../components/Skeletons'
import {
  normalizeRole,
  canAccessUsers,
  canManageUserTarget,
  canDeleteUserTarget,
} from '../utils/rbac'

const COLUMNS = [
  { key: 'login', label: 'Login' },
  { key: 'email', label: 'Email' },
  { key: 'name', label: 'Name' },
  { key: 'auth', label: 'Auth' },
  { key: 'role', label: 'Role' },
  { key: 'last_login', label: 'Last Login' },
  { key: 'created_at', label: 'Created' },
  { key: null, label: 'Actions' },
]

const AUTH_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'local', label: 'Local' },
  { value: 'oidc', label: 'OIDC' },
]

const ROLE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'owner', label: 'Owner' },
  { key: 'administrator', label: 'Administrator' },
  { key: 'user', label: 'User' },
]

function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function authType(user) {
  const parts = authMethods(user)
  if (parts.length === 0) return '—'
  return parts.join(' + ')
}

function authMethods(user) {
  const parts = []
  if (user.has_password) parts.push('Local')
  if (user.oidc_issuer && user.oidc_subject) parts.push('OIDC')
  return parts
}

function authTone(method) {
  if (method === 'Local') {
    return {
      color: '#22c55e',
      background: 'rgba(34, 197, 94, 0.12)',
      border: 'rgba(34, 197, 94, 0.28)',
    }
  }
  return {
    color: '#7c9cff',
    background: 'rgba(124, 156, 255, 0.13)',
    border: 'rgba(124, 156, 255, 0.28)',
  }
}

function AuthBadges({ user }) {
  const methods = authMethods(user)
  if (methods.length === 0) {
    return <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>—</span>
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {methods.map((method) => {
        const tone = authTone(method)
        return (
          <span
            key={method}
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 999,
              padding: '3px 7px',
              border: `1px solid ${tone.border}`,
              background: tone.background,
              color: tone.color,
              fontSize: 10.5,
              fontWeight: 800,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {method}
          </span>
        )
      })}
    </div>
  )
}

function roleColor(role) {
  const v = normalizeRole(role)
  if (v === 'owner') return '#ff9d2d'
  if (v === 'administrator') return 'var(--accent)'
  return 'var(--text-secondary)'
}

function roleLabel(role) {
  const v = normalizeRole(role)
  if (v === 'administrator') return 'Administrator'
  return v.charAt(0).toUpperCase() + v.slice(1)
}

function sortValue(user, key) {
  if (key === 'login') return String(user.login || '').toLowerCase()
  if (key === 'name') return String(user.name || '').toLowerCase()
  if (key === 'email') return String(user.email || '').toLowerCase()
  if (key === 'auth') return authType(user).toLowerCase()
  if (key === 'role') return normalizeRole(user.role)
  if (key === 'last_login') return user.last_login ? new Date(user.last_login).getTime() : 0
  if (key === 'created_at') return user.created_at ? new Date(user.created_at).getTime() : 0
  return ''
}

function UserAvatar({ user, size = 30 }) {
  const [failed, setFailed] = useState(false)
  const avatar = user?.avatar_url || ''

  const fallback = String(user?.name || user?.login || '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <span style={{
      width: size,
      height: size,
      borderRadius: 999,
      overflow: 'hidden',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--card-3)',
      border: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      {avatar && !failed ? (
        <img
          src={avatar}
          alt={user?.login || 'avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1 }}>
          {fallback}
        </span>
      )}
    </span>
  )
}

function SortTh({ col, sort, onSort, centered = false }) {
  const active = sort.key === col.key
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <th
      onClick={() => col.key && onSort(col.key)}
      style={{
        padding: '12px 18px',
        textAlign: centered ? 'center' : 'left',
        fontSize: 10.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        cursor: col.key ? 'pointer' : 'default',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: centered ? 'center' : 'flex-start' }}>
        {col.label}
        {col.key && <Icon size={11} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />}
      </div>
    </th>
  )
}

function ActionBtn({ icon, color, label, onClick, disabled = false }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          border: 'none',
          background: 'transparent',
          color: disabled ? 'var(--text-muted)' : color,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.12s, opacity 0.12s',
          flexShrink: 0,
          opacity: disabled ? 0.35 : 1,
        }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = `color-mix(in srgb, ${color} 12%, transparent)` }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

function UserFormModal({
  title,
  mode,
  initial,
  canAssignAdministrator,
  canAssignOwner,
  onClose,
  onSubmit,
  loading,
}) {
  const [form, setForm] = useState(() => ({
    login: initial?.login || '',
    password: '',
    email: initial?.email || '',
    name: initial?.name || '',
    avatar_url: initial?.avatar_url || '',
    oidc_issuer: initial?.oidc_issuer || '',
    oidc_subject: initial?.oidc_subject || '',
    role: normalizeRole(initial?.role),
  }))
  const [error, setError] = useState('')
  const isOIDCLinkedEdit = mode === 'edit' && Boolean(initial?.oidc_issuer && initial?.oidc_subject)

  const roleOptions = useMemo(() => {
    const base = [{ value: 'user', label: 'User' }]
    if (canAssignAdministrator) base.push({ value: 'administrator', label: 'Administrator' })
    if (canAssignOwner) base.push({ value: 'owner', label: 'Owner' })
    return base
  }, [canAssignAdministrator, canAssignOwner])

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function submit(e) {
    e?.preventDefault()
    setError('')
    try {
      const payload = {
        login: form.login,
        email: form.email,
        name: form.name,
        avatar_url: form.avatar_url,
        oidc_issuer: form.oidc_issuer,
        oidc_subject: form.oidc_subject,
        role: normalizeRole(form.role),
      }
      if (mode === 'create') payload.password = form.password
      await onSubmit(payload)
      onClose()
    } catch (err) {
      setError(err.message || 'Request failed')
    }
  }

  return (
    <Modal
      title={title}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-accent" onClick={submit} disabled={loading}>
            {loading ? 'Saving…' : mode === 'create' ? 'Create user' : 'Save'}
          </button>
        </>
      )}
    >
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        {isOIDCLinkedEdit && (
          <p className="mono" style={{ margin: 0, fontSize: 11.5, color: 'var(--text-secondary)' }}>
            This user is managed by OIDC. Only avatar can be edited here.
          </p>
        )}

        <div>
          <label className="input-label" htmlFor="uf-login">Login</label>
          <input
            id="uf-login"
            className="input"
            value={form.login}
            onChange={(e) => set('login', e.target.value.toLowerCase())}
            placeholder="username"
            autoFocus={!isOIDCLinkedEdit}
            disabled={isOIDCLinkedEdit}
          />
        </div>

        {mode === 'create' && (
          <div>
            <label className="input-label" htmlFor="uf-password">Password</label>
            <input
              id="uf-password"
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder="••••••••"
            />
          </div>
        )}

        <div>
          <label className="input-label" htmlFor="uf-name">Display Name</label>
          <input
            id="uf-name"
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Jane Doe"
            disabled={isOIDCLinkedEdit}
          />
        </div>
        <div>
          <label className="input-label" htmlFor="uf-email">Email</label>
          <input
            id="uf-email"
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="user@example.com"
          />
        </div>

        <div>
          <label className="input-label" htmlFor="uf-role">Role</label>
          <CustomSelect
            id="uf-role"
            value={normalizeRole(form.role)}
            onChange={(v) => set('role', normalizeRole(v))}
            options={roleOptions}
            controlHeight={36}
            disabled={isOIDCLinkedEdit}
          />
        </div>

        <div>
          <label className="input-label" htmlFor="uf-avatar">Avatar URL</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="uf-avatar"
              className="input"
              value={form.avatar_url}
              onChange={(e) => set('avatar_url', e.target.value)}
              placeholder="https://.../avatar.png"
              style={{ flex: 1 }}
            />
            <UserAvatar key={form.avatar_url || ''} user={{ login: form.login || 'user', name: form.name, avatar_url: form.avatar_url }} />
          </div>
        </div>

        <div className="user-form-oidc-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="input-label" htmlFor="uf-oidc-issuer">OIDC Issuer</label>
            <input
              id="uf-oidc-issuer"
              className="input"
              value={form.oidc_issuer}
              onChange={(e) => set('oidc_issuer', e.target.value)}
              placeholder="https://issuer.example"
              disabled={isOIDCLinkedEdit}
            />
          </div>
          <div>
            <label className="input-label" htmlFor="uf-oidc-subject">OIDC Subject</label>
            <input
              id="uf-oidc-subject"
              className="input"
              value={form.oidc_subject}
              onChange={(e) => set('oidc_subject', e.target.value)}
              placeholder="sub_12345"
              disabled={isOIDCLinkedEdit}
            />
          </div>
        </div>

        {error && <p className="mono" style={{ margin: 0, fontSize: 11.5, color: 'var(--stopped)' }}>{error}</p>}
      </form>
    </Modal>
  )
}

function PasswordModal({ user, onClose, onSubmit, loading }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e?.preventDefault()
    setError('')
    try {
      await onSubmit(password)
      onClose()
    } catch (err) {
      setError(err.message || 'Request failed')
    }
  }

  return (
    <Modal
      title={`Set password · ${user.login}`}
      size="sm"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-accent" onClick={submit} disabled={loading || !password}>Update</button>
        </>
      )}
    >
      <form onSubmit={submit}>
        <label className="input-label" htmlFor="pw-new-password">New Password</label>
        <input
          id="pw-new-password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p className="mono" style={{ marginTop: 8, marginBottom: 0, fontSize: 11.5, color: 'var(--stopped)' }}>{error}</p>}
      </form>
    </Modal>
  )
}

export default function Users() {
  const qc = useQueryClient()
  const [sort, setSort] = useState({ key: 'login', dir: 'asc' })
  const [query, setQuery] = useState('')
  const [authFilter, setAuthFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [passwordUser, setPasswordUser] = useState(null)
  const [detailUser, setDetailUser] = useState(null)
  const [deleteUser, setDeleteUser] = useState(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [forbiddenAction, setForbiddenAction] = useState(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const meQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: () => api.getCurrentUser(),
    retry: false,
  })

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.getUsers(),
    enabled: canAccessUsers(normalizeRole(meQuery.data?.user?.role || 'user')),
    retry: false,
  })

  const users = useMemo(() => usersQuery.data?.users || [], [usersQuery.data])
  const me = meQuery.data?.user || null
  const currentRole = normalizeRole(me?.role)
  const canManageUsers = canAccessUsers(currentRole)
  const canAssignAdministrator = currentRole === 'owner' || currentRole === 'administrator'
  const canAssignOwner = currentRole === 'owner'

  useEffect(() => {
    const existing = new Set(users.map((u) => u.id))
    setSelectedIds((prev) => {
      let changed = false
      const next = new Set()
      prev.forEach((id) => {
        if (existing.has(id)) next.add(id)
        else changed = true
      })
      return changed ? next : prev
    })
  }, [users])

  const createMutation = useMutation({
    mutationFn: (payload) => api.createUser(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success({ title: 'User created' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => api.updateUser(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['current-user'] })
      toast.success({ title: 'User updated' })
    },
  })

  const passwordMutation = useMutation({
    mutationFn: ({ id, password }) => api.setUserPassword(id, password),
    onSuccess: () => {
      toast.success({ title: 'Password updated' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteUser(id),
    onSuccess: (_, id) => {
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success({ title: 'User deleted' })
    },
  })

  const loadingAction = createMutation.isPending || updateMutation.isPending || passwordMutation.isPending || deleteMutation.isPending || bulkDeleting
  const { columnConfig, setColumnConfig, visibleColumns } = useColumnVisibility(COLUMNS, 'users_cols_v3')
  const visibleUserColumnIds = useMemo(
    () => new Set(visibleColumns.map((col) => col.key || col.label)),
    [visibleColumns],
  )

  const roleCounts = useMemo(() => ({
    all: users.length,
    owner: users.filter((u) => normalizeRole(u.role) === 'owner').length,
    administrator: users.filter((u) => normalizeRole(u.role) === 'administrator').length,
    user: users.filter((u) => normalizeRole(u.role) === 'user').length,
  }), [users])

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      const hasLocal = Boolean(u.has_password)
      const hasOIDC = Boolean(u.oidc_issuer && u.oidc_subject)
      if (authFilter === 'local' && !hasLocal) return false
      if (authFilter === 'oidc' && !hasOIDC) return false
      if (roleFilter !== 'all' && normalizeRole(u.role) !== roleFilter) return false
      if (!q) return true
      const hay = [
        u.login,
        u.email,
        u.name,
        authType(u),
        roleLabel(u.role),
        u.oidc_issuer,
        u.oidc_subject,
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [users, authFilter, roleFilter, query])

  const sortedUsers = useMemo(() => {
    const list = [...filteredUsers]
    list.sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [filteredUsers, sort])

  const allSelected = sortedUsers.length > 0 && sortedUsers.every((u) => selectedIds.has(u.id))
  const selectedUsers = useMemo(() => sortedUsers.filter((u) => selectedIds.has(u.id)), [sortedUsers, selectedIds])
  const deletableSelectedUsers = useMemo(
    () => selectedUsers.filter((u) => canDeleteUserTarget(currentRole, u.role, u.id === me?.id)),
    [selectedUsers, currentRole, me?.id],
  )

  function toggleSort(key) {
    if (!key) return
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allSelected) {
        const next = new Set(prev)
        sortedUsers.forEach((u) => next.delete(u.id))
        return next
      }
      const next = new Set(prev)
      sortedUsers.forEach((u) => next.add(u.id))
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function denyAction(title, description) {
    setForbiddenAction({ title, description })
  }

  async function handleBulkDelete() {
    if (!deletableSelectedUsers.length) return
    setBulkDeleting(true)
    try {
      const targets = deletableSelectedUsers.map((u) => u.id)
      const results = await Promise.allSettled(targets.map((id) => api.deleteUser(id)))
      const deleted = []
      let failed = 0

      results.forEach((res, idx) => {
        if (res.status === 'fulfilled') deleted.push(targets[idx])
        else failed += 1
      })

      if (deleted.length > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          deleted.forEach((id) => next.delete(id))
          return next
        })
        qc.invalidateQueries({ queryKey: ['users'] })
      }

      if (failed === 0) {
        toast.success({ title: `Deleted ${deleted.length} user${deleted.length > 1 ? 's' : ''}` })
      } else if (deleted.length > 0) {
        toast.error({ title: `${failed} user deletion${failed > 1 ? 's' : ''} failed` })
      } else {
        toast.error({ title: 'Failed to delete selected users' })
      }
    } finally {
      setBulkDeleting(false)
    }
  }

  if (meQuery.isLoading) {
    return (
      <div className="page">
        <div style={{ marginBottom: 24 }}>
          <h1 className="page-title">Users</h1>
        </div>
        <SkeletonTable cols={[{ w: 150 }, { w: 120 }, { w: 90 }, { w: 80 }, { w: 130 }, { w: 130 }, { w: 110 }]} rows={6} hasCheckbox minWidth={1040} />
      </div>
    )
  }

  if (!canManageUsers) {
    return (
      <div className="page">
        <div style={{ marginBottom: 24 }}>
          <h1 className="page-title">Users</h1>
        </div>
        <PermissionNotice
          title="Action Not Permitted"
          description="Administrator or owner role is required to manage users."
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Users</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-accent" onClick={() => setCreateOpen(true)}>
            <Plus size={13} /> New User
          </button>
        </div>
      </div>

      <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div className="instances-state-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 300px' }}>
          {usersQuery.isLoading ? (
            <span className="skeleton" style={{ display: 'inline-block', width: 62, height: 20, borderRadius: 999 }} />
          ) : (
            ROLE_FILTERS.map((role) => (
              <button
                key={role.key}
                type="button"
                onClick={() => setRoleFilter(role.key)}
                className={`filter-pill${roleFilter === role.key ? ' active' : ''}`}
              >
                {role.label}
                <span className="pill-count">{roleCounts[role.key] ?? 0}</span>
              </button>
            ))
          )}
        </div>
        <div className="instances-controls-right" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto', minWidth: 0 }}>
          <TableToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder="Search users..."
            columnConfig={columnConfig}
            setColumnConfig={setColumnConfig}
            style={{ width: 'clamp(300px, 34vw, 460px)', flex: '0 1 460px' }}
          >
            <CustomSelect
              value={authFilter}
              onChange={setAuthFilter}
              options={AUTH_FILTER_OPTIONS}
              controlHeight={30}
              style={{ minWidth: 106, width: 106, flex: '0 0 106px' }}
            />
          </TableToolbar>
        </div>
      </div>

      {selectedUsers.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--card-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)',
          padding: '10px 16px',
          marginBottom: 12,
          flexWrap: 'wrap',
        }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
            {selectedUsers.length} user{selectedUsers.length > 1 ? 's' : ''} selected
          </span>
          <button
            className="btn-danger"
            onClick={() => {
              if (deletableSelectedUsers.length === 0) {
                denyAction('Action Not Permitted', 'Your role does not allow deleting the selected users.')
                return
              }
              setConfirmBulkDelete(true)
            }}
            disabled={loadingAction}
          >
            <Trash2 size={12} /> Delete selected
          </button>
          <button className="btn-ghost" onClick={clearSelection} disabled={loadingAction}>
            <X size={12} /> Clear
          </button>
        </div>
      )}

      {usersQuery.isLoading ? (
        <SkeletonTable cols={[{ w: 150 }, { w: 120 }, { w: 90 }, { w: 80 }, { w: 130 }, { w: 130 }, { w: 110 }]} rows={6} hasCheckbox minWidth={1040} />
      ) : usersQuery.isError ? (
        <div className="card">
          <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--stopped)' }}>
            {usersQuery.error?.message || 'Failed to load users'}
          </p>
        </div>
      ) : (
        <div className="instances-table-shell" style={{ background: 'var(--card-1)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', overflow: 'visible' }}>
          <div className="instances-table-scroll no-scrollbar" style={{ overflowX: 'auto', overflowY: 'visible' }}>
            <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 10px 12px 14px', width: 40 }}>
                    <InstancesCheckbox checked={allSelected} onChange={toggleSelectAll} />
                  </th>
                  {visibleColumns.map((col) => (
                    <SortTh key={col.label} col={col} sort={sort} onSort={toggleSort} centered={col.label === 'Actions'} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedUsers.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 1} style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                      No users for current filters.
                    </td>
                  </tr>
                )}
                {sortedUsers.map((u, idx) => {
                  const selected = selectedIds.has(u.id)
                  const isSelf = me?.id === u.id
                  const canManageTarget = canManageUserTarget(currentRole, u.role)
                  const canDeleteTarget = canDeleteUserTarget(currentRole, u.role, isSelf)
                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: idx < sortedUsers.length - 1 ? '1px solid var(--border)' : 'none',
                        transition: 'background 0.1s',
                        background: selected ? 'rgba(111,168,255,0.08)' : 'transparent',
                      }}
                      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.018)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = selected ? 'rgba(111,168,255,0.08)' : 'transparent' }}
                    >
                      <td style={{ padding: '14px 10px 14px 14px' }}>
                        <InstancesCheckbox checked={selected} onChange={() => toggleSelect(u.id)} />
                      </td>

                      {visibleUserColumnIds.has('login') && (
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                            <UserAvatar key={u.avatar_url || ''} user={u} />
                            <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                              {u.login}
                            </span>
                            {isSelf && (
                              <span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
                                you
                              </span>
                            )}
                          </div>
                        </td>
                      )}

                      {visibleUserColumnIds.has('email') && (
                        <td style={{ padding: '14px 18px' }}>
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{u.email || '-'}</span>
                        </td>
                      )}

                      {visibleUserColumnIds.has('name') && (
                        <td style={{ padding: '14px 18px' }}>
                          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{u.name || '—'}</span>
                        </td>
                      )}

                      {visibleUserColumnIds.has('auth') && (
                        <td style={{ padding: '14px 18px' }}>
                          <AuthBadges user={u} />
                        </td>
                      )}

                      {visibleUserColumnIds.has('role') && (
                        <td style={{ padding: '14px 18px' }}>
                          <span className="mono" style={{ fontSize: 11.5, fontWeight: 800, color: roleColor(u.role) }}>{roleLabel(u.role)}</span>
                        </td>
                      )}

                      {visibleUserColumnIds.has('last_login') && (
                        <td style={{ padding: '14px 18px' }}>
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{fmtDate(u.last_login)}</span>
                        </td>
                      )}

                      {visibleUserColumnIds.has('created_at') && (
                        <td style={{ padding: '14px 18px' }}>
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{fmtDate(u.created_at)}</span>
                        </td>
                      )}

                      {visibleUserColumnIds.has('Actions') && (
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                            <ActionBtn
                              label="User details"
                              color="#a78bfa"
                              onClick={() => setDetailUser(u)}
                              icon={<Eye size={14} />}
                            />
                            <ActionBtn
                              label="Edit user"
                              color="#22d3ee"
                              onClick={() => {
                                if (!canManageTarget) {
                                  denyAction('Action Not Permitted', `You cannot edit ${u.login} because of your role.`)
                                  return
                                }
                                setEditUser(u)
                              }}
                              icon={<Pencil size={14} />}
                              disabled={loadingAction}
                            />
                            <ActionBtn
                              label="Set password"
                              color="var(--accent)"
                              onClick={() => {
                                if (!canManageTarget) {
                                  denyAction('Action Not Permitted', `You cannot change password for ${u.login} because of your role.`)
                                  return
                                }
                                setPasswordUser(u)
                              }}
                              icon={<KeyRound size={14} />}
                              disabled={loadingAction}
                            />
                            <ActionBtn
                              label="Delete user"
                              color="var(--stopped)"
                              onClick={() => {
                                if (!canDeleteTarget) {
                                  if (isSelf) {
                                    denyAction('Action Not Permitted', 'You cannot delete your own account.')
                                  } else {
                                    denyAction('Action Not Permitted', `You cannot delete ${u.login} because of your role.`)
                                  }
                                  return
                                }
                                setDeleteUser(u)
                              }}
                              icon={<Trash2 size={14} />}
                              disabled={loadingAction}
                            />
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {createOpen && (
        <UserFormModal
          title="Create User"
          mode="create"
          initial={{ role: 'user' }}
          canAssignAdministrator={canAssignAdministrator}
          canAssignOwner={canAssignOwner}
          loading={loadingAction}
          onClose={() => setCreateOpen(false)}
          onSubmit={(payload) => createMutation.mutateAsync(payload)}
        />
      )}

      {editUser && (
        <UserFormModal
          title={`Edit ${editUser.login}`}
          mode="edit"
          initial={editUser}
          canAssignAdministrator={canAssignAdministrator}
          canAssignOwner={canAssignOwner}
          loading={loadingAction}
          onClose={() => setEditUser(null)}
          onSubmit={(payload) => updateMutation.mutateAsync({ id: editUser.id, payload })}
        />
      )}

      {passwordUser && (
        <PasswordModal
          user={passwordUser}
          loading={loadingAction}
          onClose={() => setPasswordUser(null)}
          onSubmit={(password) => passwordMutation.mutateAsync({ id: passwordUser.id, password })}
        />
      )}

      {deleteUser && (
        <ConfirmModal
          title={`Delete ${deleteUser.login}`}
          description="This account will be permanently removed."
          confirmLabel="Delete"
          confirmValue={deleteUser.login}
          variant="name"
          onClose={() => setDeleteUser(null)}
          onConfirm={() => {
            const canDelete = canDeleteUserTarget(currentRole, deleteUser.role, deleteUser.id === me?.id)
            if (!canDelete) {
              setDeleteUser(null)
              denyAction('Action Not Permitted', `You cannot delete ${deleteUser.login} because of your role.`)
              return Promise.resolve()
            }
            return deleteMutation.mutateAsync(deleteUser.id)
          }}
        />
      )}

      {confirmBulkDelete && (
        <ConfirmModal
          title={`Delete ${deletableSelectedUsers.length} selected user${deletableSelectedUsers.length > 1 ? 's' : ''}`}
          description="Selected accounts will be permanently removed."
          confirmLabel="Delete selected"
          onClose={() => setConfirmBulkDelete(false)}
          onConfirm={handleBulkDelete}
        />
      )}

      {forbiddenAction && (
        <ForbiddenActionModal
          title={forbiddenAction.title}
          description={forbiddenAction.description}
          onClose={() => setForbiddenAction(null)}
        />
      )}

      {detailUser && (
        <UserDetailPanel user={detailUser} onClose={() => setDetailUser(null)} />
      )}
    </div>
  )
}

function UserDetailPanel({ user, onClose }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['user-details', user.id],
    queryFn: () => api.getUserDetails(user.id),
    enabled: Boolean(user?.id),
  })
  const details = data || {}
  const u = details.user || user

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 501, width: 'min(440px, 90vw)', background: 'var(--card-1)', borderLeft: '1px solid var(--border)', overflowY: 'auto', padding: 24, animation: 'slide-in-right 0.2s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{u.login}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}>
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="skeleton" style={{ height: 200, borderRadius: 10 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: 'Login', value: u.login },
              { label: 'Email', value: u.email || '-' },
              { label: 'Name', value: u.name || '—' },
              { label: 'Role', value: u.role, color: u.role === 'owner' ? '#ff9d2d' : u.role === 'administrator' ? 'var(--accent)' : 'var(--text-secondary)' },
              { label: 'Auth methods', value: (details.auth_methods || []).join(', ') || '—' },
              { label: 'Has password', value: u.has_password ? 'Yes' : 'No' },
              { label: 'OIDC linked', value: u.oidc_issuer ? `${u.oidc_issuer}` : 'No' },
              { label: 'Created', value: u.created_at ? new Date(u.created_at).toLocaleString() : '—' },
              { label: 'Last login', value: u.last_login ? new Date(u.last_login).toLocaleString() : '—' },
              { label: 'Updated', value: u.updated_at ? new Date(u.updated_at).toLocaleString() : '—' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>{label}</p>
                <p className="mono" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</p>
              </div>
            ))}

            {details.recent_activity?.length > 0 && (
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>Recent activity</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {details.recent_activity.slice(0, 10).map((a, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{a.action}</span>
                      <span className="mono" style={{ color: a.status === 'ok' ? 'var(--running)' : 'var(--stopped)' }}>{a.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn" onClick={() => { navigate('/users'); onClose() }} style={{ flex: 1, justifyContent: 'center' }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
