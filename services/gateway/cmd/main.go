package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/decatrondev/nexe/services/gateway/config"
	"github.com/decatrondev/nexe/services/gateway/internal/cache"
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

	// Sentry error tracking
	if cfg.SentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              cfg.SentryDSN,
			Environment:      cfg.Env,
			Release:          "nexe-gateway@0.5.8",
			TracesSampleRate: 0.1,
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
		slog.Error("failed to connect to PostgreSQL", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Auto-run pending migrations
	if err := database.AutoMigrate(db); err != nil {
		slog.Error("migration failed", "error", err)
		os.Exit(1)
	}

	rdb, err := database.NewRedis(cfg.RedisUrl)
	if err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	// Cache layer
	redisCache := cache.New(rdb, 5*time.Minute)

	// Repositories
	userRepo := repository.NewUserRepository(db)
	userRepo.SetCache(redisCache)
	sessionRepo := repository.NewSessionRepository(db)
	verificationRepo := repository.NewVerificationRepository(db)
	profileRepo := repository.NewProfileRepository(db)
	botRepo := repository.NewBotRepository(db)

	// Services
	jwtSvc := service.NewJWTService(cfg.JWTSecret, 7*24*time.Hour, 30*24*time.Hour)
	emailSvc := service.NewEmailService(cfg.ResendAPIKey, cfg.EmailFrom)
	authSvc := service.NewAuthService(userRepo, sessionRepo, verificationRepo, jwtSvc, emailSvc)
	twitchSvc := service.NewTwitchService(cfg.TwitchClientID, cfg.TwitchClientSecret, cfg.TwitchRedirectURI)

	// Storage — use R2 if configured, fallback to local
	var storageSvc service.Storage
	if cfg.R2Endpoint != "" && cfg.R2AccessKeyID != "" {
		r2, err := service.NewR2Storage(cfg.R2Endpoint, cfg.R2AccessKeyID, cfg.R2SecretAccessKey, cfg.R2Bucket, cfg.R2PublicURL)
		if err != nil {
			slog.Error("failed to init R2 storage, falling back to local", "error", err)
			storageSvc = service.NewLocalStorage(cfg.UploadPath, cfg.UploadURL)
		} else {
			storageSvc = r2
			slog.Info("using R2 storage", "bucket", cfg.R2Bucket)
		}
	} else {
		storageSvc = service.NewLocalStorage(cfg.UploadPath, cfg.UploadURL)
		slog.Info("using local storage", "path", cfg.UploadPath)
	}

	// Handlers
	authHandler := handler.NewAuthHandler(authSvc, rdb, profileRepo)
	wsHandler := handler.NewWSHandler(jwtSvc, rdb, cfg.GuildsURL, cfg.PresenceURL, cfg.VoiceURL)
	tierRepo := repository.NewTierRepository(db, rdb)
	profileHandler := handler.NewProfileHandler(profileRepo, tierRepo)
	uploadHandler := handler.NewUploadHandler(storageSvc, profileRepo, tierRepo)
	totpHandler := handler.NewTOTPHandler(userRepo, authSvc)
	twitchHandler := handler.NewTwitchHandler(twitchSvc, userRepo, authSvc, jwtSvc, rdb, cfg.TwitchEventSubSecret, cfg.BaseURL, cfg.FrontendURL, cfg.MessagingURL, cfg.GuildsURL, cfg.PresenceURL)
	botHandler := handler.NewBotHandler(botRepo, jwtSvc)
	proxyHandler := handler.NewProxyHandler(cfg.GuildsURL, cfg.MessagingURL, cfg.PresenceURL, cfg.VoiceURL, cfg.NotificationsURL, tierRepo)
	gifHandler := handler.NewGifHandler(cfg.GiphyAPIKey)
	kickHandler := handler.NewKickHandler(cfg.KickClientID, cfg.KickClientSecret, cfg.KickRedirectURI)
	gdprHandler := handler.NewGDPRHandler(db, userRepo, cfg.GuildsURL, cfg.MessagingURL)
	statusHandler := handler.NewStatusHandler(db, cfg.GuildsURL, cfg.MessagingURL, cfg.PresenceURL, cfg.VoiceURL, cfg.NotificationsURL)

	// Start GDPR background worker
	go gdprHandler.ProcessScheduledDeletions()

	// Start status page health checker (every 60s)
	go statusHandler.StartHealthChecker()

	// Reconcile any active streams on startup
	go twitchHandler.ReconcileStreamStatuses(context.Background())

	// Middleware
	authMiddleware := middleware.Auth(jwtSvc, rdb)
	authRateLimiter := middleware.NewRateLimiter(rdb, 10, time.Hour)   // 10 req/hr for auth
	apiRateLimiter := middleware.NewRateLimiter(rdb, 100, time.Minute) // 100 req/min for API

	// Routes
	mux := http.NewServeMux()

	// Health + Metrics
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"gateway"}`))
	})
	mux.Handle("GET /metrics", promhttp.Handler())

	// Desktop app update check (public, rate limited)
	updateHandler := handler.NewUpdateHandler(rdb, "decatrondev", "nexe")
	mux.Handle("GET /update/check", apiRateLimiter.Middleware(http.HandlerFunc(updateHandler.Check)))

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
	mux.Handle("POST /internal/activity", apiRateLimiter.Middleware(http.HandlerFunc(profileHandler.LogActivityEndpoint)))

	// Upload routes (require auth)
	mux.Handle("POST /users/@me/avatar", authMiddleware(http.HandlerFunc(uploadHandler.UploadAvatar)))
	mux.Handle("POST /users/@me/banner", authMiddleware(http.HandlerFunc(uploadHandler.UploadBanner)))
	mux.Handle("DELETE /users/@me/avatar", authMiddleware(http.HandlerFunc(uploadHandler.DeleteAvatar)))
	mux.Handle("DELETE /users/@me/banner", authMiddleware(http.HandlerFunc(uploadHandler.DeleteBanner)))
	mux.Handle("POST /upload/attachment", authMiddleware(http.HandlerFunc(uploadHandler.UploadAttachment)))

	// 2FA TOTP routes
	mux.Handle("POST /auth/2fa/enable", authMiddleware(http.HandlerFunc(totpHandler.Enable)))
	mux.Handle("POST /auth/2fa/verify", authMiddleware(http.HandlerFunc(totpHandler.Verify)))
	mux.Handle("POST /auth/2fa/disable", authMiddleware(http.HandlerFunc(totpHandler.Disable)))
	mux.Handle("POST /auth/2fa/login", apiRateLimiter.Middleware(http.HandlerFunc(totpHandler.LoginVerify)))
	mux.Handle("POST /auth/2fa/recover", apiRateLimiter.Middleware(http.HandlerFunc(totpHandler.RecoverLogin)))

	// Twitch routes
	mux.HandleFunc("GET /auth/twitch", twitchHandler.TwitchAuth)
	mux.HandleFunc("GET /auth/twitch/callback", twitchHandler.TwitchCallback)
	mux.Handle("POST /auth/twitch/device", apiRateLimiter.Middleware(http.HandlerFunc(twitchHandler.GenerateDeviceCode)))
	mux.Handle("GET /auth/twitch/device/{sessionId}", apiRateLimiter.Middleware(http.HandlerFunc(twitchHandler.CheckDeviceCodeStatus)))
	mux.HandleFunc("GET /link", twitchHandler.DeviceLinkPage)
	mux.Handle("POST /auth/twitch/link", authMiddleware(http.HandlerFunc(twitchHandler.LinkTwitch)))
	mux.Handle("DELETE /auth/twitch/link", authMiddleware(http.HandlerFunc(twitchHandler.UnlinkTwitch)))
	mux.Handle("GET /users/{id}/stream", apiRateLimiter.Middleware(http.HandlerFunc(twitchHandler.GetStreamStatus)))
	mux.Handle("POST /twitch/eventsub/setup", authMiddleware(http.HandlerFunc(twitchHandler.SetupEventSub)))
	mux.HandleFunc("POST /twitch/webhook", twitchHandler.EventSubWebhook)

	// Twitch clips by broadcaster (public, rate limited)
	mux.Handle("GET /twitch/clips/{broadcasterId}", apiRateLimiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		broadcasterID := r.PathValue("broadcasterId")
		clips, err := twitchSvc.GetClipsByBroadcaster(r.Context(), broadcasterID, 12)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{"data": []struct{}{}})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"data": clips})
	})))

	// Link unfurl (public, rate limited — no user auth needed)
	mux.Handle("GET /unfurl", apiRateLimiter.Middleware(http.HandlerFunc(handler.HandleUnfurl)))

	// Twitch clip resolve (public, rate limited — uses app token, not user auth)
	mux.Handle("GET /twitch/clip/{id}", apiRateLimiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clipID := r.PathValue("id")
		clip, err := twitchSvc.GetClip(r.Context(), clipID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"error":"clip not found"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"data": clip})
	})))

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

	// Status page (public, no auth)
	mux.HandleFunc("GET /status", statusHandler.GetStatus)
	mux.HandleFunc("GET /status/history", statusHandler.GetHistory)

	// Tier limits (public)
	mux.HandleFunc("GET /tiers", func(w http.ResponseWriter, r *http.Request) {
		tiers := make(map[string]interface{})
		for _, t := range []string{"free", "pro", "ultra"} {
			if l, err := tierRepo.GetLimits(r.Context(), t); err == nil {
				tiers[t] = l
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tiers)
	})

	// GIF search (Tenor proxy, authenticated)
	mux.Handle("GET /gifs/search", authMiddleware(http.HandlerFunc(gifHandler.SearchGifs)))
	mux.Handle("GET /gifs/trending", authMiddleware(http.HandlerFunc(gifHandler.TrendingGifs)))
	mux.Handle("GET /gifs/categories", authMiddleware(http.HandlerFunc(gifHandler.GifCategories)))

	// GDPR — account deletion, data export
	mux.Handle("DELETE /users/@me/account", authMiddleware(http.HandlerFunc(gdprHandler.ScheduleAccountDeletion)))
	mux.HandleFunc("POST /users/restore", gdprHandler.RestoreAccount) // no auth — user is disabled
	mux.Handle("GET /users/@me/account/status", authMiddleware(http.HandlerFunc(gdprHandler.GetDeletionStatus)))
	mux.Handle("GET /users/@me/export", authMiddleware(http.HandlerFunc(gdprHandler.ExportUserData)))

	// Kick integration (OAuth + API + EventSub)
	mux.Handle("GET /kick/auth", authMiddleware(http.HandlerFunc(kickHandler.GetKickAuthURL)))
	mux.Handle("POST /kick/token", authMiddleware(http.HandlerFunc(kickHandler.KickOAuthCallback)))
	mux.Handle("POST /kick/refresh", authMiddleware(http.HandlerFunc(kickHandler.RefreshKickToken)))
	mux.Handle("GET /kick/channel/{slug}", authMiddleware(http.HandlerFunc(kickHandler.GetKickChannel)))
	mux.Handle("GET /kick/live/{slug}", authMiddleware(http.HandlerFunc(kickHandler.GetKickLiveStatus)))
	mux.Handle("GET /kick/user", authMiddleware(http.HandlerFunc(kickHandler.GetKickUser)))
	mux.Handle("POST /kick/chat", authMiddleware(http.HandlerFunc(kickHandler.SendKickChatMessage)))
	mux.Handle("POST /kick/events/subscribe", authMiddleware(http.HandlerFunc(kickHandler.SubscribeKickEvents)))
	mux.Handle("GET /kick/events/subscriptions", authMiddleware(http.HandlerFunc(kickHandler.ListKickSubscriptions)))
	mux.Handle("DELETE /kick/events/subscriptions", authMiddleware(http.HandlerFunc(kickHandler.DeleteKickSubscriptions)))
	mux.HandleFunc("POST /kick/webhook", kickHandler.VerifyKickWebhook) // no auth — Kick sends webhooks

	// Server Discovery (public, auth optional for join)
	mux.Handle("GET /discover", gp)
	mux.Handle("GET /discover/categories", gp)
	mux.Handle("GET /discover/tags", gp)
	mux.Handle("GET /discover/vanity/{vanity}", gp)

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
	mux.Handle("PATCH /categories/{id}", guildsProxy(gp))
	mux.Handle("DELETE /categories/{id}", guildsProxy(gp))
	mux.Handle("PUT /guilds/{id}/categories/reorder", guildsProxy(gp))
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

	// Scheduled Events
	mux.Handle("GET /guilds/{id}/events", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/events", guildsProxy(gp))
	mux.Handle("GET /events/{id}", guildsProxy(gp))
	mux.Handle("PATCH /events/{id}", guildsProxy(gp))
	mux.Handle("DELETE /events/{id}", guildsProxy(gp))
	mux.Handle("PUT /events/{id}/rsvp", guildsProxy(gp))
	mux.Handle("DELETE /events/{id}/rsvp", guildsProxy(gp))
	mux.Handle("GET /events/{id}/rsvps", guildsProxy(gp))

	// Webhooks (management = authenticated, execution = token-based)
	mux.Handle("GET /guilds/{id}/webhooks", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/webhooks", guildsProxy(gp))
	mux.Handle("PATCH /webhooks/{id}", guildsProxy(gp))
	mux.Handle("DELETE /webhooks/{id}", guildsProxy(gp))
	mux.Handle("POST /webhooks/{id}/{token}", gp) // no auth — token-based

	// Stickers
	mux.Handle("GET /guilds/{id}/sticker-packs", guildsProxy(gp))
	mux.Handle("POST /guilds/{id}/sticker-packs", guildsProxy(gp))
	mux.Handle("DELETE /sticker-packs/{id}", guildsProxy(gp))
	mux.Handle("GET /guilds/{id}/stickers", guildsProxy(gp))
	mux.Handle("GET /sticker-packs/{id}/stickers", guildsProxy(gp))
	mux.Handle("POST /sticker-packs/{id}/stickers", guildsProxy(gp))
	mux.Handle("DELETE /stickers/{id}", guildsProxy(gp))

	// Relationships (friends)
	mux.Handle("GET /relationships", guildsProxy(gp))
	mux.Handle("POST /relationships", guildsProxy(gp))
	mux.Handle("PATCH /relationships/{id}", guildsProxy(gp))
	mux.Handle("DELETE /relationships/{id}", guildsProxy(gp))
	mux.Handle("GET /relationships/mutual/{userId}", guildsProxy(gp))

	// Privacy
	mux.Handle("GET /privacy", guildsProxy(gp))
	mux.Handle("PUT /privacy", guildsProxy(gp))
	mux.Handle("GET /guilds/{guildId}/dm-toggle", guildsProxy(gp))
	mux.Handle("PUT /guilds/{guildId}/dm-toggle", guildsProxy(gp))

	// DMs
	mux.Handle("POST /dm-channels", guildsProxy(gp))
	mux.Handle("GET /dm-channels", guildsProxy(gp))
	mux.Handle("GET /dm-channels/{id}", guildsProxy(gp))
	mux.Handle("PATCH /dm-channels/{id}", guildsProxy(gp))
	mux.Handle("DELETE /dm-channels/{id}", guildsProxy(gp))
	mux.Handle("PUT /dm-channels/{id}/members/{userId}", guildsProxy(gp))
	mux.Handle("DELETE /dm-channels/{id}/members/{userId}", guildsProxy(gp))
	mux.Handle("DELETE /dm-channels/{id}/members/@me", guildsProxy(gp))
	mux.Handle("GET /dm-channels/{id}/messages", guildsProxy(gp))
	mux.Handle("GET /dm-channels/{id}/search", guildsProxy(gp))
	mux.Handle("POST /dm-channels/{id}/messages", guildsProxy(gp))
	mux.Handle("PATCH /dm-messages/{id}", guildsProxy(gp))
	mux.Handle("DELETE /dm-messages/{id}", guildsProxy(gp))
	mux.Handle("PUT /dm-messages/{id}/reactions/{emoji}/@me", guildsProxy(gp))
	mux.Handle("DELETE /dm-messages/{id}/reactions/{emoji}/@me", guildsProxy(gp))
	mux.Handle("GET /dm-messages/{id}/reactions", guildsProxy(gp))
	mux.Handle("POST /dm-channels/{id}/typing", guildsProxy(gp))
	mux.Handle("POST /dm-channels/{id}/ack", guildsProxy(gp))
	mux.Handle("GET /dm-unreads", guildsProxy(gp))
	mux.Handle("PUT /dm-channels/{id}/pin", guildsProxy(gp))
	mux.Handle("DELETE /dm-channels/{id}/pin", guildsProxy(gp))
	// Extras: friend categories, scheduled messages, reminders
	mux.Handle("GET /friend-categories", guildsProxy(gp))
	mux.Handle("POST /friend-categories", guildsProxy(gp))
	mux.Handle("PATCH /friend-categories/{id}", guildsProxy(gp))
	mux.Handle("DELETE /friend-categories/{id}", guildsProxy(gp))
	mux.Handle("PUT /friend-categories/{id}/members/{userId}", guildsProxy(gp))
	mux.Handle("DELETE /friend-categories/{id}/members/{userId}", guildsProxy(gp))
	mux.Handle("GET /dm-channels/{id}/scheduled", guildsProxy(gp))
	mux.Handle("POST /dm-channels/{id}/scheduled", guildsProxy(gp))
	mux.Handle("DELETE /dm-scheduled/{id}", guildsProxy(gp))
	mux.Handle("GET /dm-reminders", guildsProxy(gp))
	mux.Handle("POST /dm-reminders", guildsProxy(gp))
	mux.Handle("DELETE /dm-reminders/{id}", guildsProxy(gp))

	mux.Handle("GET /dm-requests", guildsProxy(gp))
	mux.Handle("POST /dm-requests/{id}/accept", guildsProxy(gp))
	mux.Handle("POST /dm-requests/{id}/reject", guildsProxy(gp))

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
	mux.Handle("GET /messages/{id}/thread", guildsProxy(mp))
	mux.Handle("POST /messages/{id}/thread", guildsProxy(mp))
	mux.Handle("GET /messages/{id}/reactions", guildsProxy(mp))
	mux.Handle("PUT /messages/{id}/pin", guildsProxy(mp))
	mux.Handle("DELETE /messages/{id}/pin", guildsProxy(mp))
	mux.Handle("PUT /messages/{id}/reactions/{emoji}/@me", guildsProxy(mp))
	mux.Handle("DELETE /messages/{id}/reactions/{emoji}/@me", guildsProxy(mp))
	mux.Handle("DELETE /messages/{id}/reactions", guildsProxy(mp))
	mux.Handle("POST /channels/{id}/ack", guildsProxy(mp))
	mux.Handle("GET /users/@me/unread", guildsProxy(mp))

	// Polls (messaging service)
	mux.Handle("POST /channels/{channelId}/polls", guildsProxy(mp))
	mux.Handle("GET /polls/{id}", guildsProxy(mp))
	mux.Handle("PUT /polls/{id}/vote/{optionId}", guildsProxy(mp))
	mux.Handle("DELETE /polls/{id}/vote/{optionId}", guildsProxy(mp))
	mux.Handle("POST /polls/{id}/close", guildsProxy(mp))

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
	mux.Handle("GET /push/vapid-key", guildsProxy(np))
	mux.Handle("POST /push/subscribe", guildsProxy(np))
	mux.Handle("POST /push/unsubscribe", guildsProxy(np))

	// Proxy to voice service (authenticated)
	vp := http.HandlerFunc(proxyHandler.ProxyVoice)
	mux.Handle("POST /voice/join", guildsProxy(vp))
	mux.Handle("POST /voice/leave", guildsProxy(vp))
	mux.Handle("PATCH /voice/state", guildsProxy(vp))
	mux.Handle("PATCH /voice/streaming", guildsProxy(vp))
	mux.Handle("POST /voice/server-mute/{userId}", guildsProxy(vp))
	mux.Handle("POST /voice/move/{userId}", guildsProxy(vp))
	mux.Handle("GET /voice/state/@me", guildsProxy(vp))
	mux.Handle("GET /voice/channel/{channelId}/participants", guildsProxy(vp))
	mux.Handle("GET /voice/guild/{guildId}/states", guildsProxy(vp))

	// DM Voice/Video Calls
	mux.Handle("POST /voice/dm/call", guildsProxy(vp))
	mux.Handle("POST /voice/dm/accept", guildsProxy(vp))
	mux.Handle("POST /voice/dm/reject", guildsProxy(vp))
	mux.Handle("POST /voice/dm/end", guildsProxy(vp))

	// WebSocket
	mux.HandleFunc("GET /ws", wsHandler.HandleWS)

	// Start Redis event subscribers for real-time broadcasting
	go wsHandler.StartRedisSubscriber(context.Background())
	go wsHandler.StartNotificationSubscriber(context.Background())
	go twitchHandler.StartGuildMemberSubscriber(context.Background())
	go twitchHandler.StartPeriodicSync(context.Background(), 10*time.Minute)

	// CORS middleware
	corsHandler := corsMiddleware(mux, cfg.FrontendURL)

	// Wrap with metrics + Sentry panic recovery
	metricsHandler := middleware.Metrics(corsHandler)
	sentryHandler := sentryhttp.New(sentryhttp.Options{Repanic: true})
	finalHandler := sentryHandler.Handle(metricsHandler)

	addr := ":" + cfg.Port
	slog.Info("gateway starting", "addr", addr, "env", cfg.Env)

	if err := http.ListenAndServe(addr, finalHandler); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func corsMiddleware(next http.Handler, frontendURL string) http.Handler {
	allowed := map[string]bool{
		frontendURL:                          true,
		"http://localhost:1420":              true,
		"http://localhost:3013":              true,
		"https://tauri.localhost":            true,
		"http://tauri.localhost":             true,
		"https://statusnexe.decatron.net":   true,
		"null":                              true, // WebKitGTK (Linux Tauri) sends "null" origin
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		// Tauri on Linux (WebKitGTK) may send no Origin header at all
		if origin == "" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}
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
