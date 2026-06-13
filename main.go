package main

import (
	"context"
	"embed"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/user/eve/internal/api"
	"github.com/user/eve/internal/config"
	"github.com/user/eve/internal/docker"
	"github.com/user/eve/internal/poller"
	"github.com/user/eve/internal/store"
)

//go:embed frontend/dist
var frontendFS embed.FS

func main() {
	openBrowser := false
	for _, arg := range os.Args[1:] {
		if arg == "--open" || arg == "serve --open" {
			openBrowser = true
		}
	}

	cfg := config.Load()

	// Logger
	var handler slog.Handler
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}
	if cfg.LogFormat == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}
	logger := slog.New(handler)
	slog.SetDefault(logger)

	logger.Info("starting eve",
		"bind", cfg.Bind,
		"db", cfg.DBPath,
		"poll_interval", cfg.PollInterval,
	)

	// Stores
	activity, err := store.NewActivityStore(cfg.DBPath, cfg.ActivityRetention)
	if err != nil {
		logger.Error("failed to open activity store", "err", err)
		os.Exit(1)
	}
	defer activity.Close()

	templates, err := store.NewTemplateStore(cfg.DBPath)
	if err != nil {
		logger.Error("failed to open template store", "err", err)
		os.Exit(1)
	}
	defer templates.Close()

	users, err := store.NewUserStore(cfg.DBPath)
	if err != nil {
		logger.Error("failed to open user store", "err", err)
		os.Exit(1)
	}
	defer users.Close()
	createdDefaultUser, err := users.EnsureDefaultOwner("eve", "vap0r", "Eve")
	if err != nil {
		logger.Error("failed to initialize default user", "err", err)
		os.Exit(1)
	}
	if createdDefaultUser {
		logger.Warn("created default owner user", "login", "eve")
	}

	if cfg.JWTSecret == "vap0r-dev-secret-change-me" {
		logger.Warn("using default insecure JWT secret; set EVE_JWT_SECRET in production")
	}

	appSettings, err := store.NewAppSettingsStore(cfg.DBPath)
	if err != nil {
		logger.Error("failed to open app settings store", "err", err)
		os.Exit(1)
	}
	defer appSettings.Close()

	metrics := store.NewMetricsStore(60)

	// Docker client
	client, err := docker.NewClient(cfg.ContainerBinary, logger)
	if err != nil {
		logger.Error("failed to create docker client", "err", err)
		os.Exit(1)
	}

	// HTTP server
	srv := api.New(cfg, client, activity, templates, metrics, users, appSettings, logger)
	handler2 := srv.Build(frontendFS)

	// Poller
	poll := poller.New(client, metrics, cfg.PollInterval, srv.Broadcast, logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go poll.Run(ctx)

	httpSrv := &http.Server{
		Addr:         cfg.Bind,
		Handler:      handler2,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		logger.Info("listening", "addr", cfg.Bind)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server error", "err", err)
			os.Exit(1)
		}
	}()

	if openBrowser {
		go func() {
			time.Sleep(500 * time.Millisecond)
			if err := exec.Command("open", browserURL(cfg.Bind)).Start(); err != nil {
				logger.Warn("failed to open browser", "err", err)
			}
		}()
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("shutting down...")

	cancel()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	httpSrv.Shutdown(shutCtx)
}

func browserURL(bind string) string {
	host := bind
	if idx := strings.LastIndex(bind, ":"); idx >= 0 {
		host = bind[idx+1:]
	}
	if host == "" {
		host = "8100"
	}
	return "http://127.0.0.1:" + host
}

