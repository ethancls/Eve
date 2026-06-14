package config

import (
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// From env
	Bind                 string
	JWTSecret            string
	DBPath               string
	DefaultOwnerLogin    string
	DefaultOwnerPassword string
	DefaultOwnerName     string
	LogLevel             slog.Level

	// Fixed sensible defaults
	UIUsername  string
	UIPassword  string
	FrontendDir string
	ProjectsDir string
	AppURL      string
}

func Load() Config {
	c := Config{
		Bind:                 getEnv("EVE_BIND", "0.0.0.0:8100"),
		JWTSecret:            getEnv("EVE_JWT_SECRET", "eve-dev-secret-change-me"),
		DBPath:               getEnv("EVE_DB_PATH", "eve.db"),
		DefaultOwnerLogin:    getEnv("EVE_DEFAULT_OWNER_LOGIN", ""),
		DefaultOwnerPassword: getEnv("EVE_DEFAULT_OWNER_PASSWORD", ""),
		DefaultOwnerName:     getEnv("EVE_DEFAULT_OWNER_NAME", ""),
		UIUsername:            getEnv("EVE_UI_USERNAME", ""),
		UIPassword:            getEnv("EVE_UI_PASSWORD", ""),
		FrontendDir:           getEnv("EVE_FRONTEND_DIR", ""),
		ProjectsDir:           getEnv("EVE_PROJECTS_DIR", "projects"),
		AppURL:                getEnv("EVE_APP_URL", ""),
	}

	levelStr := strings.ToLower(getEnv("EVE_LOG_LEVEL", "info"))
	switch levelStr {
	case "debug":
		c.LogLevel = slog.LevelDebug
	case "warn", "warning":
		c.LogLevel = slog.LevelWarn
	case "error":
		c.LogLevel = slog.LevelError
	default:
		c.LogLevel = slog.LevelInfo
	}

	return c
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); strings.TrimSpace(v) != "" {
		return v
	}
	return def
}

func getDuration(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}

func getInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return def
	}
	return n
}
