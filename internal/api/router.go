package api

import (
	"bufio"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/user/eve/internal/config"
	"github.com/user/eve/internal/docker"
	"github.com/user/eve/internal/store"
	"github.com/user/eve/internal/webauthn"
)

// Server holds all dependencies for the HTTP server.
type Server struct {
	cfg       config.Config
	mp        *docker.Client
	activity  *store.ActivityStore
	templates *store.TemplateStore
	metrics   *store.MetricsStore
	users     *store.UserStore
	appConfig *store.AppSettingsStore
	jwtSecret []byte
	hub       *WSHub
	shells    *shellSessionManager
	wa        *webauthn.Service
	waStore   *store.WebAuthnStore
	logger    *slog.Logger
}

// New creates a new Server.
func New(cfg config.Config, mp *docker.Client, activity *store.ActivityStore, templates *store.TemplateStore, metrics *store.MetricsStore, users *store.UserStore, appConfig *store.AppSettingsStore, waService *webauthn.Service, waStore *store.WebAuthnStore, logger *slog.Logger) *Server {
	srv := &Server{
		cfg:       cfg,
		mp:        mp,
		activity:  activity,
		templates: templates,
		metrics:   metrics,
		users:     users,
		appConfig: appConfig,
		wa:        waService,
		waStore:   waStore,
		jwtSecret: []byte(cfg.JWTSecret),
		logger:    logger,
	}
	srv.hub = newWSHub(logger)
	srv.shells = newShellSessionManager(logger, "docker")
	return srv
}

// Broadcast sends instance data to all connected WebSocket clients.
func (srv *Server) Broadcast(instances []map[string]any) {
	srv.hub.Broadcast(instances)
}

