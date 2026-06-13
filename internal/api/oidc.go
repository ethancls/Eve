package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/user/eve/internal/store"
	"golang.org/x/oauth2"
)

const (
	oidcStateCookieName = "eve_oidc_state"
	oidcCallbackPath    = "/auth/oidc/callback"

	appKeyOIDCEnabled      = "auth.oidc.enabled"
	appKeyOIDCIssuer       = "auth.oidc.issuer"
	appKeyOIDCClientID     = "auth.oidc.client_id"
	appKeyOIDCClientSecret = "auth.oidc.client_secret"
	appKeyOIDCRedirectURL  = "auth.oidc.redirect_url"
	appKeyOIDCScopes       = "auth.oidc.scopes"
	appKeyOIDCClaimLogin   = "auth.oidc.claim_login"
	appKeyOIDCClaimName    = "auth.oidc.claim_name"
	appKeyOIDCClaimAvatar  = "auth.oidc.claim_avatar"
	appKeyOIDCClaimGroups  = "auth.oidc.claim_groups"
	appKeyOIDCAdminGroups  = "auth.oidc.admin_groups"
	appKeyLocalPassword    = "auth.local.password_enabled"
)

type oidcSettings struct {
	Enabled      bool
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Scopes       string
	ClaimLogin   string
	ClaimName    string
	ClaimAvatar  string
	ClaimGroups  string
	AdminGroups  string
}

type oidcRuntime struct {
	settings   oidcSettings
	provider   *oidc.Provider
	oauth2     *oauth2.Config
	verifier   *oidc.IDTokenVerifier
	redirectTo string
}

type oidcState struct {
	State     string `json:"state"`
	Nonce     string `json:"nonce"`
	ExpiresAt int64  `json:"exp"`
}

func defaultOIDCSettings() oidcSettings {
	return oidcSettings{
		Enabled:      false,
		Issuer:       "",
		ClientID:     "",
		ClientSecret: "",
		RedirectURL:  "",
		Scopes:       "openid profile email",
		ClaimLogin:   "preferred_username",
		ClaimName:    "name",
		ClaimAvatar:  "picture",
		ClaimGroups:  "groups",
		AdminGroups:  "",
	}
}

func (s oidcSettings) normalize() oidcSettings {
	s.Issuer = normalizeIssuer(s.Issuer)
	s.ClientID = strings.TrimSpace(s.ClientID)
	s.ClientSecret = strings.TrimSpace(s.ClientSecret)
	s.RedirectURL = strings.TrimSpace(s.RedirectURL)
	s.RedirectURL = normalizeRedirectURL(s.RedirectURL)
	s.Scopes = strings.TrimSpace(s.Scopes)
	s.ClaimLogin = strings.TrimSpace(s.ClaimLogin)
	s.ClaimName = strings.TrimSpace(s.ClaimName)
	s.ClaimAvatar = strings.TrimSpace(s.ClaimAvatar)
	s.ClaimGroups = strings.TrimSpace(s.ClaimGroups)
	s.AdminGroups = strings.TrimSpace(s.AdminGroups)
	if s.Scopes == "" {
		s.Scopes = "openid profile email"
	}
	if s.ClaimLogin == "" {
		s.ClaimLogin = "preferred_username"
	}
	if s.ClaimName == "" {
		s.ClaimName = "name"
	}
	if s.ClaimAvatar == "" {
		s.ClaimAvatar = "picture"
	}
	if s.ClaimGroups == "" {
		s.ClaimGroups = "groups"
	}
	return s
}

func (s oidcSettings) configured() bool {
	return normalizeIssuer(s.Issuer) != "" && strings.TrimSpace(s.ClientID) != "" && strings.TrimSpace(s.ClientSecret) != ""
}

func (s oidcSettings) redirectURI(r *http.Request) string {
	if strings.TrimSpace(s.RedirectURL) != "" {
		return strings.TrimSpace(s.RedirectURL)
	}
	scheme := "http"
	if requestIsSecure(r) {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	if host == "" {
		return oidcCallbackPath
	}
	return scheme + "://" + host + oidcCallbackPath
}

func (srv *Server) handleOIDCConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	cfg, err := srv.getOIDCSettings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load OIDC config"})
		return
	}
	cfg = cfg.normalize()
	localPasswordEnabled, err := srv.getLocalPasswordEnabled()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load auth config"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":                cfg.Enabled && cfg.configured(),
		"issuer":                 cfg.Issuer,
		"local_password_enabled": localPasswordEnabled,
	})
}

