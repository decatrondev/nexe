package config

import (
	"log/slog"
	"os"
)

type Config struct {
	Env      string
	Port     string
	DBUrl    string
	RedisUrl string
}

func Load() *Config {
	return &Config{
		Env:      getEnv("NEXE_ENV", "development"),
		Port:     getEnv("NEXE_MESSAGING_PORT", "8083"),
		DBUrl:    getEnv("NEXE_DB_URL", "postgresql://decatron_user:lfIEcCZ11kIEM573mA0PA@localhost:5432/nexe_dev?sslmode=disable"),
		RedisUrl: getEnv("NEXE_REDIS_URL", "redis://localhost:6379/3"),
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
