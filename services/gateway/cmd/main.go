package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/decatrondev/nexe/services/gateway/config"
	"github.com/decatrondev/nexe/services/gateway/internal/database"
	"github.com/decatrondev/nexe/services/gateway/internal/handler"
	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
	"github.com/decatrondev/nexe/services/gateway/internal/service"
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
		slog.Error("failed to connect to PostgreSQL", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	rdb, err := database.NewRedis(cfg.RedisUrl)
	if err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	// Repositories
	userRepo := repository.NewUserRepository(db)
	sessionRepo := repository.NewSessionRepository(db)
	verificationRepo := repository.NewVerificationRepository(db)
	profileRepo := repository.NewProfileRepository(db)

	// Services
	jwtSvc := service.NewJWTService(cfg.JWTSecret, 15*time.Minute, 7*24*time.Hour)
	authSvc := service.NewAuthService(userRepo, sessionRepo, verificationRepo, jwtSvc)

	// Handlers
	authHandler := handler.NewAuthHandler(authSvc)
	wsHandler := handler.NewWSHandler(jwtSvc)
	profileHandler := handler.NewProfileHandler(profileRepo)

	// Middleware
	authMiddleware := middleware.Auth(jwtSvc)
	authRateLimiter := middleware.NewRateLimiter(rdb, 5, time.Hour)    // 5 req/hr for auth
	apiRateLimiter := middleware.NewRateLimiter(rdb, 100, time.Minute) // 100 req/min for API

	// Routes
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"gateway"}`))
	})

	// Auth routes (rate limited, no auth required)
	mux.Handle("POST /auth/register", authRateLimiter.Middleware(http.HandlerFunc(authHandler.Register)))
	mux.Handle("POST /auth/verify-email", authRateLimiter.Middleware(http.HandlerFunc(authHandler.VerifyEmail)))
	mux.Handle("POST /auth/login", authRateLimiter.Middleware(http.HandlerFunc(authHandler.Login)))
	mux.Handle("POST /auth/refresh", apiRateLimiter.Middleware(http.HandlerFunc(authHandler.Refresh)))
	mux.Handle("POST /auth/resend-verification", authRateLimiter.Middleware(http.HandlerFunc(authHandler.ResendVerification)))

	// Auth routes (require auth)
	mux.Handle("POST /auth/logout", authMiddleware(http.HandlerFunc(authHandler.Logout)))
	mux.Handle("POST /auth/logout-all", authMiddleware(http.HandlerFunc(authHandler.LogoutAll)))
	mux.Handle("GET /auth/sessions", authMiddleware(http.HandlerFunc(authHandler.Sessions)))
	mux.Handle("GET /users/@me", authMiddleware(http.HandlerFunc(authHandler.Me)))

	// Profile routes
	mux.Handle("GET /users/{id}/profile", authMiddleware(http.HandlerFunc(profileHandler.GetProfile)))
	mux.Handle("PATCH /users/@me/profile", authMiddleware(http.HandlerFunc(profileHandler.UpdateProfile)))
	mux.Handle("GET /users/{id}/badges", authMiddleware(http.HandlerFunc(profileHandler.GetBadges)))
	mux.Handle("GET /users/{id}/activity", authMiddleware(http.HandlerFunc(profileHandler.GetActivity)))
	mux.Handle("POST /internal/xp", apiRateLimiter.Middleware(http.HandlerFunc(profileHandler.AddXP)))

	// WebSocket
	mux.HandleFunc("GET /ws", wsHandler.HandleWS)

	// CORS middleware
	corsHandler := corsMiddleware(mux)

	addr := ":" + cfg.Port
	slog.Info("gateway starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, corsHandler); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*") // TODO: restrict in production
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
