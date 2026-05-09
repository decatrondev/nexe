package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/decatrondev/nexe/services/messaging/config"
	"github.com/decatrondev/nexe/services/messaging/internal/database"
	"github.com/decatrondev/nexe/services/messaging/internal/handler"
	"github.com/decatrondev/nexe/services/messaging/internal/repository"
	"github.com/decatrondev/nexe/services/messaging/internal/service"
)

func main() {
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel(),
	}))
	slog.SetDefault(logger)

	// Database connections
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
	messageRepo := repository.NewMessageRepository(db)
	reactionRepo := repository.NewReactionRepository(db)

	// Service
	messageSvc := service.NewMessageService(messageRepo, reactionRepo)

	// Handler
	messageHandler := handler.NewMessageHandler(messageSvc)

	// Router
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"messaging"}`))
	})

	messageHandler.RegisterRoutes(mux)

	addr := ":" + cfg.Port
	slog.Info("messaging starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, mux); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
