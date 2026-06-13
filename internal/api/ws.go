package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type wsClient struct {
	conn *websocket.Conn
	send chan []byte
}

// WSHub manages all connected WebSocket clients.
type WSHub struct {
	mu      sync.RWMutex
	clients map[*wsClient]bool
	logger  *slog.Logger
}

func newWSHub(logger *slog.Logger) *WSHub {
	return &WSHub{
		clients: make(map[*wsClient]bool),
		logger:  logger,
	}
}

// Count returns the number of connected clients.
func (h *WSHub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// Broadcast sends a message to all connected clients.
func (h *WSHub) Broadcast(instances []map[string]any) {
	msg, err := json.Marshal(map[string]any{
		"type": "instances",
		"data": instances,
	})
	if err != nil {
		h.logger.Error("ws: marshal error", "err", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		select {
		case client.send <- msg:
		default:
			// drop if buffer full
		}
	}
}

// HandleWS upgrades an HTTP connection to WebSocket.
func (srv *Server) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		srv.logger.Debug("ws: upgrade error", "err", err)
		return
	}

	client := &wsClient{conn: conn, send: make(chan []byte, 32)}
	srv.hub.mu.Lock()
	srv.hub.clients[client] = true
	srv.hub.mu.Unlock()

	go client.writePump(srv.hub)
	client.readPump(srv.hub)
}

func (c *wsClient) writePump(hub *WSHub) {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			break
		}
	}
}

func (c *wsClient) readPump(hub *WSHub) {
	defer func() {
		hub.mu.Lock()
		delete(hub.clients, c)
		hub.mu.Unlock()
		close(c.send)
		c.conn.Close()
	}()
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}
