package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/decatrondev/nexe/services/presence/config"
	"github.com/decatrondev/nexe/services/presence/internal/database"
	"github.com/decatrondev/nexe/services/presence/internal/handler"
	"github.com/decatrondev/nexe/services/presence/internal/middleware"
	"github.com/decatrondev/nexe/services/presence/internal/service"
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
			Release: "nexe-presence@0.5.8",
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

	presenceSvc := service.NewPresenceService(rdb)
	presenceHandler := handler.NewPresenceHandler(presenceSvc)

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"presence"}`))
	})
	mux.Handle("GET /metrics", promhttp.Handler())

	presenceHandler.RegisterRoutes(mux)

	addr := ":" + cfg.Port
	slog.Info("presence starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, middleware.Metrics(mux)); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
