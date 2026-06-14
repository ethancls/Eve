import { useEffect, useState } from 'react'
import { Eye, EyeOff, ArrowLeft, Check, Fingerprint } from 'lucide-react'
import { authLogin, authOIDCConfig, authForgotPassword, authPasskeysLoginBegin, authPasskeysLoginFinish } from '../api/client'
import { prepareRequestOptions, parseCredential } from '../utils/webauthn'
import Tooltip from '../components/Tooltip'

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetLogin, setResetLogin] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [oidcEnabled, setOIDCEnabled] = useState(false)
  const [localPasswordEnabled, setLocalPasswordEnabled] = useState(true)
  const [oidcLoading, setOIDCLoading] = useState(true)
  const canAutoFocus = typeof window !== 'undefined' && !(window.matchMedia?.('(pointer: coarse)').matches)

  useEffect(() => {
    const oidcError = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('auth_error') || ''
      : ''
    if (oidcError) {
      setError(oidcError)
      window.history.replaceState({}, '', window.location.pathname)
    }
    let cancelled = false
    authOIDCConfig()
      .then((cfg) => {
        if (!cancelled) {
          setOIDCEnabled(Boolean(cfg?.enabled))
          setLocalPasswordEnabled(cfg?.local_password_enabled !== false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOIDCEnabled(false)
          setLocalPasswordEnabled(true)
        }
      })
      .finally(() => {
        if (!cancelled) setOIDCLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!localPasswordEnabled) return
    setError('')
    setLoading(true)
    try {
      await authLogin(username, password)
      onLogin()
    } catch (err) {
      setError(err?.message || 'Connection failed — is the server running?')
    } finally {
      setLoading(false)
    }
  }

  async function handlePasskeyLogin() {
    setPasskeyLoading(true)
    setError('')
    try {
      const { session_id, options } = await authPasskeysLoginBegin(username.trim() || undefined)
      const cred = await navigator.credentials.get(prepareRequestOptions(options))
      const parsed = parseCredential(cred)
      await authPasskeysLoginFinish(session_id, parsed)
      onLogin()
    } catch (err) {
      if (err.name !== 'NotAllowedError') setError(err?.message || 'Passkey login failed')
    } finally {
      setPasskeyLoading(false)
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    if (!resetLogin.trim()) return
    setLoading(true)
    try {
      await authForgotPassword(resetLogin.trim())
      setResetSent(true)
    } catch { /* always show success */ setResetSent(true) }
    finally { setLoading(false) }
  }

  function handleOIDCLogin() {
    if (typeof window !== 'undefined') {
      window.location.assign('/auth/oidc/start')
    }
  }

  return (
    <div className="login-page">
      <div style={{
        width: 'min(360px, calc(100vw - 32px))',
        display: 'flex', flexDirection: 'column', gap: 24,
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <img src="/eve.svg" width={52} height={52} alt="Eve" />
          <p style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 24, color: 'var(--text-primary)', margin: 0 }}>
            Eve
          </p>
        </div>

        {showReset ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {resetSent ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Check size={36} style={{ color: 'var(--running)', marginBottom: 12 }} />
                <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 15, margin: '0 0 6px' }}>Check your email</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.5 }}>
                  If an account with that login exists and has an email configured, we sent a reset link.
                </p>
                <button type="button" onClick={() => { setShowReset(false); setResetSent(false) }}
                  className="btn-ghost" style={{ justifyContent: 'center', width: '100%' }}>
                  <ArrowLeft size={14} /> Back to login
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <button type="button" onClick={() => setShowReset(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, alignSelf: 'flex-start' }}>
                  <ArrowLeft size={12} /> Back to login
                </button>
                <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 15, margin: 0 }}>Reset password</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>Enter your login and we'll send you a reset link by email.</p>
                <input className="input" value={resetLogin} onChange={e => setResetLogin(e.target.value)}
                  placeholder="Your login" autoFocus required
                  style={{ background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text-primary)', fontSize: 14 }} />
                <button type="submit" disabled={loading} className="btn-accent" style={{ justifyContent: 'center' }}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* OIDC + Passkey buttons above login fields */}
          {(oidcEnabled || true) && (
            <div style={{ display: 'grid', gridTemplateColumns: oidcEnabled ? '1fr 1fr' : '1fr', gap: 8 }}>
              {oidcEnabled && !oidcLoading && (
                <button type="button" className="btn-ghost" style={{ justifyContent: 'center', gap: 8 }}
                  onClick={handleOIDCLogin}>
                  <span style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <img src="/images/openid.png" alt="" aria-hidden="true" style={{ width: 14, height: 14, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
                  </span>
                  Sign in with OIDC
                </button>
              )}
              <button type="button" className="btn-ghost" style={{ justifyContent: 'center', gap: 8 }}
                onClick={handlePasskeyLogin} disabled={passkeyLoading}>
                <Fingerprint size={18} />
                {passkeyLoading ? 'Checking…' : 'Sign in with passkey'}
              </button>
            </div>
          )}

          {localPasswordEnabled ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="login-username" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Username
                </label>
                <input
                  className="login-input"
                  id="login-username"
                  name="username"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  spellCheck={false}
                  autoFocus={canAutoFocus}
                  required
                  style={{
                    background: 'var(--card-2)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '10px 14px',
                    color: 'var(--text-primary)', fontSize: 14,
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="login-password" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="login-input"
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    style={{
                      width: '100%',
                      background: 'var(--card-2)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '10px 38px 10px 14px',
                      color: 'var(--text-primary)', fontSize: 14,
                    }}
                  />
                  <Tooltip
                    label={showPassword ? 'Hide password' : 'Show password'}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  >
                    <button
                      className="login-password-toggle"
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      style={{
                        border: 'none',
                        background: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </Tooltip>
                </div>
              </div>
            </>
          ) : null}

          {error && (
            <p aria-live="polite" style={{ fontSize: 13, color: '#ff4444', margin: 0, textAlign: 'center' }}>{error}</p>
          )}

          {localPasswordEnabled && (
            <button
              type="submit"
              disabled={loading}
              className="btn-accent"
              style={{ justifyContent: 'center', marginTop: 4, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          )}

          {localPasswordEnabled && (
            <button type="button" onClick={() => setShowReset(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, marginTop: 2, textAlign: 'center' }}>
              Forgot password?
            </button>
          )}

        </form>
        )}
      </div>
    </div>
  )
}
