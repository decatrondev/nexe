package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/decatrondev/nexe/services/notifications/config"
	"github.com/decatrondev/nexe/services/notifications/internal/database"
	"github.com/decatrondev/nexe/services/notifications/internal/handler"
	"github.com/decatrondev/nexe/services/notifications/internal/repository"
	"github.com/decatrondev/nexe/services/notifications/internal/service"
)

func main() {
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel(),
	}))
	slog.SetDefault(logger)

	db, err := database.NewPostgres(cfg.DBUrl)
	if err != nil {
		slog.Error("failed to connect to postgres", "error", err)
		os.Exit(1)
	}
	defer db.Close()

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

	// Service
	notifService := service.NewNotificationService(notifRepo, prefRepo, eventPublisher, rdb, emailService, cfg.MessagingURL, cfg.GuildsURL)

	// Start Redis event subscriber (listens for MESSAGE_CREATE to detect mentions)
	go notifService.StartEventSubscriber(context.Background())

	// Handler
	notifHandler := handler.NewNotificationHandler(notifService)

	// Router
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"notifications"}`))
	})

	notifHandler.RegisterRoutes(mux)

	addr := ":" + cfg.Port
	slog.Info("notifications starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, mux); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
