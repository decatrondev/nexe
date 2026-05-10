package config

import (
	"log/slog"
	"os"
)

type Config struct {
	Env                  string
	Port                 string
	DBUrl                string
	RedisUrl             string
	JWTSecret            string
	TwitchClientID       string
	TwitchClientSecret   string
	TwitchRedirectURI    string
	TwitchEventSubSecret string
	BaseURL              string
	ResendAPIKey         string
	EmailFrom            string
	GuildsURL            string
	MessagingURL         string
	PresenceURL          string
	VoiceURL             string
	NotificationsURL     string
	FrontendURL          string
}

func Load() *Config {
	return &Config{
		Env:                  getEnv("NEXE_ENV", "development"),
		Port:                 getEnv("NEXE_GATEWAY_PORT", "8090"),
		DBUrl:                getEnv("NEXE_DB_URL", "postgresql://decatron_user:lfIEcCZ11kIEM573mA0PA@localhost:5432/nexe_dev?sslmode=disable"),
		RedisUrl:             getEnv("NEXE_REDIS_URL", "redis://localhost:6379/3"),
		JWTSecret:            getEnv("NEXE_JWT_SECRET", "nexe-dev-secret-change-in-production"),
		TwitchClientID:       getEnv("NEXE_TWITCH_CLIENT_ID", ""),
		TwitchClientSecret:   getEnv("NEXE_TWITCH_CLIENT_SECRET", ""),
		TwitchRedirectURI:    getEnv("NEXE_TWITCH_REDIRECT_URI", "https://api.nexe.decatron.net/auth/twitch/callback"),
		TwitchEventSubSecret: getEnv("NEXE_TWITCH_EVENTSUB_SECRET", "nexe-eventsub-secret"),
		BaseURL:              getEnv("NEXE_BASE_URL", "https://api.nexe.decatron.net"),
		ResendAPIKey:         getEnv("RESEND_API_KEY", ""),
		EmailFrom:            getEnv("NEXE_EMAIL_FROM", "Nexe <nexe@decatron.net>"),
		GuildsURL:            getEnv("NEXE_GUILDS_URL", "http://localhost:8082"),
		MessagingURL:         getEnv("NEXE_MESSAGING_URL", "http://localhost:8083"),
		PresenceURL:          getEnv("NEXE_PRESENCE_URL", "http://localhost:8084"),
		VoiceURL:             getEnv("NEXE_VOICE_URL", "http://localhost:8085"),
		NotificationsURL:     getEnv("NEXE_NOTIFICATIONS_URL", "http://localhost:8086"),
		FrontendURL:          getEnv("NEXE_FRONTEND_URL", "https://nexeapp.decatron.net"),
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