// Build returns the main HTTP handler.
func (srv *Server) Build(frontendFS embed.FS) http.Handler {
	mux := http.NewServeMux()

	// Auth endpoints (no session required)
	mux.HandleFunc("/auth/login", srv.handleLogin)
	mux.HandleFunc("/auth/oidc/config", srv.handleOIDCConfig)
	mux.HandleFunc("/auth/oidc/start", srv.handleOIDCStart)
	mux.HandleFunc("/auth/oidc/callback", srv.handleOIDCCallback)
	mux.HandleFunc("/auth/logout", srv.handleLogout)
	mux.HandleFunc("/auth/forgot-password", srv.handleForgotPassword)
	mux.HandleFunc("/auth/reset-password", srv.handleResetPassword)
	mux.HandleFunc("/auth/passkeys/login/begin", srv.handlePasskeysLoginBegin)
	mux.HandleFunc("/auth/passkeys/login/finish", srv.handlePasskeysLoginFinish)
	mux.HandleFunc("/auth/me", srv.handleMe)

	// WebSocket (session required)
	mux.Handle("/ws/instances", srv.requireSession(http.HandlerFunc(srv.HandleWS)))
	mux.Handle("/ws/instances/", srv.requireSession(http.HandlerFunc(srv.handleShellWS)))
	mux.Handle("/ws/machines/", srv.requireSession(http.HandlerFunc(srv.handleShellWS)))
	mux.Handle("/ws/containers/", srv.requireSession(http.HandlerFunc(srv.handleShellWS)))

	// API routes (session required)
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("/api/health", srv.handleHealth)
	apiMux.HandleFunc("/api/system/version", srv.handleVersion)
	apiMux.HandleFunc("/api/system/host", srv.handleHostInfo)
	apiMux.HandleFunc("/api/system/prune", srv.handleSystemPrune)
	apiMux.HandleFunc("/api/container/system", srv.handleContainerSystem)
	apiMux.HandleFunc("/api/fs/browse", srv.handleFsBrowse)
	apiMux.HandleFunc("/api/fs/check-url", srv.handleFsCheckURL)
	apiMux.HandleFunc("/api/images", srv.handleImages)
	apiMux.HandleFunc("/api/images/local", srv.handleLocalImages)
	apiMux.HandleFunc("/api/registry/search", srv.handleRegistrySearch)
	apiMux.HandleFunc("/api/registry/tags", srv.handleRegistryTags)
	apiMux.HandleFunc("/api/registries", srv.handleRegistries)
	apiMux.HandleFunc("/api/images/check-update", srv.handleImageUpdateCheck)
	apiMux.HandleFunc("/api/networks", srv.handleNetworks)
	apiMux.HandleFunc("/api/volumes", srv.handleVolumes)
	apiMux.HandleFunc("/api/volumes/", srv.routeVolumes)
	apiMux.HandleFunc("/api/builder", srv.handleBuilder)
	apiMux.HandleFunc("/api/containers", srv.handleContainersDispatch)
	apiMux.HandleFunc("/api/machines", srv.handleMachines)
	apiMux.HandleFunc("/api/settings/container-properties", srv.handleContainerProperties)
	apiMux.HandleFunc("/api/settings/keys", srv.handleSettingsKeys)
	apiMux.HandleFunc("/api/settings", srv.handleGetSettings)
	apiMux.HandleFunc("/api/app/auth", srv.handleAppAuthSettings)
	apiMux.HandleFunc("/api/activity", srv.handleGetActivity)
	apiMux.HandleFunc("/api/stats", srv.handleGetStats)
	apiMux.HandleFunc("/api/templates", srv.handleTemplatesDispatch)
	apiMux.HandleFunc("/api/instances", srv.handleInstancesDispatch)
	apiMux.HandleFunc("/api/users", srv.handleUsersDispatch)
	apiMux.HandleFunc("/api/projects", srv.handleProjectsList)

	// Parameterised routes via prefix matching
	apiMux.HandleFunc("/api/projects/", srv.routeProjects)
	apiMux.HandleFunc("/api/containers/", srv.routeContainers)
	apiMux.HandleFunc("/api/machines/", srv.routeMachines)
	apiMux.HandleFunc("/api/settings/notifications/", srv.routeNotifications)
	apiMux.HandleFunc("/api/settings/test-smtp", srv.handleTestSMTP)
	apiMux.HandleFunc("/api/settings/", srv.routeSettings)
	apiMux.HandleFunc("/api/templates/", srv.routeTemplateDelete)
	apiMux.HandleFunc("/api/instances/", srv.routeInstances)
		apiMux.HandleFunc("/api/users/me/passkeys/", srv.routeMyPasskeys)
		apiMux.HandleFunc("/api/users/me/passkeys/register/", srv.routeRegisterPasskey)
	apiMux.HandleFunc("/api/users/", srv.routeUsers)

	mux.Handle("/api/", srv.requireSession(apiMux))

	// Frontend SPA
	mux.Handle("/", srv.buildFrontendHandler(frontendFS))

	return loggingMiddleware(recoveryMiddleware(mux, srv.logger), srv.logger)
}

// --- route dispatchers ---

func (srv *Server) handleInstancesDispatch(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		srv.handleGetInstances(w, r)
	case http.MethodPost:
		srv.handleCreateInstance(w, r)
	default:
		methodNotAllowed(w)
	}
}

func (srv *Server) handleAliasesDispatch(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		srv.handleGetAliases(w, r)
	case http.MethodPost:
		srv.handleCreateAlias(w, r)
	default:
		methodNotAllowed(w)
	}
}

func (srv *Server) handleTemplatesDispatch(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		srv.handleGetTemplates(w, r)
	case http.MethodPost:
		srv.handleCreateTemplate(w, r)
	default:
		methodNotAllowed(w)
	}
}

