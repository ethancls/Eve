package config

import (
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Bind                 string
	UIUsername           string
	UIPassword           string
	SessionTTL           time.Duration
	JWTSecret            string
	ContainerBinary      string
	ContainerTimeout     time.Duration
	ContainerConcurrency int
	InstancesCacheTTL    time.Duration
	PollInterval         time.Duration
	DBPath               string
	ActivityRetention    int
	LogLevel             slog.Level
	LogFormat            string
	FrontendDir          string
	ProjectsDir          string
}

func Load() Config {
	c := Config{
		Bind:                 getEnv("EVE_BIND", "0.0.0.0:8100"),
		UIUsername:           getEnv("EVE_UI_USERNAME", "admin"),
		UIPassword:           getEnv("EVE_UI_PASSWORD", ""),
		SessionTTL:           getDuration("EVE_SESSION_TTL", 24*time.Hour),
		JWTSecret:            getEnv("EVE_JWT_SECRET", "eve-dev-secret-change-me"),
		ContainerBinary:      getEnv("EVE_CONTAINER_BINARY", "container"),
		ContainerTimeout:     getDuration("EVE_CONTAINER_TIMEOUT", 45*time.Second),
		ContainerConcurrency: getInt("EVE_CONTAINER_CONCURRENCY", 6),
		InstancesCacheTTL:    getDuration("EVE_INSTANCES_CACHE_TTL", 2*time.Second),
		PollInterval:         getDuration("EVE_POLL_INTERVAL", 5*time.Second),
		DBPath:               getEnv("EVE_DB_PATH", "eve.db"),
		ActivityRetention:    getInt("EVE_ACTIVITY_RETENTION", 5000),
		LogFormat:            getEnv("EVE_LOG_FORMAT", "text"),
		FrontendDir:          getEnv("EVE_FRONTEND_DIR", ""),
		ProjectsDir:          getEnv("EVE_PROJECTS_DIR", "projects"),
	}

	levelStr := getEnv("EVE_LOG_LEVEL", "info")
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
	if strings.TrimSpace(c.JWTSecret) == "" {
		c.JWTSecret = "vap0r-dev-secret-change-me"
	}

	return c
}

func getEnv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
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
