import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

export function useInstances() {
  const queryClient = useQueryClient()
  const [wsInstances, setWsInstances] = useState(null)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  const connectDelayRef = useRef(null)
  const activeRef = useRef(false)

  const connect = useCallback(function connectSocket() {
    if (!activeRef.current) return
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/instances`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'instances') {
          setWsInstances(msg.data)
          
          queryClient.setQueryData(['containers'], (old) => {
            if (!old?.containers) return old
            const statsMap = new Map(msg.data.map(s => [s.name, s]))
            const merged = old.containers.map(c => {
              const s = statsMap.get(c.name) || statsMap.get(c.id)
              if (!s) return c
              return { ...c, cpu: s.cpu, memory: s.memory }
            })
            return { containers: merged }
          })
          
          queryClient.setQueryData(['instances'], { instances: msg.data })
        }
      } catch (err) {
        void err
      }
    }

    ws.onclose = () => {
      if (!activeRef.current) return
      reconnectRef.current = setTimeout(() => {
        connectSocket()
      }, 3000)
    }

    ws.onerror = () => ws.close()
  }, [queryClient])

  useEffect(() => {
    activeRef.current = true
    // Delay initial connect so React StrictMode mount/unmount cycle in dev
    // does not create and immediately close a websocket before handshake.
    connectDelayRef.current = setTimeout(() => {
      connect()
    }, 0)

    return () => {
      activeRef.current = false
      clearTimeout(connectDelayRef.current)
      clearTimeout(reconnectRef.current)
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close(1000, 'cleanup')
        }
        wsRef.current = null
      }
    }
  }, [connect])

  const query = useQuery({
    queryKey: ['instances'],
    queryFn: () => api.getInstances(),
    refetchInterval: 10000,
  })

  const instances = wsInstances ?? query.data?.instances ?? []
  return { instances, isLoading: query.isLoading, error: query.error, refetch: query.refetch }
}
