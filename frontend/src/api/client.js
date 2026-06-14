const BASE = '/api'

let _onUnauthorized = null
export function setOnUnauthorized(fn) { _onUnauthorized = fn }

function cleanError(raw) {
  let s = raw.replace(/^Error response from daemon:\s*/i, '')
  s = s.replace(/^container run error:\s*/i, '')
  s = s.replace(/^remove\s+(\S+):\s*/, (_, name) => `Volume ${name}: `)
  s = s.replace(/\s+/g, ' ').trim()
  return s || raw
}

async function request(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (res.status === 401) {
    if (_onUnauthorized) _onUnauthorized()
    throw new Error('Authentication required')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = data?.detail || data?.error || `${method} ${path} → ${res.status}`
    throw new Error(cleanError(detail))
  }
  return data
}

export async function authLogin(username, password) {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Login failed')
  return data
}

export async function authOIDCConfig() {
  const res = await fetch('/auth/oidc/config')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load OIDC config')
  return data
}

export async function authLogout() {
  await fetch('/auth/logout', { method: 'POST' })
}

export async function authForgotPassword(login) {
  const res = await fetch('/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login }),
  })
  const data = await res.json().catch(() => ({}))
  return data
}

export async function authPasskeysLoginBegin(login) {
  const res = await fetch('/auth/passkeys/login/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(login ? { login } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Passkey login failed')
  return data
}

export async function authPasskeysLoginFinish(sessionID, credential) {
  const res = await fetch('/auth/passkeys/login/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionID, credential }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Passkey login failed')
  return data
}

export async function authResetPassword(token, password) {
  const res = await fetch('/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Reset failed')
  return data
}

export async function authMe() {
  const res = await fetch('/auth/me')
  if (!res.ok) return null
  return res.json().catch(() => null)
}

export const api = {
  // Health / system
  getHealth:       () => request('GET', '/health'),
  getVersion:      () => request('GET', '/system/version'),
  getHostInfo:     () => request('GET', '/system/host'),
  getStats:        () => request('GET', '/stats'),

  // Containers
  getContainers:   () => request('GET', '/containers'),
  getContainer:    (name) => request('GET', `/containers/${encodeURIComponent(name)}`),
  createContainer: (body) => request('POST', '/containers', body),
  containerAction: (name, action) => request('POST', `/containers/${encodeURIComponent(name)}/actions/${encodeURIComponent(action)}`),
  getContainerLogs:  (name) => request('GET', `/containers/${encodeURIComponent(name)}/logs`),
  getContainerStats: (name) => request('GET', `/containers/${encodeURIComponent(name)}/stats`),
  getHistory:        (name) => request('GET', `/containers/${encodeURIComponent(name)}/history`),
  getContainerSystem: (ensure = false) => request('GET', `/container/system${ensure ? '?ensure=true' : ''}`),

  // Images
  getLocalImages:    () => request('GET', '/images/local'),
  imageAction:       (body) => request('POST', '/images/local', body),
  getImages:         (q = '') => request('GET', `/images${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  searchRegistry:    (provider, q) => request('GET', `/registry/search?provider=${encodeURIComponent(provider)}&q=${encodeURIComponent(q)}`),
  checkImageUpdate:  (image) => request('GET', `/images/check-update?image=${encodeURIComponent(image)}`),

  // Networks
  getNetworks: () => request('GET', '/networks'),

  // Volumes
  getVolumes:   () => request('GET', '/volumes'),
  deleteVolume: (name) => request('DELETE', `/volumes/${encodeURIComponent(name)}`),

  // Projects
  getProjects:          () => request('GET', '/projects'),
  getProjectCompose:    (name) => request('GET', `/projects/${encodeURIComponent(name)}/compose`),
  updateProjectCompose: (name, body) => request('PUT', `/projects/${encodeURIComponent(name)}/compose`, body),
  projectAction:        (name, action) => request('POST', `/projects/${encodeURIComponent(name)}/action/${action}`),

  // Users
  getUsers:         () => request('GET', '/users'),
  getUserDetails:   (id) => request('GET', `/users/${encodeURIComponent(id)}/details`),
  getCurrentUser: () => request('GET', '/users/me'),
  createUser:     (body) => request('POST', '/users', body),
  updateUser:     (id, body) => request('PUT', `/users/${encodeURIComponent(id)}`, body),
  deleteUser:     (id) => request('DELETE', `/users/${encodeURIComponent(id)}`),
  setUserPassword:(id, password) => request('PUT', `/users/${encodeURIComponent(id)}/password`, { password }),

  // Settings
  getSettings:       () => request('GET', '/settings'),
  getSetting:        (key) => request('GET', `/settings/${encodeURIComponent(key)}`),
  setSetting:        (key, value) => request('PUT', `/settings/${encodeURIComponent(key)}`, { value }),
  getAuthSettings:   () => request('GET', '/app/auth'),
  updateAuthSettings:(body) => request('PUT', '/app/auth', body),

  // Legacy (still used by WebSocket hook for live stats enrichment)
  getInstances: () => request('GET', '/instances'),

  // Activity
  getActivity: (params = {}) => {
    const qs = new URLSearchParams()
    if (params.limit) qs.set('limit', params.limit)
    if (params.offset) qs.set('offset', params.offset)
    if (params.action) qs.set('action', params.action)
    if (params.vm_name) qs.set('vm_name', params.vm_name)
    if (params.status) qs.set('status', params.status)
    if (params.user_id) qs.set('user_id', params.user_id)
    if (params.since) qs.set('since', params.since)
    if (params.until) qs.set('until', params.until)
    const q = qs.toString()
    return request('GET', `/activity${q ? '?' + q : ''}`)
  },

  // Passkeys
  getMyPasskeys:       () => request('GET', '/users/me/passkeys'),
  registerPasskeyBegin: (name) => request('POST', '/users/me/passkeys/register/begin', { name }),
  registerPasskeyFinish:(sessionId, credential, name) => request('POST', '/users/me/passkeys/register/finish', { session_id: sessionId, credential, name }),
  deleteMyPasskey:     (id) => request('DELETE', `/users/me/passkeys/${encodeURIComponent(id)}`),

  // Notifications
  getNotificationPrefs: (userId) => request('GET', `/settings/notifications/${encodeURIComponent(userId)}`),
  setNotificationPrefs: (userId, body) => request('PUT', `/settings/notifications/${encodeURIComponent(userId)}`, body),
  testSMTP: (to) => request('POST', '/settings/test-smtp', { to }),
}
