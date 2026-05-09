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
	botRepo := repository.NewBotRepository(db)

	// Services
	jwtSvc := service.NewJWTService(cfg.JWTSecret, 15*time.Minute, 7*24*time.Hour)
	emailSvc := service.NewEmailService(cfg.ResendAPIKey, cfg.EmailFrom)
	authSvc := service.NewAuthService(userRepo, sessionRepo, verificationRepo, jwtSvc, emailSvc)
	twitchSvc := service.NewTwitchService(cfg.TwitchClientID, cfg.TwitchClientSecret, cfg.TwitchRedirectURI)

	// Handlers
	authHandler := handler.NewAuthHandler(authSvc)
	wsHandler := handler.NewWSHandler(jwtSvc)
	profileHandler := handler.NewProfileHandler(profileRepo)
	twitchHandler := handler.NewTwitchHandler(twitchSvc, userRepo, authSvc, jwtSvc, rdb, cfg.TwitchEventSubSecret, cfg.BaseURL)
	botHandler := handler.NewBotHandler(botRepo, jwtSvc)
	proxyHandler := handler.NewProxyHandler(cfg.GuildsURL, cfg.MessagingURL, cfg.PresenceURL)

	// Middleware
	authMiddleware := middleware.Auth(jwtSvc)
	authRateLimiter := middleware.NewRateLimiter(rdb, 50, time.Hour)   // 50 req/hr for auth
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

	// Twitch routes
	mux.HandleFunc("GET /auth/twitch", twitchHandler.TwitchAuth)
	mux.HandleFunc("GET /auth/twitch/callback", twitchHandler.TwitchCallback)
	mux.Handle("POST /auth/twitch/link", authMiddleware(http.HandlerFunc(twitchHandler.LinkTwitch)))
	mux.Handle("DELETE /auth/twitch/link", authMiddleware(http.HandlerFunc(twitchHandler.UnlinkTwitch)))
	mux.Handle("GET /users/{id}/stream", apiRateLimiter.Middleware(http.HandlerFunc(twitchHandler.GetStreamStatus)))
	mux.Handle("POST /twitch/eventsub/setup", authMiddleware(http.HandlerFunc(twitchHandler.SetupEventSub)))
	mux.HandleFunc("POST /twitch/webhook", twitchHandler.EventSubWebhook)

	// Bot API / Developer routes
	mux.Handle("POST /api/v1/applications", authMiddleware(http.HandlerFunc(botHandler.CreateApp)))
	mux.Handle("GET /api/v1/applications", authMiddleware(http.HandlerFunc(botHandler.ListApps)))
	mux.Handle("GET /api/v1/applications/{id}", authMiddleware(http.HandlerFunc(botHandler.GetApp)))
	mux.Handle("PATCH /api/v1/applications/{id}", authMiddleware(http.HandlerFunc(botHandler.UpdateApp)))
	mux.Handle("DELETE /api/v1/applications/{id}", authMiddleware(http.HandlerFunc(botHandler.DeleteApp)))
	mux.Handle("POST /api/v1/applications/{id}/reset-secret", authMiddleware(http.HandlerFunc(botHandler.ResetSecret)))
	mux.Handle("POST /api/v1/oauth2/token", apiRateLimiter.Middleware(http.HandlerFunc(botHandler.TokenExchange)))
	mux.HandleFunc("GET /api/v1/scopes", botHandler.ListScopes)

	// Proxy to internal services (authenticated)
	mux.Handle("GET /guilds/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("POST /guilds/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("POST /guilds", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("PATCH /guilds/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("DELETE /guilds/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("PUT /guilds/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("GET /channels/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyMessaging)))
	mux.Handle("POST /channels/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyMessaging)))
	mux.Handle("GET /messages/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyMessaging)))
	mux.Handle("PATCH /messages/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyMessaging)))
	mux.Handle("DELETE /messages/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyMessaging)))
	mux.Handle("PUT /messages/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyMessaging)))
	mux.Handle("POST /invites/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("GET /invites/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("GET /roles/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("PATCH /roles/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))
	mux.Handle("DELETE /roles/", authMiddleware(http.HandlerFunc(proxyHandler.ProxyGuilds)))

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
