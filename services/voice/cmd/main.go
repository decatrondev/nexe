package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/decatrondev/nexe/services/voice/config"
	"github.com/decatrondev/nexe/services/voice/internal/database"
	"github.com/decatrondev/nexe/services/voice/internal/handler"
	"github.com/decatrondev/nexe/services/voice/internal/service"
)

func main() {
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel(),
	}))
	slog.SetDefault(logger)

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

	voiceHandler.RegisterRoutes(mux)

	addr := ":" + cfg.Port
	slog.Info("voice starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, mux); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
