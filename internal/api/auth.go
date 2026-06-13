package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/user/eve/internal/store"
)

const sessionCookieName = "eve_session"

type SessionUser struct {
	ID    string `json:"id"`
	Login string `json:"login"`
	Role  string `json:"role"`
}

type authClaims struct {
	Login string `json:"login"`
	Role  string `json:"role"`
	jwt.RegisteredClaims
}

var errInvalidToken = errors.New("invalid auth token")

// --- HTTP handlers ---

func (srv *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	localPasswordEnabled, err := srv.getLocalPasswordEnabled()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load auth config"})
		return
	}
	if !localPasswordEnabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "password login is disabled"})
		return
	}
	var body struct {
		Login    string `json:"login"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "invalid JSON"})
		return
	}
	login := strings.TrimSpace(body.Login)
	if login == "" {
		login = strings.TrimSpace(body.Username)
	}
	user, err := srv.users.Authenticate(login, body.Password)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	if err := srv.setAuthCookie(w, r, user); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create session"})
		return
	}
	_ = srv.users.TouchLastLogin(user.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"user":   toSessionUser(user),
	})
}

func (srv *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	srv.clearAuthCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (srv *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	sessionUser, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not authenticated"})
		return
	}
	user, exists, err := srv.users.GetByID(sessionUser.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load current user"})
		return
	}
	if !exists {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not authenticated"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":         user.ID,
		"login":      user.Login,
		"username":   user.Login,
		"name":       user.Name,
		"avatar_url": user.AvatarURL,
		"role":       user.Role,
		"is_admin":   store.HasAdminPrivileges(user.Role),
	})
}

func (srv *Server) setAuthCookie(w http.ResponseWriter, r *http.Request, user store.User) error {
	token, err := srv.createAuthToken(user)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   requestIsSecure(r),
		MaxAge:   int(srv.cfg.SessionTTL.Seconds()),
	})
	return nil
}

func (srv *Server) clearAuthCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func requestIsSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	proto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	return strings.EqualFold(proto, "https")
}

func (srv *Server) createAuthToken(user store.User) (string, error) {
	now := time.Now().UTC()
	claims := authClaims{
		Login: user.Login,
		Role:  user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(srv.cfg.SessionTTL)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(srv.jwtSecret)
}

func (srv *Server) parseAuthToken(raw string) (authClaims, error) {
	claims := &authClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method == nil || token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errInvalidToken
		}
		return srv.jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil || token == nil || !token.Valid {
		return authClaims{}, errInvalidToken
	}
	if strings.TrimSpace(claims.Subject) == "" {
		return authClaims{}, errInvalidToken
	}
	return *claims, nil
}

func (srv *Server) sessionUser(r *http.Request) (SessionUser, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return SessionUser{}, false
	}
	claims, err := srv.parseAuthToken(cookie.Value)
	if err != nil {
		return SessionUser{}, false
	}
	return SessionUser{ID: claims.Subject, Login: claims.Login, Role: claims.Role}, true
}

// requireSession is middleware that rejects unauthenticated requests.
func (srv *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := srv.sessionUser(r); !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (srv *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := srv.sessionUser(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
			return
		}
		if !store.HasAdminPrivileges(user.Role) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (srv *Server) requireOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := srv.sessionUser(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
			return
		}
		if !store.IsOwner(user.Role) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "owner role required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (srv *Server) sessionUserRecord(r *http.Request) (store.User, bool) {
	sessionUser, ok := srv.sessionUser(r)
	if !ok {
		return store.User{}, false
	}
	user, exists, err := srv.users.GetByID(sessionUser.ID)
	if err != nil {
		srv.logger.Warn("session user lookup failed", "err", err)
		return store.User{}, false
	}
	if !exists {
		return store.User{}, false
	}
	return user, true
}

func toSessionUser(user store.User) SessionUser {
	return SessionUser{
		ID:    user.ID,
		Login: user.Login,
		Role:  user.Role,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func sanitizeOIDCLogin(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	return strings.Trim(b.String(), ".-_")
}
