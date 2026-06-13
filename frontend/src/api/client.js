const BASE = '/api'

let _onUnauthorized = null
export function setOnUnauthorized(fn) { _onUnauthorized = fn }

function cleanError(raw) {
  // Strip Docker daemon prefix
  let s = raw.replace(/^Error response from daemon:\s*/i, '')
  // Strip "container run error:" prefix
  s = s.replace(/^container run error:\s*/i, '')
  // Extract readable part from "remove X: volume is in use - [hash]"
  s = s.replace(/^remove\s+(\S+):\s*/, (_, name) => `Volume ${name}: `)
  // Collapse whitespace
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

export async function authMe() {
  const res = await fetch('/auth/me')
  if (!res.ok) return null
  return res.json().catch(() => null)
}

function instanceAction(name, action, payload = {}) {
  return request('POST', `/instances/${name}/actions/${action}`, payload)
}

export const api = {
  getInstances: () => request('GET', '/instances'),
  getInstance: (name) => request('GET', `/instances/${name}`),
  generateSshPassword: (name, body = {}) => request('POST', `/instances/${name}/ssh-password`, body),
  getSshPasswordStatus: (name, username = 'ubuntu') => request('GET', `/instances/${name}/ssh-password/status?username=${encodeURIComponent(username)}`),
  disableSshPassword: (name, body = {}) => request('POST', `/instances/${name}/ssh-password/disable`, body),
  getInstanceUpdates: (name) => request('GET', `/instances/${name}/updates`),
  runInstanceUpdates: (name, body = {}) => request('POST', `/instances/${name}/updates/run`, body),
  getUpdates: () => request('GET', '/updates'),
  startInstance: (name) => instanceAction(name, 'start'),
  stopInstance: (name) => instanceAction(name, 'stop'),
  suspendInstance: (name) => instanceAction(name, 'suspend'),
  restartInstance: (name) => instanceAction(name, 'restart'),
  recoverInstance: (name) => instanceAction(name, 'recover'),
  deleteInstance: (name, purge = true) => instanceAction(name, 'delete', { purge }),
  cloneInstance: (name, newName) => request('POST', `/instances/${name}/clone`, newName ? { name: newName } : {}),
  launchInstance: (body) => request('POST', '/instances', body),
  getSnapshots: (name) => request('GET', `/instances/${name}/snapshots`),
  createSnapshot: (name, snapName, comment) => request('POST', `/instances/${name}/snapshots`, { name: snapName, comment }),
  getAllSnapshots: () => request('GET', '/snapshots'),
  restoreSnapshot: (instance, snapshot, destructive = false) => request('POST', `/snapshots/${instance}/${snapshot}/restore`, { destructive }),
  deleteSnapshot: (instance, snapshot) => request('DELETE', `/snapshots/${instance}/${snapshot}`),
  getHistory: (name) => request('GET', `/containers/${encodeURIComponent(name)}/history`),
  getActivity: (limit = 100) => request('GET', `/activity?limit=${limit}`),
  getStats: () => request('GET', '/stats'),
  getNetworks: () => request('GET', '/networks'),
  getImages: (q = '') => request('GET', `/images${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getContainerSystem: (ensure = false) => request('GET', `/container/system${ensure ? '?ensure=true' : ''}`),
  ensureContainerSystem: () => request('POST', '/container/system'),
  getContainers: () => request('GET', '/containers'),
  getContainer: (name) => request('GET', `/containers/${encodeURIComponent(name)}`),
  createContainer: (body) => request('POST', '/containers', body),
  containerAction: (name, action) => request('POST', `/containers/${encodeURIComponent(name)}/actions/${encodeURIComponent(action)}`),
  getContainerLogs: (name) => request('GET', `/containers/${encodeURIComponent(name)}/logs`),
  getContainerStats: (name) => request('GET', `/containers/${encodeURIComponent(name)}/stats`),
  getLocalImages: () => request('GET', '/images/local'),
  imageAction: (body) => request('POST', '/images/local', body),
  searchRegistry: (provider, q) => request('GET', `/registry/search?provider=${encodeURIComponent(provider)}&q=${encodeURIComponent(q)}`),
  checkImageUpdate: (image) => request('GET', `/images/check-update?image=${encodeURIComponent(image)}`),
  getRegistryTags: (provider, image) => request('GET', `/registry/tags?provider=${encodeURIComponent(provider)}&image=${encodeURIComponent(image)}`),
  getRegistries: () => request('GET', '/registries'),
  getMachines: () => request('GET', '/machines'),
  createMachine: (body) => request('POST', '/machines', body),
  getMachine: (name) => request('GET', `/machines/${encodeURIComponent(name)}`),
  machineAction: (name, action) => request('POST', `/machines/${encodeURIComponent(name)}/actions`, { action }),
  getMachineLogs: (name) => request('GET', `/machines/${encodeURIComponent(name)}/logs`),
  getVolumes: () => request('GET', '/volumes'),
  deleteVolume: (name) => request('DELETE', `/volumes/${encodeURIComponent(name)}`),
  getBuilder: () => request('GET', '/builder'),
  builderAction: (action) => request('POST', '/builder', { action }),
  getContainerProperties: () => request('GET', '/settings/container-properties'),
  getSettings: () => request('GET', '/settings'),
  getSetting: (key) => request('GET', `/settings/${encodeURIComponent(key)}`),
  setSetting: (key, value) => request('PUT', `/settings/${encodeURIComponent(key)}`, { value }),
  getAliases: () => request('GET', '/aliases'),
  createAlias: (definition, name = '', noMapWorkingDirectory = false) => request('POST', '/aliases', {
    definition,
    name: name || null,
    no_map_working_directory: Boolean(noMapWorkingDirectory),
  }),
  deleteAlias: (name) => request('DELETE', `/aliases/${encodeURIComponent(name)}`),
  preferAlias: (name) => request('POST', '/aliases/prefer', { name }),
  execInstance: (name, command, opts = {}) => request('POST', `/instances/${name}/exec`, { command, ...opts }),
  getHealth: () => request('GET', '/health'),
  getVersion: () => request('GET', '/system/version'),
  getHostInfo: () => request('GET', '/system/host'),
  systemPrune: () => request('POST', '/system/prune'),
  getProjects: () => request('GET', '/projects'),
  getProjectCompose: (name) => request('GET', `/projects/${encodeURIComponent(name)}/compose`),
  updateProjectCompose: (name, body) => request('PUT', `/projects/${encodeURIComponent(name)}/compose`, body),
  projectAction: (name, action) => request('POST', `/projects/${encodeURIComponent(name)}/action/${action}`),
  fsBrowse: (path) => request('GET', `/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  fsCheckURL: (url) => request('GET', `/fs/check-url?url=${encodeURIComponent(url)}`),
  getTemplates: () => request('GET', '/templates'),
  createTemplate: (body) => request('POST', '/templates', body),
  deleteTemplate: (id) => request('DELETE', `/templates/${encodeURIComponent(id)}`),
  getUsers: () => request('GET', '/users'),
  getCurrentUser: () => request('GET', '/users/me'),
  createUser: (body) => request('POST', '/users', body),
  updateUser: (id, body) => request('PUT', `/users/${encodeURIComponent(id)}`, body),
  deleteUser: (id) => request('DELETE', `/users/${encodeURIComponent(id)}`),
  setUserPassword: (id, password) => request('PUT', `/users/${encodeURIComponent(id)}/password`, { password }),
  updateCurrentUser: (body) => request('PUT', '/users/me', body),
  changeCurrentPassword: (currentPassword, newPassword) => request('PUT', '/users/me/password', {
    current_password: currentPassword,
    new_password: newPassword,
  }),
  getAuthSettings: () => request('GET', '/app/auth'),
  updateAuthSettings: (body) => request('PUT', '/app/auth', body),
}
