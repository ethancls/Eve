package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

// handleShellWS handles shell websocket routes for instances, machines, and containers.
// If ?session=<id> is provided, it tries to re-attach to that shell session.
// Otherwise, a new shell session is created.
func (srv *Server) handleShellWS(w http.ResponseWriter, r *http.Request) {
	kind := "instance"
	prefix := "/ws/instances/"
	if strings.HasPrefix(r.URL.Path, "/ws/machines/") {
		kind = "machine"
		prefix = "/ws/machines/"
	} else if strings.HasPrefix(r.URL.Path, "/ws/containers/") {
		kind = "container"
		prefix = "/ws/containers/"
	}
	path := strings.TrimPrefix(r.URL.Path, prefix)
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 || parts[1] != "shell" || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	name := parts[0]

	sessionUser, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}

	requestedSessionID := strings.TrimSpace(r.URL.Query().Get("session"))
	sess, err := srv.shells.getOrCreate(sessionUser.ID, kind, name, requestedSessionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		srv.logger.Debug("shell ws: upgrade error", "err", err)
		return
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"type":     "session",
		"id":       sess.ID(),
		"instance": name,
		"kind":     kind,
	}); err != nil {
		return
	}

	if err := sess.attach(conn); err != nil {
		_ = conn.WriteJSON(map[string]any{"type": "error", "message": err.Error()})
		return
	}
	defer sess.detachIfMatch(conn)

	for {
		mt, msg, readErr := conn.ReadMessage()
		if readErr != nil {
			break
		}

		switch mt {
		case websocket.TextMessage:
			var ctrl struct {
				Type string `json:"type"`
				Cols uint16 `json:"cols"`
				Rows uint16 `json:"rows"`
			}
			if json.Unmarshal(msg, &ctrl) == nil && ctrl.Type == "resize" {
				sess.resize(ctrl.Cols, ctrl.Rows)
			}
		case websocket.BinaryMessage:
			_ = sess.writeInput(msg)
		}
	}
}
