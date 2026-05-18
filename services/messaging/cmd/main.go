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

	// Handler
	messageHandler := handler.NewMessageHandler(messageSvc)
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

	addr := ":" + cfg.Port
	slog.Info("messaging starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, middleware.Metrics(mux)); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
