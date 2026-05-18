package handler

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// KickHandler handles Kick OAuth2.1 + API + EventSub integration.
type KickHandler struct {
	clientID     string
	clientSecret string
	redirectURI  string
	client       *http.Client
	publicKey    *rsa.PublicKey // cached Kick webhook verification key
}

func NewKickHandler(clientID, clientSecret, redirectURI string) *KickHandler {
	h := &KickHandler{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
		client:       &http.Client{Timeout: 10 * time.Second},
	}
	// Fetch public key for webhook verification on init
	go h.fetchPublicKey()
	return h
}

func (h *KickHandler) Enabled() bool {
	return h.clientID != "" && h.clientSecret != ""
}

// ---------------------------------------------------------------------------
// OAuth 2.1 (PKCE) — id.kick.com
// ---------------------------------------------------------------------------

// GetKickAuthURL returns the Kick OAuth authorization URL for the frontend to redirect to.
func (h *KickHandler) GetKickAuthURL(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "KICK_NOT_CONFIGURED", "Kick integration not configured")
		return
	}

	// Frontend sends code_challenge and state
	codeChallenge := r.URL.Query().Get("code_challenge")
	state := r.URL.Query().Get("state")
	if codeChallenge == "" || state == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "code_challenge and state required")
		return
	}

	params := url.Values{
		"client_id":             {h.clientID},
		"response_type":         {"code"},
		"redirect_uri":          {h.redirectURI},
		"state":                 {state},
		"scope":                 {"user:read channel:read events:subscribe chat:write"},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {"S256"},
	}

	authURL := "https://id.kick.com/oauth/authorize?" + params.Encode()
	writeJSON(w, http.StatusOK, map[string]string{"url": authURL})
}

// KickOAuthCallback handles the OAuth callback and exchanges the code for tokens.
func (h *KickHandler) KickOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "KICK_NOT_CONFIGURED", "Kick integration not configured")
		return
	}

	var body struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"codeVerifier"`
		RedirectURI  string `json:"redirectUri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" || body.CodeVerifier == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "code and codeVerifier required")
		return
	}

	redirectURI := h.redirectURI
	if body.RedirectURI != "" {
		redirectURI = body.RedirectURI
	}

	// Exchange code for tokens
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {body.Code},
		"client_id":     {h.clientID},
		"client_secret": {h.clientSecret},
		"redirect_uri":  {redirectURI},
		"code_verifier": {body.CodeVerifier},
	}

	resp, err := h.client.PostForm("https://id.kick.com/oauth/token", form)
	if err != nil {
		writeError(w, http.StatusBadGateway, "KICK_ERROR", "failed to exchange code")
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// RefreshKickToken refreshes a Kick access token.
func (h *KickHandler) RefreshKickToken(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "KICK_NOT_CONFIGURED", "")
		return
	}

	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "refreshToken required")
		return
	}

	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {body.RefreshToken},
		"client_id":     {h.clientID},
		"client_secret": {h.clientSecret},
	}

	resp, err := h.client.PostForm("https://id.kick.com/oauth/token", form)
	if err != nil {
		writeError(w, http.StatusBadGateway, "KICK_ERROR", "failed to refresh token")
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// ---------------------------------------------------------------------------
// Kick API proxy — api.kick.com
// ---------------------------------------------------------------------------

// GetKickChannel fetches channel info using the user's Kick token.
func (h *KickHandler) GetKickChannel(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "slug required")
		return
	}

	h.proxyKickAPI(w, r, "GET", "/public/v1/channels?slug="+url.QueryEscape(slug))
}

// GetKickLiveStatus fetches livestream status.
func (h *KickHandler) GetKickLiveStatus(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "slug required")
		return
	}

	h.proxyKickAPI(w, r, "GET", "/public/v1/channels?slug="+url.QueryEscape(slug))
}

// GetKickUser fetches user info with user token.
func (h *KickHandler) GetKickUser(w http.ResponseWriter, r *http.Request) {
	h.proxyKickAPI(w, r, "GET", "/public/v1/users")
}

