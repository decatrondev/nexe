package main

import (
	"log/slog"
	"net/http"
	"os"

	pb "github.com/decatrondev/nexe/proto/guildspb"
	"github.com/decatrondev/nexe/services/messaging/config"
	"github.com/decatrondev/nexe/services/messaging/internal/database"
	"github.com/decatrondev/nexe/services/messaging/internal/handler"
	"github.com/decatrondev/nexe/services/messaging/internal/middleware"
	"github.com/decatrondev/nexe/services/messaging/internal/repository"
	"github.com/decatrondev/nexe/services/messaging/internal/service"
	"github.com/getsentry/sentry-go"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
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
			Release: "nexe-messaging@0.4.3",
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
	messageRepo := repository.NewMessageRepository(db)
	reactionRepo := repository.NewReactionRepository(db)

	// Event publisher (Redis pub/sub)
	eventPublisher := service.NewEventPublisher(rdb)

	// Service
	messageSvc := service.NewMessageService(messageRepo, reactionRepo, eventPublisher, cfg.GuildsURL)

	// Connect to guilds gRPC (port 9082)
	guildsGRPCAddr := "localhost:9082"
	grpcConn, err := grpc.NewClient(guildsGRPCAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		slog.Warn("gRPC connection to guilds failed, falling back to HTTP", "error", err)
	} else {
		defer grpcConn.Close()
		messageSvc.SetGuildsGRPC(pb.NewGuildsInternalClient(grpcConn))
		slog.Info("gRPC connected to guilds", "addr", guildsGRPCAddr)
	}

	// Repositories (polls)
	pollRepo := repository.NewPollRepository(db)

	// XP service
	xpSvc := service.NewXPService(rdb, cfg.GatewayURL)

	// Handler
	messageHandler := handler.NewMessageHandler(messageSvc, xpSvc)
	pollHandler := handler.NewPollHandler(pollRepo, messageSvc)

	// Router
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"messaging"}`))
	})
	mux.Handle("GET /metrics", promhttp.Handler())

	messageHandler.RegisterRoutes(mux)
	pollHandler.RegisterRoutes(mux)

	// Internal: GDPR anonymize user messages
	mux.HandleFunc("POST /internal/anonymize/{userId}", func(w http.ResponseWriter, r *http.Request) {
		uid := r.PathValue("userId")
		_, err := db.ExecContext(r.Context(),
			`UPDATE messages SET author_id = '00000000-0000-0000-0000-000000000000' WHERE author_id = $1`, uid)
		if err != nil {
			slog.Error("gdpr: anonymize messages failed", "userId", uid, "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		// Remove reactions by user
		db.ExecContext(r.Context(), `DELETE FROM reactions WHERE user_id = $1`, uid)
		// Remove read states
		db.ExecContext(r.Context(), `DELETE FROM read_states WHERE user_id = $1`, uid)
		slog.Info("gdpr: messages anonymized", "userId", uid)
		w.WriteHeader(http.StatusOK)
	})

	addr := ":" + cfg.Port
	slog.Info("messaging starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, middleware.Metrics(mux)); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