func (srv *Server) handleOIDCStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	rt, err := srv.oidcRuntime(r.Context(), r, true)
	if err != nil {
		srv.redirectOIDCError(w, r, err.Error())
		return
	}

	stateRaw, err := randomURLToken(24)
	if err != nil {
		srv.redirectOIDCError(w, r, "failed to generate OIDC state")
		return
	}
	nonceRaw, err := randomURLToken(24)
	if err != nil {
		srv.redirectOIDCError(w, r, "failed to generate OIDC nonce")
		return
	}

	cookieValue, err := encodeOIDCState(oidcState{
		State:     stateRaw,
		Nonce:     nonceRaw,
		ExpiresAt: time.Now().UTC().Add(10 * time.Minute).Unix(),
	})
	if err != nil {
		srv.redirectOIDCError(w, r, "failed to initialize OIDC state")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookieName,
		Value:    cookieValue,
		Path:     "/auth/oidc/callback",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   requestIsSecure(r),
		MaxAge:   600,
	})

	authURL := rt.oauth2.AuthCodeURL(stateRaw, oidc.Nonce(nonceRaw))
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (srv *Server) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if errCode := strings.TrimSpace(r.URL.Query().Get("error")); errCode != "" {
		detail := firstNonEmpty(r.URL.Query().Get("error_description"), errCode)
		srv.redirectOIDCError(w, r, detail)
		return
	}

	queryState := strings.TrimSpace(r.URL.Query().Get("state"))
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if queryState == "" || code == "" {
		srv.redirectOIDCError(w, r, "invalid OIDC callback payload")
		return
	}

	stateCookie, err := r.Cookie(oidcStateCookieName)
	if err != nil {
		srv.redirectOIDCError(w, r, "missing OIDC state cookie")
		return
	}
	stored, err := decodeOIDCState(stateCookie.Value)
	if err != nil {
		srv.redirectOIDCError(w, r, "invalid OIDC state cookie")
		return
	}
	if time.Now().UTC().Unix() > stored.ExpiresAt {
		srv.redirectOIDCError(w, r, "OIDC state expired")
		return
	}
	if strings.TrimSpace(stored.State) == "" || stored.State != queryState {
		srv.redirectOIDCError(w, r, "invalid OIDC state")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookieName,
		Value:    "",
		Path:     "/auth/oidc/callback",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   requestIsSecure(r),
		MaxAge:   -1,
	})

	rt, err := srv.oidcRuntime(r.Context(), r, true)
	if err != nil {
		srv.redirectOIDCError(w, r, err.Error())
		return
	}

	oauth2Token, err := rt.oauth2.Exchange(r.Context(), code)
	if err != nil {
		srv.redirectOIDCError(w, r, "OIDC token exchange failed")
		return
	}

	idTokenRaw, ok := oauth2Token.Extra("id_token").(string)
	if !ok || strings.TrimSpace(idTokenRaw) == "" {
		srv.redirectOIDCError(w, r, "OIDC provider did not return id_token")
		return
	}

	idToken, err := rt.verifier.Verify(r.Context(), idTokenRaw)
	if err != nil {
		srv.redirectOIDCError(w, r, "OIDC id_token verification failed")
		return
	}

	claims := map[string]any{}
	if err := idToken.Claims(&claims); err != nil {
		srv.redirectOIDCError(w, r, "failed to parse id_token claims")
		return
	}
	if strings.TrimSpace(stored.Nonce) == "" || stringClaim(claims, "nonce") != stored.Nonce {
		srv.redirectOIDCError(w, r, "invalid OIDC nonce")
		return
	}

	if info, err := rt.provider.UserInfo(r.Context(), oauth2.StaticTokenSource(oauth2Token)); err == nil {
		var infoClaims map[string]any
		if err := info.Claims(&infoClaims); err == nil {
			mergeClaims(claims, infoClaims)
		}
	}

	issuer := normalizeIssuer(firstNonEmpty(idToken.Issuer, stringClaim(claims, "iss"), rt.settings.Issuer))
	subject := strings.TrimSpace(firstNonEmpty(idToken.Subject, stringClaim(claims, "sub")))
	if issuer == "" || subject == "" {
		srv.redirectOIDCError(w, r, "OIDC identity is missing issuer/sub")
		return
	}
	role := oidcRoleFromClaims(rt.settings, claims)

	user, found, err := srv.users.GetByOIDC(issuer, subject)
	if err != nil {
		srv.redirectOIDCError(w, r, "failed to match OIDC user")
		return
	}
	if !found {
		login, err := srv.deriveUniqueOIDCLogin(rt.settings, claims, subject)
		if err != nil {
			srv.redirectOIDCError(w, r, "failed to create local login")
			return
		}
		name := firstNonEmpty(stringClaim(claims, rt.settings.ClaimName), stringClaim(claims, "name"), login)
		avatar := firstNonEmpty(stringClaim(claims, rt.settings.ClaimAvatar), stringClaim(claims, "picture"))
		user, err = srv.users.Create(store.CreateUserInput{
			Login:       login,
			Password:    "",
			Name:        name,
			AvatarURL:   avatar,
			OIDCIssuer:  issuer,
			OIDCSubject: subject,
			Role:        role,
		})
		if err != nil {
			srv.redirectOIDCError(w, r, "failed to create user for OIDC identity")
			return
		}
	} else if !store.IsOwner(user.Role) && user.Role != role {
		updated, changed, err := srv.users.Update(user.ID, store.UpdateUserInput{
			Login:       user.Login,
			Name:        user.Name,
			AvatarURL:   user.AvatarURL,
			OIDCIssuer:  user.OIDCIssuer,
			OIDCSubject: user.OIDCSubject,
			Role:        role,
		})
		if err != nil {
			srv.redirectOIDCError(w, r, "failed to update user role from OIDC groups")
			return
		}
		if changed {
			user = updated
		}
	}

	if err := srv.setAuthCookie(w, r, user); err != nil {
		srv.redirectOIDCError(w, r, "failed to create session")
		return
	}
	_ = srv.users.TouchLastLogin(user.ID)
	http.Redirect(w, r, "/", http.StatusFound)
}

