package config

import (
	"log"
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
	UploadPath           string
	UploadURL            string
	R2Endpoint           string
	R2AccessKeyID        string
	R2SecretAccessKey    string
	R2Bucket             string
	R2PublicURL          string
}

func Load() *Config {
	cfg := &Config{
		Env:                  getEnv("NEXE_ENV", "development"),
		Port:                 getEnv("NEXE_GATEWAY_PORT", "8090"),
		DBUrl:                requireEnv("NEXE_DB_URL"),
		RedisUrl:             getEnv("NEXE_REDIS_URL", "redis://localhost:6379/3"),
		JWTSecret:            requireEnv("NEXE_JWT_SECRET"),
		TwitchClientID:       getEnv("NEXE_TWITCH_CLIENT_ID", ""),
		TwitchClientSecret:   getEnv("NEXE_TWITCH_CLIENT_SECRET", ""),
		TwitchRedirectURI:    getEnv("NEXE_TWITCH_REDIRECT_URI", "https://api.nexe.decatron.net/auth/twitch/callback"),
		TwitchEventSubSecret: requireEnv("NEXE_TWITCH_EVENTSUB_SECRET"),
		BaseURL:              getEnv("NEXE_BASE_URL", "https://api.nexe.decatron.net"),
		ResendAPIKey:         getEnv("RESEND_API_KEY", ""),
		EmailFrom:            getEnv("NEXE_EMAIL_FROM", "Nexe <nexe@decatron.net>"),
		GuildsURL:            getEnv("NEXE_GUILDS_URL", "http://localhost:8082"),
		MessagingURL:         getEnv("NEXE_MESSAGING_URL", "http://localhost:8083"),
		PresenceURL:          getEnv("NEXE_PRESENCE_URL", "http://localhost:8084"),
		VoiceURL:             getEnv("NEXE_VOICE_URL", "http://localhost:8085"),
		NotificationsURL:     getEnv("NEXE_NOTIFICATIONS_URL", "http://localhost:8086"),
		FrontendURL:          getEnv("NEXE_FRONTEND_URL", "https://nexeapp.decatron.net"),
		UploadPath:           getEnv("NEXE_UPLOAD_PATH", "/var/www/html/nexe/uploads"),
		UploadURL:            getEnv("NEXE_UPLOAD_URL", "https://nexeuploads.decatron.net"),
		R2Endpoint:           getEnv("NEXE_R2_ENDPOINT", ""),
		R2AccessKeyID:        getEnv("NEXE_R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:    getEnv("NEXE_R2_SECRET_ACCESS_KEY", ""),
		R2Bucket:             getEnv("NEXE_R2_BUCKET", "nexe-uploads"),
		R2PublicURL:          getEnv("NEXE_R2_PUBLIC_URL", ""),
	}
	return cfg
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

func requireEnv(key string) string {
	val := os.Getenv(key)
	if val == "" {
		log.Fatalf("FATAL: environment variable %s is required but not set", key)
	}
	return val
}