func (srv *Server) routeSnapshots(w http.ResponseWriter, r *http.Request) {
	// /api/snapshots/{instance}/{snapshot}/restore
	// /api/snapshots/{instance}/{snapshot}  DELETE
	path := strings.TrimPrefix(r.URL.Path, "/api/snapshots/")
	parts := strings.Split(path, "/")

	if len(parts) == 3 && parts[2] == "restore" && r.Method == http.MethodPost {
		srv.handleRestoreSnapshot(w, r, parts[0], parts[1])
		return
	}
	if len(parts) == 2 && r.Method == http.MethodDelete {
		srv.handleDeleteSnapshot(w, r, parts[0], parts[1])
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func (srv *Server) routeAliasDelete(w http.ResponseWriter, r *http.Request) {
	// /api/aliases/{name}
	name := strings.TrimPrefix(r.URL.Path, "/api/aliases/")
	if name == "" || strings.Contains(name, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if r.Method == http.MethodDelete {
		srv.handleDeleteAlias(w, r, name)
		return
	}
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
}

func (srv *Server) routeSettings(w http.ResponseWriter, r *http.Request) {
	// /api/settings/keys  → already handled above
	// /api/settings/{key}
	key := strings.TrimPrefix(r.URL.Path, "/api/settings/")
	if key == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		srv.handleGetSetting(w, r, key)
	case http.MethodPut:
		srv.handlePutSetting(w, r, key)
	default:
		methodNotAllowed(w)
	}
}

func (srv *Server) routeTemplateDelete(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/templates/")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if r.Method == http.MethodDelete {
		srv.handleDeleteTemplate(w, r, id)
		return
	}
	methodNotAllowed(w)
}

func (srv *Server) routeInstances(w http.ResponseWriter, r *http.Request) {
	// Strip /api/instances/ prefix
	path := strings.TrimPrefix(r.URL.Path, "/api/instances/")
	parts := strings.SplitN(path, "/", -1)
	if len(parts) == 0 || parts[0] == "" {
		srv.handleInstancesDispatch(w, r)
		return
	}

	name := parts[0]

	if len(parts) == 1 {
		srv.handleGetInstance(w, r, name)
		return
	}

	switch parts[1] {
	case "actions":
		if len(parts) == 3 {
			srv.handleInstanceAction(w, r, name, parts[2])
		} else {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		}
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

// --- frontend SPA handler ---

func (srv *Server) buildFrontendHandler(frontendFS embed.FS) http.Handler {
	// If EVE_FRONTEND_DIR is set, serve from disk
	if srv.cfg.FrontendDir != "" {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if path == "/" {
				http.ServeFile(w, r, srv.cfg.FrontendDir+"/index.html")
				return
			}
			filePath := srv.cfg.FrontendDir + path
			if _, err := os.Stat(filePath); os.IsNotExist(err) {
				http.ServeFile(w, r, srv.cfg.FrontendDir+"/index.html")
				return
			}
			http.ServeFile(w, r, filePath)
		})
	}

	// Serve from embedded FS (frontend/dist)
	sub, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "frontend not embedded"})
		})
	}

	// Read index.html once at startup
	indexHTML, _ := fs.ReadFile(sub, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		relPath := strings.TrimPrefix(r.URL.Path, "/")
		if relPath == "" {
			serveHTML(w, indexHTML)
			return
		}

		data, readErr := fs.ReadFile(sub, relPath)
		if readErr != nil {
			// SPA fallback for unknown paths (e.g. /dashboard, /instances/*)
			serveHTML(w, indexHTML)
			return
		}

		w.Header().Set("Content-Type", mimeType(relPath))
		w.WriteHeader(http.StatusOK)
		w.Write(data) //nolint:errcheck
	})
}

func serveHTML(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(data) //nolint:errcheck
}

func mimeType(path string) string {
	switch {
	case strings.HasSuffix(path, ".js"):
		return "application/javascript; charset=utf-8"
	case strings.HasSuffix(path, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(path, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(path, ".json"):
		return "application/json"
	case strings.HasSuffix(path, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(path, ".png"):
		return "image/png"
	case strings.HasSuffix(path, ".jpg"), strings.HasSuffix(path, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(path, ".ico"):
		return "image/x-icon"
	case strings.HasSuffix(path, ".woff2"):
		return "font/woff2"
	case strings.HasSuffix(path, ".woff"):
		return "font/woff"
	default:
		return "application/octet-stream"
	}
}

// --- middleware ---

func loggingMiddleware(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"latency_ms", time.Since(start).Milliseconds(),
		)
	})
}

func recoveryMiddleware(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Error("panic recovered", "panic", rec)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if rw.status == 0 {
		rw.status = http.StatusOK
	}
	return rw.ResponseWriter.Write(b)
}

func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	return h.Hijack()
}

func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (rw *responseWriter) Push(target string, opts *http.PushOptions) error {
	p, ok := rw.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}
	return p.Push(target, opts)
}
