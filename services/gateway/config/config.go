package config

import (
	"log/slog"
	"os"
)

type Config struct {
	Env       string
	Port      string
	DBUrl     string
	RedisUrl  string
	JWTSecret string
}

func Load() *Config {
	return &Config{
		Env:       getEnv("NEXE_ENV", "development"),
		Port:      getEnv("NEXE_GATEWAY_PORT", "8090"),
		DBUrl:     getEnv("NEXE_DB_URL", "postgresql://decatron_user:decatron_user@localhost:5432/nexe_dev?sslmode=disable"),
		RedisUrl:  getEnv("NEXE_REDIS_URL", "redis://localhost:6379/3"),
		JWTSecret: getEnv("NEXE_JWT_SECRET", "nexe-dev-secret-change-in-production"),
	}
}

func (c *Config) LogLevel() slog.Level {
	if c.Env == "production" {
		return slog.LevelInfo
	}
	return slog.LevelDebug
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
