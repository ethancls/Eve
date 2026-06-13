export function normalizeRole(role) {
  const v = String(role || '').trim().toLowerCase()
  if (v === 'owner') return 'owner'
  if (v === 'admin' || v === 'administrator') return 'administrator'
  return 'user'
}

export function canAccessUsers(role) {
  const normalized = normalizeRole(role)
  return normalized === 'owner' || normalized === 'administrator'
}

export function canReadAuthSettings(role) {
  return canAccessUsers(role)
}

export function canWriteAuthSettings(role) {
  return canAccessUsers(role)
}

export function canManageUserTarget(actorRole, targetRole) {
  const actor = normalizeRole(actorRole)
  const target = normalizeRole(targetRole)
  if (actor === 'owner') return true
  if (actor === 'administrator') return target !== 'owner'
  return false
}

export function canDeleteUserTarget(actorRole, targetRole, isSelf = false) {
  if (isSelf) return false
  return canManageUserTarget(actorRole, targetRole)
}
