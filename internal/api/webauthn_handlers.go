package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/user/eve/internal/store"
)

func (srv *Server) handlePasskeysLoginBegin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Login string `json:"login"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	sessionID, opts, err := srv.wa.BeginLogin(strings.TrimSpace(body.Login))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id": sessionID,
		"options":    opts,
	})
}

func (srv *Server) handlePasskeysLoginFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		SessionID  string `json:"session_id"`
		Credential json.RawMessage `json:"credential"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	user, err := srv.wa.FinishLogin(body.SessionID, body.Credential)
	if err != nil {
		srv.logAction(r, "passkey login", "", "error", err.Error())
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}

	if err := srv.setAuthCookie(w, r, *user); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create session"})
		return
	}
	srv.logAction(r, "passkey login", user.Login, "ok", "")
	_ = srv.users.TouchLastLogin(user.ID)
	srv.sendLoginAlert(*user, r.Header.Get("X-Forwarded-For"), r.Header.Get("User-Agent"))
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "user": toSessionUser(*user)})
}

func (srv *Server) handleListMyPasskeys(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	creds, err := srv.waStore.GetCredentialsByUser(user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if creds == nil {
		creds = []store.WebAuthnCredential{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"passkeys": creds})
}

func (srv *Server) handleRegisterPasskeyBegin(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	fullUser, found, _ := srv.users.GetByID(user.ID)
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	sessionID, opts, err := srv.wa.BeginRegistration(fullUser, body.Name)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id": sessionID,
		"options":    opts,
	})
}

func (srv *Server) handleRegisterPasskeyFinish(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	var body struct {
		SessionID  string          `json:"session_id"`
		Credential json.RawMessage `json:"credential"`
		Name       string          `json:"name"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if err := srv.wa.FinishRegistration(body.SessionID, body.Credential, body.Name); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	_ = srv.users.TouchLastLogin(user.ID)
	srv.logAction(r, "passkey register", user.Login, "ok", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (srv *Server) handleDeleteMyPasskey(w http.ResponseWriter, r *http.Request, passkeyID string) {
	user, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	// Verify passkey belongs to current user
	creds, _ := srv.waStore.GetCredentialsByUser(user.ID)
	found := false
	for _, c := range creds {
		if c.ID == passkeyID {
			found = true
			break
		}
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "passkey not found"})
		return
	}
	if err := srv.waStore.DeleteCredential(passkeyID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	srv.logAction(r, "passkey revoke", user.Login, "ok", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Admin: get user's passkeys
func (srv *Server) handleListUserPasskeys(w http.ResponseWriter, r *http.Request, userID string) {
	if _, ok := srv.requireAdminRequest(r); !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
		return
	}
	creds, err := srv.waStore.GetCredentialsByUser(userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if creds == nil {
		creds = []store.WebAuthnCredential{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"passkeys": creds})
}

// Admin: revoke a user's passkey
func (srv *Server) handleDeleteUserPasskey(w http.ResponseWriter, r *http.Request, userID, passkeyID string) {
	if _, ok := srv.requireAdminRequest(r); !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
		return
	}
	if err := srv.waStore.DeleteCredential(passkeyID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	srv.logAction(r, "passkey admin revoke", userID, "ok", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (srv *Server) routeMyPasskeys(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/users/me/passkeys")
	path = strings.Trim(path, "/")
	if path == "" {
		if r.Method == http.MethodGet {
			srv.handleListMyPasskeys(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	srv.handleDeleteMyPasskey(w, r, path)
}

func (srv *Server) routeRegisterPasskey(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/users/me/passkeys/register")
	if path == "/begin" && r.Method == http.MethodPost {
		srv.handleRegisterPasskeyBegin(w, r)
		return
	}
	if path == "/finish" && r.Method == http.MethodPost {
		srv.handleRegisterPasskeyFinish(w, r)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