func (srv *Server) handleAppAuthSettings(w http.ResponseWriter, r *http.Request) {
	sessionUser, ok := srv.sessionUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !store.HasAdminPrivileges(sessionUser.Role) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
			return
		}
		cfg, err := srv.getOIDCSettings()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load auth settings"})
			return
		}
		cfg = cfg.normalize()
		localPasswordEnabled, err := srv.getLocalPasswordEnabled()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load auth settings"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"local": map[string]any{
				"password_enabled": localPasswordEnabled,
			},
			"oidc": map[string]any{
				"enabled":           cfg.Enabled,
				"issuer":            cfg.Issuer,
				"client_id":         cfg.ClientID,
				"redirect_url":      cfg.RedirectURL,
				"scopes":            cfg.Scopes,
				"claim_login":       cfg.ClaimLogin,
				"claim_name":        cfg.ClaimName,
				"claim_avatar":      cfg.ClaimAvatar,
				"claim_groups":      cfg.ClaimGroups,
				"admin_groups":      cfg.AdminGroups,
				"has_client_secret": cfg.ClientSecret != "",
				"configured":        cfg.configured(),
			},
		})
	case http.MethodPut:
		if !store.HasAdminPrivileges(sessionUser.Role) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator role required"})
			return
		}
		cfg, err := srv.getOIDCSettings()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load auth settings"})
			return
		}
		cfg = cfg.normalize()
		localPasswordEnabled, err := srv.getLocalPasswordEnabled()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load auth settings"})
			return
		}

		var body struct {
			Local struct {
				PasswordEnabled *bool `json:"password_enabled"`
			} `json:"local"`
			OIDC struct {
				Enabled           *bool   `json:"enabled"`
				Issuer            *string `json:"issuer"`
				ClientID          *string `json:"client_id"`
				ClientSecret      *string `json:"client_secret"`
				ClearClientSecret bool    `json:"clear_client_secret"`
				RedirectURL       *string `json:"redirect_url"`
				Scopes            *string `json:"scopes"`
				ClaimLogin        *string `json:"claim_login"`
				ClaimName         *string `json:"claim_name"`
				ClaimAvatar       *string `json:"claim_avatar"`
				ClaimGroups       *string `json:"claim_groups"`
				AdminGroups       *string `json:"admin_groups"`
			} `json:"oidc"`
		}
		if !decodeBody(w, r, &body) {
			return
		}
		if body.Local.PasswordEnabled != nil {
			localPasswordEnabled = *body.Local.PasswordEnabled
		}

		if body.OIDC.Enabled != nil {
			cfg.Enabled = *body.OIDC.Enabled
		}
		if body.OIDC.Issuer != nil {
			cfg.Issuer = *body.OIDC.Issuer
		}
		if body.OIDC.ClientID != nil {
			cfg.ClientID = *body.OIDC.ClientID
		}
		if body.OIDC.ClientSecret != nil {
			cfg.ClientSecret = *body.OIDC.ClientSecret
		}
		if body.OIDC.ClearClientSecret {
			cfg.ClientSecret = ""
		}
		if body.OIDC.RedirectURL != nil {
			cfg.RedirectURL = *body.OIDC.RedirectURL
		}
		if body.OIDC.Scopes != nil {
			cfg.Scopes = *body.OIDC.Scopes
		}
		if body.OIDC.ClaimLogin != nil {
			cfg.ClaimLogin = *body.OIDC.ClaimLogin
		}
		if body.OIDC.ClaimName != nil {
			cfg.ClaimName = *body.OIDC.ClaimName
		}
		if body.OIDC.ClaimAvatar != nil {
			cfg.ClaimAvatar = *body.OIDC.ClaimAvatar
		}
		if body.OIDC.ClaimGroups != nil {
			cfg.ClaimGroups = *body.OIDC.ClaimGroups
		}
		if body.OIDC.AdminGroups != nil {
			cfg.AdminGroups = *body.OIDC.AdminGroups
		}
		cfg = cfg.normalize()

		if cfg.Enabled && !cfg.configured() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "oidc issuer, client_id and client_secret are required when OIDC is enabled"})
			return
		}
		if cfg.RedirectURL != "" {
			if _, err := url.ParseRequestURI(cfg.RedirectURL); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid redirect_url"})
				return
			}
		}
		if !localPasswordEnabled && !(cfg.Enabled && cfg.configured()) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot disable password login unless OIDC is enabled and configured"})
			return
		}

		if err := srv.saveAuthSettings(cfg, localPasswordEnabled); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save auth settings"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	default:
		methodNotAllowed(w)
	}
}

