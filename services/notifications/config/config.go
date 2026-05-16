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
	GuildsURL    string
	ResendAPIKey string
	EmailFrom    string
}

func Load() *Config {
	return &Config{
		Env:          getEnv("NEXE_ENV", "development"),
		Port:         getEnv("NEXE_NOTIFICATIONS_PORT", "8086"),
		DBUrl:        getEnv("NEXE_DB_URL", "postgresql://decatron_user:lfIEcCZ11kIEM573mA0PA@localhost:5432/nexe_dev?sslmode=disable"),
		RedisUrl:     getEnv("NEXE_REDIS_URL", "redis://localhost:6379/3"),
		MessagingURL: getEnv("NEXE_MESSAGING_URL", "http://localhost:8083"),
		GuildsURL:    getEnv("NEXE_GUILDS_URL", "http://localhost:8082"),
		ResendAPIKey: getEnv("RESEND_API_KEY", ""),
		EmailFrom:    getEnv("NEXE_EMAIL_FROM", "Nexe <nexe@decatron.net>"),
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
