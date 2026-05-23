package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/decatrondev/nexe/services/notifications/config"
	"github.com/decatrondev/nexe/services/notifications/internal/database"
	"github.com/decatrondev/nexe/services/notifications/internal/handler"
	"github.com/decatrondev/nexe/services/notifications/internal/middleware"
	"github.com/decatrondev/nexe/services/notifications/internal/repository"
	"github.com/decatrondev/nexe/services/notifications/internal/service"
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
			Release: "nexe-notifications@0.5.9",
		}); err != nil {
			slog.Error("sentry init failed", "error", err)
		} else {
			slog.Info("sentry enabled")
			defer sentry.Flush(2 * time.Second)
		}
	}

	db, err := database.NewPostgres(cfg.DBUrl)
	if err != nil {
		slog.Error("failed to connect to postgres", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := database.AutoMigrate(db); err != nil {
		slog.Error("migration failed", "error", err)
		os.Exit(1)
	}

	rdb, err := database.NewRedis(cfg.RedisUrl)
	if err != nil {
		slog.Error("failed to connect to redis", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	// Repositories
	notifRepo := repository.NewNotificationRepository(db)
	prefRepo := repository.NewPreferenceRepository(db)

	// Event publisher
	eventPublisher := service.NewEventPublisher(rdb)

	// Email service
	emailService := service.NewEmailService(cfg.ResendAPIKey, cfg.EmailFrom)

	// Push repository & service
	pushRepo := repository.NewPushRepository(db)
	var pushService *service.PushService
	if cfg.VAPIDPublicKey != "" && cfg.VAPIDPrivateKey != "" {
		pushService = service.NewPushService(pushRepo, cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDEmail)
		slog.Info("web push enabled")
	} else {
		slog.Info("web push disabled — VAPID keys not configured")
	}

	// Service
	notifService := service.NewNotificationService(notifRepo, prefRepo, eventPublisher, rdb, emailService, cfg.MessagingURL, cfg.GuildsURL)
	notifService.SetPushService(pushService)

	// Start Redis event subscriber (listens for MESSAGE_CREATE to detect mentions)
	go notifService.StartEventSubscriber(context.Background())

	// Handler
	notifHandler := handler.NewNotificationHandler(notifService, pushService)

	// Router
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"notifications"}`))
	})
	mux.Handle("GET /metrics", promhttp.Handler())

	notifHandler.RegisterRoutes(mux)

	addr := ":" + cfg.Port
	slog.Info("notifications starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, middleware.Metrics(mux)); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