func (srv *Server) deriveUniqueOIDCLogin(cfg oidcSettings, claims map[string]any, subject string) (string, error) {
	loginCandidate := firstNonEmpty(
		stringClaim(claims, cfg.ClaimLogin),
		stringClaim(claims, "preferred_username"),
		emailLocalPart(stringClaim(claims, "email")),
		"oidc-"+subject,
	)
	base := sanitizeOIDCLogin(loginCandidate)
	if base == "" {
		base = "oidc-user"
	}

	for i := 0; i < 500; i++ {
		candidate := base
		if i > 0 {
			candidate = fmt.Sprintf("%s-%d", base, i+1)
		}
		candidate = sanitizeOIDCLogin(candidate)
		if candidate == "" {
			continue
		}
		if _, exists, err := srv.users.GetByLogin(candidate); err != nil {
			return "", err
		} else if !exists {
			return candidate, nil
		}
	}
	return "", errors.New("unable to allocate unique login")
}

func (srv *Server) getOIDCSettings() (oidcSettings, error) {
	cfg := defaultOIDCSettings()
	if srv.appConfig == nil {
		return cfg, nil
	}
	keys := []string{
		appKeyOIDCEnabled,
		appKeyOIDCIssuer,
		appKeyOIDCClientID,
		appKeyOIDCClientSecret,
		appKeyOIDCRedirectURL,
		appKeyOIDCScopes,
		appKeyOIDCClaimLogin,
		appKeyOIDCClaimName,
		appKeyOIDCClaimAvatar,
		appKeyOIDCClaimGroups,
		appKeyOIDCAdminGroups,
	}
	values, err := srv.appConfig.GetMany(keys)
	if err != nil {
		return cfg, err
	}
	cfg.Enabled = parseBoolString(values[appKeyOIDCEnabled])
	if v, ok := values[appKeyOIDCIssuer]; ok {
		cfg.Issuer = v
	}
	if v, ok := values[appKeyOIDCClientID]; ok {
		cfg.ClientID = v
	}
	if v, ok := values[appKeyOIDCClientSecret]; ok {
		cfg.ClientSecret = v
	}
	if v, ok := values[appKeyOIDCRedirectURL]; ok {
		cfg.RedirectURL = v
	}
	if v, ok := values[appKeyOIDCScopes]; ok {
		cfg.Scopes = v
	}
	if v, ok := values[appKeyOIDCClaimLogin]; ok {
		cfg.ClaimLogin = v
	}
	if v, ok := values[appKeyOIDCClaimName]; ok {
		cfg.ClaimName = v
	}
	if v, ok := values[appKeyOIDCClaimAvatar]; ok {
		cfg.ClaimAvatar = v
	}
	if v, ok := values[appKeyOIDCClaimGroups]; ok {
		cfg.ClaimGroups = v
	}
	if v, ok := values[appKeyOIDCAdminGroups]; ok {
		cfg.AdminGroups = v
	}
	return cfg, nil
}

