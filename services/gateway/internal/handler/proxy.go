package handler

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
)

type ProxyHandler struct {
	guildsURL    string
	messagingURL string
	presenceURL  string
	voiceURL     string
}

func NewProxyHandler(guildsURL, messagingURL, presenceURL, voiceURL string) *ProxyHandler {
	return &ProxyHandler{
		guildsURL:    guildsURL,
		messagingURL: messagingURL,
		presenceURL:  presenceURL,
		voiceURL:     voiceURL,
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

	// Forward user ID from JWT claims
	claims := middleware.GetClaims(r)
	if claims != nil {
		proxyReq.Header.Set("X-User-ID", claims.Subject)
		proxyReq.Header.Set("X-Username", claims.Username)
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
