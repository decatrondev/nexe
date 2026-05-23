package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/decatrondev/nexe/services/voice/config"
	"github.com/decatrondev/nexe/services/voice/internal/database"
	"github.com/decatrondev/nexe/services/voice/internal/handler"
	"github.com/decatrondev/nexe/services/voice/internal/middleware"
	"github.com/decatrondev/nexe/services/voice/internal/service"
	"github.com/getsentry/sentry-go"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"time"
)

func main() {
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel(),
	}))
	slog.SetDefault(logger)

	if cfg.SentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn: cfg.SentryDSN,
			Environment: cfg.Env,
			Release: "nexe-voice@0.5.9",
		}); err != nil {
			slog.Error("sentry init failed", "error", err)
		} else {
			slog.Info("sentry enabled")
			defer sentry.Flush(2 * time.Second)
		}
	}

	rdb, err := database.NewRedis(cfg.RedisUrl)
	if err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	eventPublisher := service.NewEventPublisher(rdb)
	voiceSvc := service.NewVoiceService(rdb, eventPublisher, cfg.LiveKitHost, cfg.LiveKitPublicURL, cfg.LiveKitAPIKey, cfg.LiveKitSecret, cfg.GuildsURL)
	voiceHandler := handler.NewVoiceHandler(voiceSvc)

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"voice"}`))
	})
	mux.Handle("GET /metrics", promhttp.Handler())

	voiceHandler.RegisterRoutes(mux)

	addr := ":" + cfg.Port
	slog.Info("voice starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, middleware.Metrics(mux)); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
