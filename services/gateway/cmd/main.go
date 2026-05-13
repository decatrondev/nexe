package main

import (
	"context"
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

	// Storage
	storageSvc := service.NewLocalStorage(cfg.UploadPath, cfg.UploadURL)

	// Handlers
	authHandler := handler.NewAuthHandler(authSvc)
	wsHandler := handler.NewWSHandler(jwtSvc, rdb, cfg.GuildsURL, cfg.PresenceURL, cfg.VoiceURL)
	profileHandler := handler.NewProfileHandler(profileRepo)
	uploadHandler := handler.NewUploadHandler(storageSvc, profileRepo)
	totpHandler := handler.NewTOTPHandler(userRepo, authSvc)
	twitchHandler := handler.NewTwitchHandler(twitchSvc, userRepo, authSvc, jwtSvc, rdb, cfg.TwitchEventSubSecret, cfg.BaseURL, cfg.FrontendURL, cfg.MessagingURL, cfg.GuildsURL, cfg.PresenceURL)
	botHandler := handler.NewBotHandler(botRepo, jwtSvc)
	proxyHandler := handler.NewProxyHandler(cfg.GuildsURL, cfg.MessagingURL, cfg.PresenceURL, cfg.VoiceURL, cfg.NotificationsURL)

	// Reconcile any active streams on startup
	go twitchHandler.ReconcileStreamStatuses(context.Background())

	// Middleware
	authMiddleware := middleware.Auth(jwtSvc)
	authRateLimiter := middleware.NewRateLimiter(rdb, 10, time.Hour)   // 10 req/hr for auth
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
	mux.Handle("POST /auth/forgot-password", authRateLimiter.Middleware(http.HandlerFunc(authHandler.ForgotPassword)))
	mux.Handle("POST /auth/reset-password", authRateLimiter.Middleware(http.HandlerFunc(authHandler.ResetPassword)))

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

	// Upload routes (require auth)
	mux.Handle("POST /users/@me/avatar", authMiddleware(http.HandlerFunc(uploadHandler.UploadAvatar)))
	mux.Handle("POST /users/@me/banner", authMiddleware(http.HandlerFunc(uploadHandler.UploadBanner)))
	mux.Handle("DELETE /users/@me/avatar", authMiddleware(http.HandlerFunc(uploadHandler.DeleteAvatar)))
	mux.Handle("DELETE /users/@me/banner", authMiddleware(http.HandlerFunc(uploadHandler.DeleteBanner)))

	// 2FA TOTP routes
	mux.Handle("POST /auth/2fa/enable", authMiddleware(http.HandlerFunc(totpHandler.Enable)))
	mux.Handle("POST /auth/2fa/verify", authMiddleware(http.HandlerFunc(totpHandler.Verify)))
	mux.Handle("POST /auth/2fa/disable", authMiddleware(http.HandlerFunc(totpHandler.Disable)))
	mux.Handle("POST /auth/2fa/login", apiRateLimiter.Middleware(http.HandlerFunc(totpHandler.LoginVerify)))
	mux.Handle("POST /auth/2fa/recover", apiRateLimiter.Middleware(http.HandlerFunc(totpHandler.RecoverLogin)))

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

	// Proxy to guilds service (authenticated)
	guildsProxy := func(h http.Handler) http.Handler { return authMiddleware(h) }
	gp := http.HandlerFunc(proxyHandler.ProxyGuilds)
	mux.Handle("GET /guilds/me", guildsProxy(gp))
	mux.Handle("POST /guilds", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}", guildsProxy(gp))
	mux.Handle("PATCH /guilds/{id}", guildsProxy(gp))
	mux.Handle("DELETE /guilds/{id}", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/channels", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/channels", guildsProxy(gp))
	mux.Handle("PATCH /channels/{id}", guildsProxy(gp))
	mux.Handle("DELETE /channels/{id}", guildsProxy(gp))
	mux.Handle("PUT /guilds/{id}/channels/reorder", guildsProxy(gp))
	mux.Handle("GET /channels/{id}/overrides", guildsProxy(gp))
	mux.Handle("PUT /channels/{id}/overrides", guildsProxy(gp))
	mux.Handle("DELETE /overrides/{id}", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/categories", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/categories", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/roles", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/roles", guildsProxy(gp))
	mux.Handle("PATCH /roles/{id}", guildsProxy(gp))
	mux.Handle("DELETE /roles/{id}", guildsProxy(gp))
	mux.Handle("PUT /guilds/{id}/members/{uid}/roles/{rid}", guildsProxy(gp))
	mux.Handle("DELETE /guilds/{id}/members/{uid}/roles/{rid}", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/join", guildsProxy(gp))
	mux.Handle("DELETE /guilds/{id}/members/@me", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/members", guildsProxy(gp))
	mux.Handle("DELETE /guilds/{id}/members/{uid}", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/invites", guildsProxy(gp))
	mux.Handle("POST /invites/{code}/use", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/invites", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/bans", guildsProxy(gp))
	mux.Handle("DELETE /guilds/{id}/bans/{uid}", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/bans", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/members/{uid}/timeout", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/members/{uid}/warn", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/audit-log", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/automod", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/automod", guildsProxy(gp))
	mux.Handle("PATCH /automod/{id}", guildsProxy(gp))
	mux.Handle("DELETE /automod/{id}", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/automod/check", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/emotes", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/emotes/validate", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/twitch/enable", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/twitch/disable", guildsProxy(gp))
	mux.Handle("PUT /guilds/{id}/members/{uid}/auto-roles/{rid}", guildsProxy(gp))
	mux.Handle("DELETE /guilds/{id}/members/{uid}/auto-roles/{rid}", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/twitch/sync", authMiddleware(http.HandlerFunc(twitchHandler.SyncTwitchRoles)))
	mux.Handle("POST /guilds/{id}/bridge", authMiddleware(http.HandlerFunc(twitchHandler.EnableBridge)))
	mux.Handle("DELETE /guilds/{id}/bridge", guildsProxy(gp))
	mux.Handle("POST /twitch/bridge/send", authMiddleware(http.HandlerFunc(twitchHandler.SendToTwitchChat)))
	mux.Handle("POST /guilds/{id}/twitch/sync-all", authMiddleware(http.HandlerFunc(twitchHandler.SyncAllMembers)))

	// Proxy to messaging service (authenticated)
	mp := http.HandlerFunc(proxyHandler.ProxyMessaging)
	mux.Handle("GET /channels/{id}/messages", guildsProxy(mp))
	mux.Handle("POST /channels/{id}/messages", guildsProxy(mp))
	mux.Handle("GET /channels/{id}/pins", guildsProxy(mp))
	mux.Handle("GET /channels/{id}/search", guildsProxy(mp))
	mux.Handle("GET /messages/{id}", guildsProxy(mp))
	mux.Handle("PATCH /messages/{id}", guildsProxy(mp))
	mux.Handle("DELETE /messages/{id}", guildsProxy(mp))
	mux.Handle("GET /messages/{id}/edits", guildsProxy(mp))
	mux.Handle("GET /messages/{id}/reactions", guildsProxy(mp))
	mux.Handle("PUT /messages/{id}/pin", guildsProxy(mp))
	mux.Handle("DELETE /messages/{id}/pin", guildsProxy(mp))
	mux.Handle("PUT /messages/{id}/reactions/{emoji}/@me", guildsProxy(mp))
	mux.Handle("DELETE /messages/{id}/reactions/{emoji}/@me", guildsProxy(mp))
	mux.Handle("DELETE /messages/{id}/reactions", guildsProxy(mp))
	mux.Handle("POST /channels/{id}/ack", guildsProxy(mp))
	mux.Handle("GET /users/@me/unread", guildsProxy(mp))

	// Proxy to presence service (authenticated)
	pp := http.HandlerFunc(proxyHandler.ProxyPresence)
	mux.Handle("GET /users/{id}/presence", guildsProxy(pp))
	mux.Handle("PATCH /users/@me/presence", authMiddleware(http.HandlerFunc(wsHandler.HandlePresenceUpdate)))
	mux.Handle("PATCH /users/@me/status", guildsProxy(pp))
	mux.Handle("POST /users/@me/heartbeat", guildsProxy(pp))
	mux.Handle("POST /users/@me/offline", guildsProxy(pp))
	mux.Handle("POST /users/{id}/stream-status", guildsProxy(pp))
	mux.Handle("GET /guilds/{id}/online", guildsProxy(pp))
	mux.Handle("POST /guilds/{id}/track", guildsProxy(pp))
	mux.Handle("POST /guilds/{id}/untrack", guildsProxy(pp))
	mux.Handle("POST /users/bulk-presence", guildsProxy(pp))
	mux.Handle("POST /guilds/live", guildsProxy(pp))

	// Proxy to notifications service (authenticated)
	np := http.HandlerFunc(proxyHandler.ProxyNotifications)
	mux.Handle("GET /notifications", guildsProxy(np))
	mux.Handle("GET /notifications/unread-count", guildsProxy(np))
	mux.Handle("POST /notifications/{id}/read", guildsProxy(np))
	mux.Handle("POST /notifications/read-all", guildsProxy(np))
	mux.Handle("DELETE /notifications/{id}", guildsProxy(np))
	mux.Handle("GET /notifications/preferences/{guildId}", guildsProxy(np))
	mux.Handle("PUT /notifications/preferences/{guildId}", guildsProxy(np))

	// Proxy to voice service (authenticated)
	vp := http.HandlerFunc(proxyHandler.ProxyVoice)
	mux.Handle("POST /voice/join", guildsProxy(vp))
	mux.Handle("POST /voice/leave", guildsProxy(vp))
	mux.Handle("PATCH /voice/state", guildsProxy(vp))
	mux.Handle("GET /voice/state/@me", guildsProxy(vp))
	mux.Handle("GET /voice/channel/{channelId}/participants", guildsProxy(vp))
	mux.Handle("GET /voice/guild/{guildId}/states", guildsProxy(vp))

	// WebSocket
	mux.HandleFunc("GET /ws", wsHandler.HandleWS)

	// Start Redis event subscribers for real-time broadcasting
	go wsHandler.StartRedisSubscriber(context.Background())
	go wsHandler.StartNotificationSubscriber(context.Background())

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