func (srv *Server) saveAuthSettings(cfg oidcSettings, localPasswordEnabled bool) error {
	if srv.appConfig == nil {
		return errors.New("app settings store unavailable")
	}
	values := map[string]string{
		appKeyOIDCEnabled:      boolToString(cfg.Enabled),
		appKeyOIDCIssuer:       cfg.Issuer,
		appKeyOIDCClientID:     cfg.ClientID,
		appKeyOIDCClientSecret: cfg.ClientSecret,
		appKeyOIDCRedirectURL:  cfg.RedirectURL,
		appKeyOIDCScopes:       cfg.Scopes,
		appKeyOIDCClaimLogin:   cfg.ClaimLogin,
		appKeyOIDCClaimName:    cfg.ClaimName,
		appKeyOIDCClaimAvatar:  cfg.ClaimAvatar,
		appKeyOIDCClaimGroups:  cfg.ClaimGroups,
		appKeyOIDCAdminGroups:  cfg.AdminGroups,
		appKeyLocalPassword:    boolToString(localPasswordEnabled),
	}
	return srv.appConfig.SetMany(values)
}

func (srv *Server) getLocalPasswordEnabled() (bool, error) {
	if srv.appConfig == nil {
		return true, nil
	}
	raw, ok, err := srv.appConfig.Get(appKeyLocalPassword)
	if err != nil {
		return true, err
	}
	if !ok || strings.TrimSpace(raw) == "" {
		return true, nil
	}
	return parseBoolString(raw), nil
}

func boolToString(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

func parseBoolString(v string) bool {
	v = strings.ToLower(strings.TrimSpace(v))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func (srv *Server) oidcRuntime(ctx context.Context, r *http.Request, requireEnabled bool) (*oidcRuntime, error) {
	cfg, err := srv.getOIDCSettings()
	if err != nil {
		return nil, errors.New("OIDC configuration unavailable")
	}
	cfg = cfg.normalize()
	if requireEnabled && !cfg.Enabled {
		return nil, errors.New("OIDC login is not enabled")
	}
	if !cfg.configured() {
		return nil, errors.New("OIDC login is not configured")
	}

	provider, err := oidc.NewProvider(ctx, cfg.Issuer)
	if err != nil {
		return nil, fmt.Errorf("OIDC provider discovery failed: %w", err)
	}

	scopes := splitScopes(cfg.Scopes)
	oauth2Cfg := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  cfg.redirectURI(r),
		Scopes:       scopes,
	}
	verifier := provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})

	return &oidcRuntime{
		settings:   cfg,
		provider:   provider,
		oauth2:     oauth2Cfg,
		verifier:   verifier,
		redirectTo: oauth2Cfg.RedirectURL,
	}, nil
}

func splitScopes(raw string) []string {
	parts := strings.Fields(strings.TrimSpace(raw))
	if len(parts) == 0 {
		parts = []string{"openid", "profile", "email"}
	}
	hasOpenID := false
	for _, part := range parts {
		if part == "openid" {
			hasOpenID = true
			break
		}
	}
	if !hasOpenID {
		parts = append([]string{"openid"}, parts...)
	}
	return parts
}

