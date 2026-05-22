package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	pb "github.com/decatrondev/nexe/proto/guildspb"
	"github.com/decatrondev/nexe/services/guilds/config"
	"github.com/decatrondev/nexe/services/guilds/internal/database"
	"github.com/decatrondev/nexe/services/guilds/internal/grpcserver"
	"github.com/decatrondev/nexe/services/guilds/internal/handler"
	"github.com/decatrondev/nexe/services/guilds/internal/middleware"
	"github.com/decatrondev/nexe/services/guilds/internal/repository"
	"github.com/decatrondev/nexe/services/guilds/internal/service"
	"github.com/getsentry/sentry-go"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
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
			Release: "nexe-guilds@0.4.3",
		}); err != nil {
			slog.Error("sentry init failed", "error", err)
		} else {
			slog.Info("sentry enabled")
			defer sentry.Flush(2 * time.Second)
		}
	}

	// Database connections
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
	guildRepo := repository.NewGuildRepository(db)
	channelRepo := repository.NewChannelRepository(db)
	categoryRepo := repository.NewCategoryRepository(db)
	roleRepo := repository.NewRoleRepository(db)
	memberRepo := repository.NewMemberRepository(db)
	inviteRepo := repository.NewInviteRepository(db)
	moderationRepo := repository.NewModerationRepository(db)
	automodRepo := repository.NewAutomodRepository(db)
	overrideRepo := repository.NewOverrideRepository(db)
	relationshipRepo := repository.NewRelationshipRepository(db)
	dmRepo := repository.NewDMRepository(db)
	privacyRepo := repository.NewPrivacyRepository(db)

	// Event publisher (Redis pub/sub for real-time broadcasting via gateway)
	eventPublisher := service.NewEventPublisher(rdb)

	// Service
	guildService := service.NewGuildService(
		guildRepo, channelRepo, categoryRepo, roleRepo,
		memberRepo, inviteRepo, moderationRepo, automodRepo, eventPublisher, rdb,
		cfg.MessagingURL,
	)

	// XP service
	xpSvc := service.NewXPService(rdb, cfg.GatewayURL)

	// Handler
	guildHandler := handler.NewGuildHandler(guildService, automodRepo, overrideRepo, rdb, xpSvc)
	emoteHandler := handler.NewEmoteHandler(guildService, rdb, db)
	relationshipHandler := handler.NewRelationshipHandler(relationshipRepo, privacyRepo, db, rdb)
	dmHandler := handler.NewDMHandler(dmRepo, privacyRepo, rdb)
	privacyHandler := handler.NewPrivacyHandler(privacyRepo)
	extrasHandler := handler.NewExtrasHandler(db, rdb)
	eventHandler := handler.NewEventHandler(db, rdb)
	webhookHandler := handler.NewWebhookHandler(db, rdb, cfg.MessagingURL)
	stickerHandler := handler.NewStickerHandler(db, rdb)

	// Router
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"guilds"}`))
	})
	mux.Handle("GET /metrics", promhttp.Handler())

	guildHandler.RegisterRoutes(mux)
	relationshipHandler.RegisterRoutes(mux)
	dmHandler.RegisterRoutes(mux)
	privacyHandler.RegisterRoutes(mux)
	extrasHandler.RegisterRoutes(mux)
	eventHandler.RegisterRoutes(mux)
	webhookHandler.RegisterRoutes(mux)
	stickerHandler.RegisterRoutes(mux)

	// Internal: GDPR anonymize user data
	mux.HandleFunc("POST /internal/anonymize/{userId}", func(w http.ResponseWriter, r *http.Request) {
		uid := r.PathValue("userId")
		// Remove from all guilds
		db.ExecContext(r.Context(), `DELETE FROM guild_members WHERE user_id = $1`, uid)
		// Remove relationships
		db.ExecContext(r.Context(), `DELETE FROM relationships WHERE user_id = $1 OR target_id = $1`, uid)
		// Anonymize DM messages
		db.ExecContext(r.Context(), `UPDATE dm_messages SET author_id = '00000000-0000-0000-0000-000000000000' WHERE author_id = $1`, uid)
		// Remove DM participants but keep channels for the other party
		db.ExecContext(r.Context(), `DELETE FROM dm_participants WHERE user_id = $1`, uid)
		// Remove privacy settings
		db.ExecContext(r.Context(), `DELETE FROM user_privacy_settings WHERE user_id = $1`, uid)
		// Remove bans (as banned user, not moderator)
		db.ExecContext(r.Context(), `DELETE FROM bans WHERE user_id = $1`, uid)
		// Remove moderation logs targeting user
		db.ExecContext(r.Context(), `DELETE FROM moderation_logs WHERE target_id = $1`, uid)
		// Remove event RSVPs
		db.ExecContext(r.Context(), `DELETE FROM guild_event_rsvps WHERE user_id = $1`, uid)
		// Remove poll votes
		slog.Info("gdpr: guilds data anonymized", "userId", uid)
		w.WriteHeader(http.StatusOK)
	})

	// Internal: get DM channel participant IDs (for voice service)
	mux.HandleFunc("GET /internal/dm-participants/{channelId}", func(w http.ResponseWriter, r *http.Request) {
		channelID := r.PathValue("channelId")
		ids, err := dmRepo.GetParticipantIDs(r.Context(), channelID)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		type p struct {
			UserID string `json:"userId"`
		}
		result := make([]p, len(ids))
		for i, id := range ids {
			result[i] = p{UserID: id}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	// Background worker for scheduled messages and reminders
	go extrasHandler.StartScheduledMessageWorker(context.Background())
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

	// Start gRPC server on port+1 (e.g., 8082 HTTP → 9082 gRPC)
	grpcAddr := ":9082"
	go func() {
		lis, err := net.Listen("tcp", grpcAddr)
		if err != nil {
			slog.Error("gRPC listen failed", "error", err)
			return
		}
		grpcSrv := grpc.NewServer()
		pb.RegisterGuildsInternalServer(grpcSrv, grpcserver.New(db))
		slog.Info("gRPC server starting", "addr", grpcAddr)
		if err := grpcSrv.Serve(lis); err != nil {
			slog.Error("gRPC server failed", "error", err)
		}
	}()

	addr := ":" + cfg.Port
	slog.Info("guilds starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, middleware.Metrics(mux)); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
