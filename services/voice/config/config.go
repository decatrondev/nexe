package config

import (
	"log/slog"
	"os"
)

type Config struct {
	Env             string
	Port            string
	RedisUrl        string
	LiveKitHost     string
	LiveKitPublicURL string
	LiveKitAPIKey   string
	LiveKitSecret   string
	GuildsURL       string
}

func Load() *Config {
	return &Config{
		Env:           getEnv("NEXE_ENV", "development"),
		Port:          getEnv("NEXE_VOICE_PORT", "8085"),
		RedisUrl:      getEnv("NEXE_REDIS_URL", "redis://localhost:6379/3"),
		LiveKitHost:      getEnv("NEXE_LIVEKIT_HOST", "http://localhost:7880"),
		LiveKitPublicURL: getEnv("NEXE_LIVEKIT_PUBLIC_URL", "wss://nexelk.decatron.net"),
		LiveKitAPIKey:    getEnv("NEXE_LIVEKIT_API_KEY", ""),
		LiveKitSecret:    getEnv("NEXE_LIVEKIT_API_SECRET", ""),
		GuildsURL:     getEnv("NEXE_GUILDS_URL", "http://localhost:8082"),
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