func encodeOIDCState(st oidcState) (string, error) {
	raw, err := json.Marshal(st)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeOIDCState(value string) (oidcState, error) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		return oidcState{}, err
	}
	var st oidcState
	if err := json.Unmarshal(raw, &st); err != nil {
		return oidcState{}, err
	}
	if strings.TrimSpace(st.State) == "" || strings.TrimSpace(st.Nonce) == "" {
		return oidcState{}, errors.New("invalid OIDC state")
	}
	return st, nil
}

func randomURLToken(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func mergeClaims(dst, src map[string]any) {
	for k, v := range src {
		if v == nil {
			continue
		}
		dst[k] = v
	}
}

func oidcRoleFromClaims(cfg oidcSettings, claims map[string]any) string {
	matches := parseNormalizedTokens(cfg.AdminGroups)
	if len(matches) == 0 {
		return store.RoleUser
	}
	groups := claimStringSlice(claims, cfg.ClaimGroups)
	for _, g := range groups {
		if _, ok := matches[normalizeToken(g)]; ok {
			return store.RoleAdministrator
		}
	}
	return store.RoleUser
}

func claimStringSlice(claims map[string]any, key string) []string {
	key = strings.TrimSpace(key)
	if key == "" || claims == nil {
		return nil
	}
	raw, ok := claims[key]
	if !ok || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return nil
		}
		return splitFlexibleList(v)
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			item = strings.TrimSpace(item)
			if item != "" {
				out = append(out, item)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			str := strings.TrimSpace(fmt.Sprint(item))
			if str != "" && str != "<nil>" {
				out = append(out, str)
			}
		}
		return out
	default:
		str := strings.TrimSpace(fmt.Sprint(v))
		if str == "" || str == "<nil>" {
			return nil
		}
		return []string{str}
	}
}

func parseNormalizedTokens(raw string) map[string]struct{} {
	parts := splitFlexibleList(raw)
	if len(parts) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		p = normalizeToken(p)
		if p != "" {
			out[p] = struct{}{}
		}
	}
	return out
}

func splitFlexibleList(raw string) []string {
	splitter := func(r rune) bool {
		switch r {
		case ',', ';', '\n', '\r', '\t', ' ':
			return true
		default:
			return false
		}
	}
	parts := strings.FieldsFunc(strings.TrimSpace(raw), splitter)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func normalizeToken(v string) string {
	return strings.ToLower(strings.TrimSpace(v))
}

func stringClaim(claims map[string]any, key string) string {
	key = strings.TrimSpace(key)
	if key == "" || claims == nil {
		return ""
	}
	v, ok := claims[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func emailLocalPart(email string) string {
	email = strings.TrimSpace(email)
	if email == "" {
		return ""
	}
	if i := strings.Index(email, "@"); i > 0 {
		return email[:i]
	}
	return email
}

func normalizeIssuer(issuer string) string {
	issuer = strings.TrimSpace(issuer)
	issuer = strings.TrimRight(issuer, "/")
	if issuer == "" {
		return ""
	}
	if parsed, err := url.Parse(issuer); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		path := strings.TrimRight(parsed.Path, "/")
		const discoverySuffix = "/.well-known/openid-configuration"
		if strings.HasSuffix(path, discoverySuffix) {
			path = strings.TrimSuffix(path, discoverySuffix)
		}
		parsed.Path = path
		parsed.RawPath = ""
		parsed.RawQuery = ""
		parsed.Fragment = ""
		issuer = parsed.String()
	}
	issuer = strings.TrimRight(issuer, "/")
	return issuer
}

func normalizeRedirectURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.TrimSpace(raw)
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	path := strings.TrimRight(strings.TrimSpace(parsed.Path), "/")
	if path == "" {
		path = oidcCallbackPath
	}
	parsed.Path = path
	parsed.RawPath = ""
	return parsed.String()
}

func (srv *Server) redirectOIDCError(w http.ResponseWriter, r *http.Request, msg string) {
	http.Redirect(w, r, "/?auth_error="+url.QueryEscape(firstNonEmpty(msg, "OIDC authentication failed")), http.StatusFound)
}
