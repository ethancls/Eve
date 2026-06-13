import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export default function ShellPanel({
  name,
  isRunning,
  wsBase = '/ws/instances',
  resourceLabel = 'Instance',
  storageKeyPrefix = 'eve-shell-session',
}) {
  const containerRef = useRef(null)
  const termRef      = useRef(null)
  const wsRef        = useRef(null)
  const fitRef       = useRef(null)
  const connectDelayRef = useRef(null)
  const closingRef = useRef(false)
  const [status, setStatus] = useState('connecting') // 'connecting' | 'open' | 'closed' | 'error'
  const [errMsg, setErrMsg] = useState('')
  const storageKey = `${storageKeyPrefix}:${name}`

  function getStoredSessionID() {
    try {
      return window.sessionStorage.getItem(storageKey) || ''
    } catch {
      return ''
    }
  }

  function storeSessionID(id) {
    if (!id) return
    try {
      window.sessionStorage.setItem(storageKey, id)
    } catch {
      // ignore storage errors (private mode / quota / etc.)
    }
  }

  function connect() {
    if (!containerRef.current) return
    setStatus('connecting')
    setErrMsg('')

    // Clean up any previous terminal
    if (termRef.current) {
      termRef.current.dispose()
      termRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onerror = null
      wsRef.current.onclose = null
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close(1000, 'reconnect')
      }
      wsRef.current = null
    }

    const term = new Terminal({
      fontFamily: '"IBM Plex Mono", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: 'bar',
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background:   '#0c0c0c',
        foreground:   '#d4d4d4',
        cursor:       '#6fa8ff',
        cursorAccent: '#0c0c0c',
        selectionBackground: 'rgba(111,168,255,0.20)',
        black:   '#000000', brightBlack:   '#666666',
        red:     '#ff5555', brightRed:     '#ff6e67',
        green:   '#50fa7b', brightGreen:   '#5af78e',
        yellow:  '#f1fa8c', brightYellow:  '#f4f99d',
        blue:    '#6272a4', brightBlue:    '#6272a4',
        magenta: '#ff79c6', brightMagenta: '#ff92d0',
        cyan:    '#8be9fd', brightCyan:    '#9aedfe',
        white:   '#bfbfbf', brightWhite:   '#e2e2e2',
      },
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()

    termRef.current = term
    fitRef.current  = fit

    // Build WS URL from current origin
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams()
    const existingSessionID = getStoredSessionID()
    if (existingSessionID) {
      params.set('session', existingSessionID)
    }
    const wsUrl = `${proto}//${window.location.host}${wsBase}/${encodeURIComponent(name)}/shell${params.toString() ? `?${params.toString()}` : ''}`

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws
    closingRef.current = false

    ws.onopen = () => {
      setStatus('open')
      // Send initial terminal size
      const { cols, rows } = term
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data))
        return
      }
      if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data)
          if (msg?.type === 'session' && typeof msg.id === 'string' && msg.id.trim()) {
            storeSessionID(msg.id.trim())
            return
          }
          if (msg?.type === 'error' && msg?.message) {
            setStatus('error')
            setErrMsg(String(msg.message))
            return
          }
        } catch {
          // not a JSON control frame; treat as terminal output
        }
        term.write(e.data)
      }
    }

    ws.onerror = () => {
      if (closingRef.current) return
      setStatus('error')
      setErrMsg('WebSocket connection failed')
    }

    ws.onclose = (e) => {
      if (closingRef.current) return
      setStatus('closed')
      if (e.code !== 1000 && e.code !== 1001) {
        setErrMsg(`Connection closed (${e.code})`)
      }
    }

    // Keyboard → WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data))
      }
    })
  }

  // Mount: create terminal + connect
  useEffect(() => {
    if (!isRunning) return
    // Delay connect so React StrictMode dev cycle does not open+close a WS immediately.
    connectDelayRef.current = setTimeout(() => {
      connect()
    }, 0)

    // Resize observer — update PTY size when div resizes
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return
      fitRef.current.fit()
      const { cols, rows } = termRef.current
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      clearTimeout(connectDelayRef.current)
      ro.disconnect()
      closingRef.current = true
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close(1000, 'cleanup')
        }
      }
      termRef.current?.dispose()
      wsRef.current  = null
      termRef.current = null
    }
  }, [name, isRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isRunning) {
    return (
      <div style={{
        background: 'var(--card-1)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '40px 24px', textAlign: 'center',
      }}>
        <p className="mono" style={{ fontSize: 13, color: 'var(--stopped)', marginBottom: 8 }}>
          {resourceLabel} is not running
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Start the {resourceLabel.toLowerCase()} to access its shell.
        </p>
      </div>
    )
  }

  return (
    <div style={{ background: '#0c0c0c', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>

      {/* Title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#141414',
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
        </div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {name}
          {status === 'connecting' && ' · connecting…'}
          {status === 'closed'     && ' · disconnected'}
          {status === 'error'      && ' · error'}
        </span>
        {(status === 'closed' || status === 'error') ? (
          <button
            onClick={connect}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--accent)', padding: '2px 6px', borderRadius: 5,
              fontSize: 11, fontFamily: 'Syne', fontWeight: 700,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            Reconnect
          </button>
        ) : (
          <span style={{ width: 70 }} />
        )}
      </div>

      {/* Error banner */}
      {errMsg && (
        <div style={{
          padding: '6px 14px', background: 'rgba(240,71,71,0.08)',
          borderBottom: '1px solid rgba(240,71,71,0.15)',
          fontSize: 11.5, color: '#f06565', fontFamily: 'IBM Plex Mono',
        }}>
          {errMsg}
        </div>
      )}

      {/* Terminal container */}
      <div
        ref={containerRef}
        style={{ padding: '10px 6px', minHeight: 460 }}
      />
    </div>
  )
}
