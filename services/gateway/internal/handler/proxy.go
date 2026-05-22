package handler

import (
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
)

type ProxyHandler struct {
	guildsURL        string
	messagingURL     string
	presenceURL      string
	voiceURL         string
	notificationsURL string
	tiers            *repository.TierRepository
}

func NewProxyHandler(guildsURL, messagingURL, presenceURL, voiceURL, notificationsURL string, tiers *repository.TierRepository) *ProxyHandler {
	return &ProxyHandler{
		guildsURL:        guildsURL,
		messagingURL:     messagingURL,
		presenceURL:      presenceURL,
		voiceURL:         voiceURL,
		notificationsURL: notificationsURL,
		tiers:            tiers,
	}
}

func (h *ProxyHandler) ProxyGuilds(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, h.guildsURL)
}

func (h *ProxyHandler) ProxyMessaging(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, h.messagingURL)
}

func (h *ProxyHandler) ProxyPresence(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, h.presenceURL)
}

func (h *ProxyHandler) ProxyVoice(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, h.voiceURL)
}

func (h *ProxyHandler) ProxyNotifications(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, h.notificationsURL)
}

func (h *ProxyHandler) proxy(w http.ResponseWriter, r *http.Request, targetBase string) {
	targetURL := targetBase + r.URL.Path
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "proxy_error", "failed to create proxy request")
		return
	}

	// Copy content type
	proxyReq.Header.Set("Content-Type", r.Header.Get("Content-Type"))

	// Forward user ID + tier from JWT claims
	claims := middleware.GetClaims(r)
	if claims != nil {
		proxyReq.Header.Set("X-User-ID", claims.Subject)
		proxyReq.Header.Set("X-Username", claims.Username)

		// Inject tier limits for downstream services
		tier, _ := h.tiers.GetUserTier(r.Context(), claims.Subject)
		proxyReq.Header.Set("X-User-Tier", tier)
		if limits, err := h.tiers.GetLimits(r.Context(), tier); err == nil {
			proxyReq.Header.Set("X-Tier-Max-Message-Length", strconv.Itoa(limits.MaxMessageLength))
			proxyReq.Header.Set("X-Tier-Max-Upload-Bytes", strconv.FormatInt(limits.MaxUploadBytes, 10))
			proxyReq.Header.Set("X-Tier-Max-Emojis", strconv.Itoa(limits.MaxEmojisPerGuild))
			proxyReq.Header.Set("X-Tier-Max-Stickers", strconv.Itoa(limits.MaxStickersPerGuild))
			proxyReq.Header.Set("X-Tier-Max-Owned-Guilds", strconv.Itoa(limits.MaxOwnedGuilds))
			proxyReq.Header.Set("X-Tier-Voice-Bitrate", strconv.Itoa(limits.VoiceBitrate))
			proxyReq.Header.Set("X-Tier-Screen-Share-Quality", limits.ScreenShareQuality)
		}
	}

	resp, err := http.DefaultClient.Do(proxyReq)
	if err != nil {
		slog.Error("proxy failed", "target", targetURL, "error", err)
		writeError(w, http.StatusBadGateway, "proxy_error", "service unavailable")
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for k, v := range resp.Header {
		w.Header()[k] = v
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
