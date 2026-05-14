package config

import (
	"log/slog"
	"os"
)

type Config struct {
	Env          string
	Port         string
	DBUrl        string
	RedisUrl     string
	MessagingURL string
}

func Load() *Config {
	return &Config{
		Env:          getEnv("NEXE_ENV", "development"),
		Port:         getEnv("NEXE_GUILDS_PORT", "8082"),
		DBUrl:        getEnv("NEXE_DB_URL", "postgresql://decatron_user:lfIEcCZ11kIEM573mA0PA@localhost:5432/nexe_dev?sslmode=disable"),
		RedisUrl:     getEnv("NEXE_REDIS_URL", "redis://localhost:6379/3"),
		MessagingURL: getEnv("NEXE_MESSAGING_URL", "http://localhost:8083"),
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
