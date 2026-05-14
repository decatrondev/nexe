package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/decatrondev/nexe/services/guilds/config"
	"github.com/decatrondev/nexe/services/guilds/internal/database"
	"github.com/decatrondev/nexe/services/guilds/internal/handler"
	"github.com/decatrondev/nexe/services/guilds/internal/repository"
	"github.com/decatrondev/nexe/services/guilds/internal/service"
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
	guildRepo := repository.NewGuildRepository(db)
	channelRepo := repository.NewChannelRepository(db)
	categoryRepo := repository.NewCategoryRepository(db)
	roleRepo := repository.NewRoleRepository(db)
	memberRepo := repository.NewMemberRepository(db)
	inviteRepo := repository.NewInviteRepository(db)
	moderationRepo := repository.NewModerationRepository(db)
	automodRepo := repository.NewAutomodRepository(db)
	overrideRepo := repository.NewOverrideRepository(db)

	// Event publisher (Redis pub/sub for real-time broadcasting via gateway)
	eventPublisher := service.NewEventPublisher(rdb)

	// Service
	guildService := service.NewGuildService(
		guildRepo, channelRepo, categoryRepo, roleRepo,
		memberRepo, inviteRepo, moderationRepo, automodRepo, eventPublisher, rdb,
	)

	// Handler
	guildHandler := handler.NewGuildHandler(guildService, automodRepo, overrideRepo, rdb)
	emoteHandler := handler.NewEmoteHandler(guildService, rdb, db)

	// Router
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"guilds"}`))
	})

	guildHandler.RegisterRoutes(mux)
	mux.HandleFunc("GET /guilds/{id}/emotes", emoteHandler.GetEmotes)
	mux.HandleFunc("POST /guilds/{id}/emotes/validate", emoteHandler.ValidateEmotes)

	// Periodic cleanup of expired invites
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			<-ticker.C
			n, err := inviteRepo.DeleteExpired(context.Background())
			if err != nil {
				slog.Error("invite cleanup failed", "error", err)
			} else if n > 0 {
				slog.Info("cleaned up expired invites", "count", n)
			}
		}
	}()

	addr := ":" + cfg.Port
	slog.Info("guilds starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, mux); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
