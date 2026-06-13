package api

import (
	"net/http"
	"strings"

	"github.com/user/eve/internal/store"
)

func (srv *Server) handleUsersDispatch(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		srv.handleListUsers(w, r)
	case http.MethodPost:
		srv.handleCreateUser(w, r)
	default:
		methodNotAllowed(w)
	}
}

func (srv *Server) routeUsers(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	path = strings.Trim(path, "/")
	if path == "" {
		srv.handleUsersDispatch(w, r)
		return
	}

	if path == "me" {
		switch r.Method {
		case http.MethodGet:
			srv.handleCurrentUser(w, r)
		case http.MethodPut:
			srv.handleUpdateCurrentUser(w, r)
		default:
			methodNotAllowed(w)
		}
		return
	}
	if path == "me/password" {
		if r.Method == http.MethodPut {
			srv.handleChangeCurrentPassword(w, r)
			return
		}
		methodNotAllowed(w)
		return
	}

	parts := strings.Split(path, "/")
	id := parts[0]
	if id == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			srv.handleGetUser(w, r, id)
		case http.MethodPut:
			srv.handleUpdateUser(w, r, id)
		case http.MethodDelete:
			srv.handleDeleteUser(w, r, id)
		default:
			methodNotAllowed(w)
		}
		return
	}

	if len(parts) == 2 && parts[1] == "password" {
		if r.Method == http.MethodPut {
			srv.handleSetUserPassword(w, r, id)
			return
		}
		methodNotAllowed(w)
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func (srv *Server) requireAdminRequest(r *http.Request) (SessionUser, bool) {
	user, ok := srv.sessionUser(r)
	if !ok {
		return SessionUser{}, false
	}
	if !store.HasAdminPrivileges(user.Role) {
		return SessionUser{}, false
	}
	return user, true
}

func canManageTargetUser(actorRole, targetRole string) bool {
	if store.IsOwner(actorRole) {
		return true
	}
	return store.HasAdminPrivileges(actorRole) && !store.IsOwner(targetRole)
}

func (srv *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if _, ok := srv.requireAdminRequest(r); !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
		return
	}
	users, err := srv.users.List()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (srv *Server) handleGetUser(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if _, ok := srv.requireAdminRequest(r); !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
		return
	}
	user, ok, err := srv.users.GetByID(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (srv *Server) handleCurrentUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	sessionUser, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	user, exists, err := srv.users.GetByID(sessionUser.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !exists {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (srv *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	actor, ok := srv.requireAdminRequest(r)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
		return
	}
	var body struct {
		Login       string `json:"login"`
		Password    string `json:"password"`
		Name        string `json:"name"`
		AvatarURL   string `json:"avatar_url"`
		OIDCIssuer  string `json:"oidc_issuer"`
		OIDCSubject string `json:"oidc_subject"`
		Role        string `json:"role"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	role := normalizeRequestedRole(body.Role)
	if !store.IsOwner(actor.Role) && role == store.RoleOwner {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "owner role required to create owner users"})
		return
	}

	user, err := srv.users.Create(store.CreateUserInput{
		Login:       body.Login,
		Password:    body.Password,
		Name:        body.Name,
		AvatarURL:   body.AvatarURL,
		OIDCIssuer:  body.OIDCIssuer,
		OIDCSubject: body.OIDCSubject,
		Role:        role,
	})
	if err != nil {
		status := http.StatusBadRequest
		if isUniqueConstraintError(err) {
			status = http.StatusConflict
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": user})
}

func (srv *Server) handleUpdateCurrentUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w)
		return
	}
	sessionUser, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	current, found, err := srv.users.GetByID(sessionUser.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !found {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}

	var body struct {
		Name      *string `json:"name"`
		AvatarURL *string `json:"avatar_url"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	next := store.UpdateUserInput{
		Login:       current.Login,
		Name:        current.Name,
		AvatarURL:   current.AvatarURL,
		OIDCIssuer:  current.OIDCIssuer,
		OIDCSubject: current.OIDCSubject,
		Role:        current.Role,
	}
	if body.Name != nil {
		next.Name = *body.Name
	}
	if body.AvatarURL != nil {
		next.AvatarURL = *body.AvatarURL
	}

	user, updated, err := srv.users.Update(current.ID, next)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if !updated {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (srv *Server) handleChangeCurrentPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w)
		return
	}
	sessionUser, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	valid, err := srv.users.CheckPassword(sessionUser.ID, body.CurrentPassword)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !valid {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid current password"})
		return
	}
	ok, err = srv.users.SetPassword(sessionUser.ID, body.NewPassword)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (srv *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w)
		return
	}
	actor, ok := srv.requireAdminRequest(r)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
		return
	}
	current, found, err := srv.users.GetByID(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	if !canManageTargetUser(actor.Role, current.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "owner role required to manage owner users"})
		return
	}

	var body struct {
		Login       *string `json:"login"`
		Name        *string `json:"name"`
		AvatarURL   *string `json:"avatar_url"`
		OIDCIssuer  *string `json:"oidc_issuer"`
		OIDCSubject *string `json:"oidc_subject"`
		Role        *string `json:"role"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	next := store.UpdateUserInput{
		Login:       current.Login,
		Name:        current.Name,
		AvatarURL:   current.AvatarURL,
		OIDCIssuer:  current.OIDCIssuer,
		OIDCSubject: current.OIDCSubject,
		Role:        current.Role,
	}
	oidcManaged := current.OIDCIssuer != "" && current.OIDCSubject != ""
	if body.Login != nil {
		if oidcManaged && strings.TrimSpace(*body.Login) != strings.TrimSpace(current.Login) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "OIDC-managed users only allow avatar updates"})
			return
		}
		next.Login = *body.Login
	}
	if body.Name != nil {
		if oidcManaged && strings.TrimSpace(*body.Name) != strings.TrimSpace(current.Name) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "OIDC-managed users only allow avatar updates"})
			return
		}
		next.Name = *body.Name
	}
	if body.AvatarURL != nil {
		next.AvatarURL = *body.AvatarURL
	}
	if body.OIDCIssuer != nil {
		if oidcManaged && strings.TrimSpace(*body.OIDCIssuer) != strings.TrimSpace(current.OIDCIssuer) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "OIDC-managed users only allow avatar updates"})
			return
		}
		next.OIDCIssuer = *body.OIDCIssuer
	}
	if body.OIDCSubject != nil {
		if oidcManaged && strings.TrimSpace(*body.OIDCSubject) != strings.TrimSpace(current.OIDCSubject) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "OIDC-managed users only allow avatar updates"})
			return
		}
		next.OIDCSubject = *body.OIDCSubject
	}
	if body.Role != nil {
		next.Role = normalizeRequestedRole(*body.Role)
		if oidcManaged && next.Role != current.Role {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "OIDC-managed users only allow avatar updates"})
			return
		}
		if !store.IsOwner(actor.Role) && next.Role == store.RoleOwner {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "owner role required to assign owner role"})
			return
		}
	}

	user, updated, err := srv.users.Update(id, next)
	if err != nil {
		status := http.StatusBadRequest
		if err == store.ErrCannotDemoteLastOwner {
			status = http.StatusBadRequest
		}
		if isUniqueConstraintError(err) {
			status = http.StatusConflict
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	if !updated {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (srv *Server) handleSetUserPassword(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w)
		return
	}
	actor, ok := srv.requireAdminRequest(r)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
		return
	}
	target, found, err := srv.users.GetByID(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	if !canManageTargetUser(actor.Role, target.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "owner role required to manage owner users"})
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	updated, err := srv.users.SetPassword(id, body.Password)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if !updated {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (srv *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	actor, ok := srv.requireAdminRequest(r)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
		return
	}
	if actor.ID == id {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot delete your own account"})
		return
	}
	target, found, err := srv.users.GetByID(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	if !canManageTargetUser(actor.Role, target.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "owner role required to delete owner users"})
		return
	}
	deleted, err := srv.users.Delete(id)
	if err != nil {
		if err == store.ErrCannotDeleteLastOwner {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !deleted {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func isUniqueConstraintError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") && strings.Contains(msg, "constraint")
}

func normalizeRequestedRole(role string) string {
	role = strings.ToLower(strings.TrimSpace(role))
	switch role {
	case "", store.RoleUser:
		return store.RoleUser
	case "admin", store.RoleAdministrator:
		return store.RoleAdministrator
	case store.RoleOwner:
		return store.RoleOwner
	default:
		return role
	}
}