// SendKickChatMessage sends a chat message via Kick.
func (h *KickHandler) SendKickChatMessage(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	h.proxyKickAPIWithBody(w, r, "POST", "/public/v1/chat", body)
}

// SubscribeKickEvents creates event subscriptions.
func (h *KickHandler) SubscribeKickEvents(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	h.proxyKickAPIWithBody(w, r, "POST", "/public/v1/events/subscriptions", body)
}

// ListKickSubscriptions lists event subscriptions.
func (h *KickHandler) ListKickSubscriptions(w http.ResponseWriter, r *http.Request) {
	h.proxyKickAPI(w, r, "GET", "/public/v1/events/subscriptions")
}

// DeleteKickSubscriptions deletes event subscriptions.
func (h *KickHandler) DeleteKickSubscriptions(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	h.proxyKickAPIWithBody(w, r, "DELETE", "/public/v1/events/subscriptions", body)
}

func (h *KickHandler) proxyKickAPI(w http.ResponseWriter, r *http.Request, method, path string) {
	h.proxyKickAPIWithBody(w, r, method, path, nil)
}

func (h *KickHandler) proxyKickAPIWithBody(w http.ResponseWriter, r *http.Request, method, path string, body []byte) {
	kickToken := r.Header.Get("X-Kick-Token")

	targetURL := "https://api.kick.com" + path
	var bodyReader io.Reader
	if body != nil {
		bodyReader = strings.NewReader(string(body))
	}

	req, err := http.NewRequestWithContext(r.Context(), method, targetURL, bodyReader)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create request")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if kickToken != "" {
		req.Header.Set("Authorization", "Bearer "+kickToken)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "KICK_ERROR", "failed to reach Kick API")
		return
	}
	defer resp.Body.Close()

	for k, v := range resp.Header {
		if strings.HasPrefix(k, "Content-") || k == "X-Ratelimit-Remaining" {
			w.Header()[k] = v
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

func (h *KickHandler) fetchPublicKey() {
	resp, err := http.Get("https://api.kick.com/public/v1/public-key")
	if err != nil {
		slog.Warn("failed to fetch Kick public key", "error", err)
		return
	}
	defer resp.Body.Close()

	var result struct {
		Data struct {
			PublicKey string `json:"public_key"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		slog.Warn("failed to parse Kick public key", "error", err)
		return
	}

	block, _ := pem.Decode([]byte(result.Data.PublicKey))
	if block == nil {
		slog.Warn("failed to decode Kick PEM")
		return
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		slog.Warn("failed to parse Kick public key", "error", err)
		return
	}

	if rsaPub, ok := pub.(*rsa.PublicKey); ok {
		h.publicKey = rsaPub
		slog.Info("Kick webhook public key loaded")
	}
}

// VerifyKickWebhook verifies and processes incoming Kick webhooks.
func (h *KickHandler) VerifyKickWebhook(w http.ResponseWriter, r *http.Request) {
	if h.publicKey == nil {
		writeError(w, http.StatusServiceUnavailable, "KICK_NOT_READY", "webhook verification not ready")
		return
	}

	body, _ := io.ReadAll(r.Body)

	messageID := r.Header.Get("Kick-Event-Message-Id")
	timestamp := r.Header.Get("Kick-Event-Message-Timestamp")
	signature := r.Header.Get("Kick-Event-Signature")
	eventType := r.Header.Get("Kick-Event-Type")

	if messageID == "" || timestamp == "" || signature == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "missing webhook headers")
		return
	}

	// Verify signature: SHA256(messageID.timestamp.body) → RSA verify
	message := fmt.Sprintf("%s.%s.%s", messageID, timestamp, string(body))
	hashed := sha256.Sum256([]byte(message))

	sigBytes, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SIGNATURE", "failed to decode signature")
		return
	}

	if err := rsa.VerifyPKCS1v15(h.publicKey, crypto.SHA256, hashed[:], sigBytes); err != nil {
		writeError(w, http.StatusForbidden, "INVALID_SIGNATURE", "signature verification failed")
		return
	}

	slog.Info("Kick webhook received", "type", eventType, "messageId", messageID)

	// TODO: process event types (livestream.status.updated, chat.message.sent, etc.)
	// For now, just acknowledge
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}
