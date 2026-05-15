package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
	"github.com/decatrondev/nexe/services/gateway/internal/service"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type TwitchHandler struct {
	twitch         *service.TwitchService
	users          *repository.UserRepository
	auth           *service.AuthService
	jwt            *service.JWTService
	rdb            *redis.Client
	eventSubSecret string
	baseURL        string
	frontendURL    string
	messagingURL   string
	guildsURL      string
	presenceURL    string
}

func NewTwitchHandler(
	twitch *service.TwitchService,
	users *repository.UserRepository,
	auth *service.AuthService,
	jwt *service.JWTService,
	rdb *redis.Client,
	eventSubSecret, baseURL, frontendURL, messagingURL, guildsURL, presenceURL string,
) *TwitchHandler {
	return &TwitchHandler{
		twitch:         twitch,
		users:          users,
		auth:           auth,
		jwt:            jwt,
		rdb:            rdb,
		eventSubSecret: eventSubSecret,
		baseURL:        baseURL,
		frontendURL:    frontendURL,
		messagingURL:   messagingURL,
		guildsURL:      guildsURL,
		presenceURL:    presenceURL,
	}
}

// StartGuildMemberSubscriber listens for GUILD_MEMBER_ADD events and triggers Twitch role sync for new members.
func (h *TwitchHandler) StartGuildMemberSubscriber(ctx context.Context) {
	pubsub := h.rdb.PSubscribe(ctx, "nexe:events:guild:*")
	defer pubsub.Close()

	slog.Info("twitch member sync subscriber started")

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var evt struct {
				Type string          `json:"type"`
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &evt); err != nil {
				continue
			}
			if evt.Type != "GUILD_MEMBER_ADD" {
				continue
			}

			var data struct {
				UserID  string `json:"userId"`
				GuildID string `json:"guildId"`
			}
			if err := json.Unmarshal(evt.Data, &data); err != nil {
				continue
			}

			// Sync Twitch roles for the new member
			go h.syncNewMemberRoles(ctx, data.GuildID, data.UserID)
		}
	}
}

func (h *TwitchHandler) syncNewMemberRoles(ctx context.Context, guildID, userID string) {
	// Get guild info to check if it has Twitch integration
	guildResp, err := h.getGuildFromService(ctx, guildID, userID)
	if err != nil || guildResp == nil || guildResp.StreamerTwitchID == "" {
		return
	}

	// Get user's Twitch ID
	user, err := h.users.GetByID(ctx, userID)
	if err != nil || user == nil || user.TwitchID == nil || *user.TwitchID == "" {
		return
	}

	// Get broadcaster token
	bToken := h.getValidBroadcasterToken(ctx, guildResp.StreamerTwitchID)
	if bToken == "" {
		return
	}

	// Check status
	status, err := h.twitch.CheckUserTwitchStatus(ctx, guildResp.StreamerTwitchID, *user.TwitchID, bToken)
	if err != nil {
		return
	}

	// Get auto-roles
	autoRoles, err := h.getAutoRolesFromService(ctx, guildID, userID)
	if err != nil {
		return
	}
	sourceToRole := make(map[string]string)
	for _, r := range autoRoles {
		if r.AutoSource != "" {
			sourceToRole[r.AutoSource] = r.ID
		}
	}

	shouldHave := map[string]bool{
		"twitch_follower": status.IsFollower,
		"twitch_sub_t1":   status.IsSubscriber && (status.SubTier == "1000" || status.SubTier == "2000" || status.SubTier == "3000"),
		"twitch_sub_t2":   status.IsSubscriber && (status.SubTier == "2000" || status.SubTier == "3000"),
		"twitch_sub_t3":   status.IsSubscriber && status.SubTier == "3000",
		"twitch_vip":      status.IsVIP,
		"twitch_mod":      status.IsMod,
	}

	for source, should := range shouldHave {
		roleID, exists := sourceToRole[source]
		if !exists || !should {
			continue
		}
		h.assignRoleViaService(ctx, guildID, userID, roleID)
	}

	slog.Info("sync-on-join: completed", "user", userID, "guild", guildID)
}

// StartPeriodicSync runs a background ticker that syncs Twitch roles for all guilds with Twitch integration.
func (h *TwitchHandler) StartPeriodicSync(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("twitch periodic sync started", "interval", interval)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.runPeriodicSync(ctx)
		}
	}
}

func (h *TwitchHandler) runPeriodicSync(ctx context.Context) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost:8082/internal/guilds/with-twitch", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Error("periodic sync: failed to get twitch guilds", "error", err)
		return
	}
	defer resp.Body.Close()

	var guilds []struct {
		ID               string  `json:"id"`
		StreamerTwitchID *string `json:"streamerTwitchId"`
	}
	json.NewDecoder(resp.Body).Decode(&guilds)

	if len(guilds) == 0 {
		return
	}

	slog.Info("periodic sync: starting", "guilds", len(guilds))

	for _, g := range guilds {
		if g.StreamerTwitchID == nil || *g.StreamerTwitchID == "" {
			continue
		}
		h.syncAllGuildMembers(ctx, g.ID, *g.StreamerTwitchID)

		// Throttle: 2 second delay between guilds to avoid Twitch rate limits
		time.Sleep(2 * time.Second)
	}

	slog.Info("periodic sync: completed", "guilds", len(guilds))
}

// TwitchAuth redirects to Twitch OAuth
// Query params: ?action=link&token=JWT (optional — for linking to existing account)
func (h *TwitchHandler) TwitchAuth(w http.ResponseWriter, r *http.Request) {
	state := uuid.NewString()

	// Check if this is a link action (user already logged in, wants to connect Twitch)
	action := r.URL.Query().Get("action")
	userToken := r.URL.Query().Get("token")
	stateValue := "login"
	if action == "link" && userToken != "" {
		// Validate the JWT to get user ID
		claims, err := h.jwt.ValidateAccessToken(userToken)
		if err == nil {
			stateValue = "link:" + claims.Subject // store action + userId
		}
	}

	// Store state in Redis for 10 minutes
	h.rdb.Set(r.Context(), "nexe:twitch_state:"+state, stateValue, 600_000_000_000) // 10 min in nanoseconds

	url := h.twitch.GetAuthURL(state)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// TwitchCallback handles the OAuth callback and redirects to the frontend app
func (h *TwitchHandler) TwitchCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" || state == "" {
		redirectURL := fmt.Sprintf("%s/auth/twitch/callback?error=%s", h.frontendURL, url.QueryEscape("missing code or state"))
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
	}

	// Verify state and get action
	stateValue, _ := h.rdb.Get(r.Context(), "nexe:twitch_state:"+state).Result()
	if stateValue == "" {
		redirectURL := fmt.Sprintf("%s/auth/twitch/callback?error=%s", h.frontendURL, url.QueryEscape("invalid or expired state"))
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
	}
	h.rdb.Del(r.Context(), "nexe:twitch_state:"+state)

	// Check if this is a link action
	isLinkAction := false
	linkUserID := ""
	if strings.HasPrefix(stateValue, "link:") {
		isLinkAction = true
		linkUserID = strings.TrimPrefix(stateValue, "link:")
	}

	// Exchange code for token
	token, err := h.twitch.ExchangeCode(r.Context(), code)
	if err != nil {
		slog.Error("twitch exchange failed", "error", err)
		redirectURL := fmt.Sprintf("%s/auth/twitch/callback?error=%s", h.frontendURL, url.QueryEscape("failed to exchange code"))
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
	}

	// Get Twitch user info
	twitchUser, err := h.twitch.GetUser(r.Context(), token.AccessToken)
	if err != nil {
		slog.Error("twitch get user failed", "error", err)
		redirectURL := fmt.Sprintf("%s/auth/twitch/callback?error=%s", h.frontendURL, url.QueryEscape("failed to get user info"))
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
	}

	// Handle link action — link Twitch to existing account
	if isLinkAction && linkUserID != "" {
		// Check if Twitch already linked to another user
		existing, _ := h.users.GetByTwitchID(r.Context(), twitchUser.ID)
		if existing != nil && existing.ID != linkUserID {
			redirectURL := fmt.Sprintf("%s/auth/twitch/callback?error=%s", h.frontendURL, url.QueryEscape("This Twitch account is already linked to another user"))
			http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
			return
		}

		if err := h.users.LinkTwitch(r.Context(), linkUserID, twitchUser.ID, twitchUser.Login, twitchUser.DisplayName, token.AccessToken, token.RefreshToken); err != nil {
			redirectURL := fmt.Sprintf("%s/auth/twitch/callback?error=%s", h.frontendURL, url.QueryEscape("Failed to link Twitch account"))
			http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
			return
		}

		slog.Info("twitch linked via OAuth", "userId", linkUserID, "twitchId", twitchUser.ID)

		// Auto-sync roles in all guilds with Twitch integration
		go h.autoSyncUserRoles(linkUserID, twitchUser.ID)

		redirectURL := fmt.Sprintf("%s/auth/twitch/callback?linked=true&twitchLogin=%s",
			h.frontendURL, url.QueryEscape(twitchUser.Login))
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
	}

	// Check if user exists with this Twitch ID
	user, err := h.users.GetByTwitchID(r.Context(), twitchUser.ID)
	if err != nil {
		redirectURL := fmt.Sprintf("%s/auth/twitch/callback?error=%s", h.frontendURL, url.QueryEscape("internal error"))
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
	}

	// If not found by Twitch ID, try by email (user may have unlinked Twitch but still has account)
	if user == nil && twitchUser.Email != "" {
		user, _ = h.users.GetByEmail(r.Context(), twitchUser.Email)
	}

	if user != nil {
		// Always update Twitch tokens on login (refreshes scopes)
		if err := h.users.LinkTwitch(r.Context(), user.ID, twitchUser.ID, twitchUser.Login, twitchUser.DisplayName, token.AccessToken, token.RefreshToken); err != nil {
			slog.Error("twitch login: failed to update tokens", "error", err)
		}

		// Existing user — create session and redirect with tokens
		ip := r.Header.Get("X-Real-IP")
		if ip == "" {
			ip = r.RemoteAddr
		}

		tokens, err := h.auth.CreateSessionForUser(r.Context(), user, ip, r.UserAgent())
		if err != nil {
			slog.Error("twitch login session failed", "error", err, "userId", user.ID)
			redirectURL := fmt.Sprintf("%s/auth/twitch/callback?error=%s", h.frontendURL, url.QueryEscape("failed to create session"))
			http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
			return
		}

		// Auto-sync roles with updated scopes
		go h.autoSyncUserRoles(user.ID, twitchUser.ID)

		redirectURL := fmt.Sprintf("%s/auth/twitch/callback?accessToken=%s&refreshToken=%s&isNew=false",
			h.frontendURL,
			url.QueryEscape(tokens.AccessToken),
			url.QueryEscape(tokens.RefreshToken),
		)
		http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
		return
	}

	// New user — redirect with Twitch data for registration completion
	redirectURL := fmt.Sprintf("%s/auth/twitch/callback?isNew=true&twitchId=%s&twitchLogin=%s&twitchDisplay=%s&twitchEmail=%s&twitchAvatar=%s",
		h.frontendURL,
		url.QueryEscape(twitchUser.ID),
		url.QueryEscape(twitchUser.Login),
		url.QueryEscape(twitchUser.DisplayName),
		url.QueryEscape(twitchUser.Email),
		url.QueryEscape(twitchUser.ProfileImageURL),
	)
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// LinkTwitch links a Twitch account to the authenticated user
func (h *TwitchHandler) LinkTwitch(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "code is required")
		return
	}

	// Exchange code
	token, err := h.twitch.ExchangeCode(r.Context(), body.Code)
	if err != nil {
		writeError(w, http.StatusBadGateway, "twitch_error", err.Error())
		return
	}

	// Get Twitch user
	twitchUser, err := h.twitch.GetUser(r.Context(), token.AccessToken)
	if err != nil {
		writeError(w, http.StatusBadGateway, "twitch_error", err.Error())
		return
	}

	// Check if Twitch account already linked to another user
	existing, _ := h.users.GetByTwitchID(r.Context(), twitchUser.ID)
	if existing != nil && existing.ID != claims.Subject {
		writeError(w, http.StatusConflict, "already_linked", "this Twitch account is linked to another user")
		return
	}

	// Link Twitch to user
	if err := h.users.LinkTwitch(r.Context(), claims.Subject, twitchUser.ID, twitchUser.Login, twitchUser.DisplayName, token.AccessToken, token.RefreshToken); err != nil {
		writeError(w, http.StatusInternalServerError, "link_error", err.Error())
		return
	}

	slog.Info("twitch linked", "userId", claims.Subject, "twitchId", twitchUser.ID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"twitchId":      twitchUser.ID,
			"twitchLogin":   twitchUser.Login,
			"twitchDisplay": twitchUser.DisplayName,
			"message":       "twitch account linked successfully",
		},
	})
}

// UnlinkTwitch removes Twitch from the authenticated user
func (h *TwitchHandler) UnlinkTwitch(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	if err := h.users.UnlinkTwitch(r.Context(), claims.Subject); err != nil {
		writeError(w, http.StatusInternalServerError, "unlink_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "twitch account unlinked"},
	})
}

// GetStreamStatus gets a user's live stream status
func (h *TwitchHandler) GetStreamStatus(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")

	user, err := h.users.GetByID(r.Context(), userID)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}

	if user.TwitchID == nil || *user.TwitchID == "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"data": map[string]interface{}{"live": false, "linked": false},
		})
		return
	}

	stream, err := h.twitch.GetStreamByUserID(r.Context(), *user.TwitchID)
	if err != nil {
		slog.Error("get stream failed", "error", err)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"data": map[string]interface{}{"live": false, "linked": true, "error": "failed to check stream"},
		})
		return
	}

	if stream == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"data": map[string]interface{}{"live": false, "linked": true},
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"live":     true,
			"linked":   true,
			"title":    stream.Title,
			"game":     stream.GameName,
			"viewers":  stream.ViewerCount,
			"startedAt": stream.StartedAt,
			"thumbnail": stream.ThumbnailURL,
		},
	})
}

// EventSubWebhook handles Twitch EventSub webhook callbacks
func (h *TwitchHandler) EventSubWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "read_error", "failed to read body")
		return
	}

	// Verify signature
	msgID := r.Header.Get("Twitch-Eventsub-Message-Id")
	msgTimestamp := r.Header.Get("Twitch-Eventsub-Message-Timestamp")
	msgSignature := r.Header.Get("Twitch-Eventsub-Message-Signature")

	message := msgID + msgTimestamp + string(body)
	mac := hmac.New(sha256.New, []byte(h.eventSubSecret))
	mac.Write([]byte(message))
	expectedSig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expectedSig), []byte(msgSignature)) {
		slog.Warn("eventsub invalid signature")
		writeError(w, http.StatusForbidden, "invalid_signature", "signature verification failed")
		return
	}

	msgType := r.Header.Get("Twitch-Eventsub-Message-Type")

	switch msgType {
	case "webhook_callback_verification":
		var challenge struct {
			Challenge string `json:"challenge"`
		}
		json.Unmarshal(body, &challenge)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, challenge.Challenge)
		return

	case "notification":
		var notification struct {
			Subscription struct {
				Type string `json:"type"`
			} `json:"subscription"`
			Event json.RawMessage `json:"event"`
		}
		json.Unmarshal(body, &notification)

		slog.Info("eventsub notification", "type", notification.Subscription.Type)

		switch notification.Subscription.Type {
		case "stream.online":
			h.handleStreamOnline(r.Context(), notification.Event)
		case "stream.offline":
			h.handleStreamOffline(r.Context(), notification.Event)
		case "channel.follow":
			h.handleFollow(r.Context(), notification.Event)
		case "channel.subscribe":
			h.handleSubscribe(r.Context(), notification.Event)
		case "channel.subscription.end":
			h.handleSubscriptionEnd(r.Context(), notification.Event)
		case "channel.moderator.add":
			h.handleModeratorAdd(r.Context(), notification.Event)
		case "channel.moderator.remove":
			h.handleModeratorRemove(r.Context(), notification.Event)
		case "channel.chat.message":
			h.handleChatMessage(r.Context(), notification.Event)
		}

		w.WriteHeader(http.StatusNoContent)

	case "revocation":
		slog.Warn("eventsub subscription revoked", "body", string(body))
		w.WriteHeader(http.StatusNoContent)

	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *TwitchHandler) handleStreamOnline(ctx context.Context, event json.RawMessage) {
	var e struct {
		BroadcasterUserID    string `json:"broadcaster_user_id"`
		BroadcasterUserLogin string `json:"broadcaster_user_login"`
		BroadcasterUserName  string `json:"broadcaster_user_name"`
	}
	json.Unmarshal(event, &e)

	slog.Info("stream online", "twitchId", e.BroadcasterUserID, "login", e.BroadcasterUserLogin)

	// Store stream status in Redis
	h.rdb.HSet(ctx, "nexe:stream:"+e.BroadcasterUserID,
		"live", "true",
		"login", e.BroadcasterUserLogin,
		"name", e.BroadcasterUserName,
	)

	// Forward to presence service
	h.notifyPresenceStreamStatus(ctx, e.BroadcasterUserID, true)

	// Send "X is now live" notification to guild system channels
	go h.sendLiveNotification(ctx, e.BroadcasterUserID, e.BroadcasterUserName, e.BroadcasterUserLogin)
}

func (h *TwitchHandler) handleStreamOffline(ctx context.Context, event json.RawMessage) {
	var e struct {
		BroadcasterUserID string `json:"broadcaster_user_id"`
	}
	json.Unmarshal(event, &e)

	slog.Info("stream offline", "twitchId", e.BroadcasterUserID)

	h.rdb.Del(ctx, "nexe:stream:"+e.BroadcasterUserID)

	// Forward to presence service
	h.notifyPresenceStreamStatus(ctx, e.BroadcasterUserID, false)
}

// notifyPresenceStreamStatus resolves a Twitch ID to a Nexe user and notifies the presence service.
func (h *TwitchHandler) notifyPresenceStreamStatus(ctx context.Context, twitchID string, live bool) {
	user, err := h.users.GetByTwitchID(ctx, twitchID)
	if err != nil || user == nil {
		return // Not a Nexe user
	}

	payload := map[string]interface{}{"live": live}

	if live {
		// Fetch stream details from Twitch
		stream, err := h.twitch.GetStreamByUserID(ctx, twitchID)
		if err == nil && stream != nil {
			payload["title"] = stream.Title
			payload["game"] = stream.GameName
			payload["viewers"] = stream.ViewerCount
			payload["startedAt"] = stream.StartedAt
			payload["thumbnail"] = stream.ThumbnailURL
		}
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST",
		h.presenceURL+"/users/"+user.ID+"/stream-status", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Error("failed to notify presence of stream status", "error", err, "userId", user.ID)
		return
	}
	defer resp.Body.Close()
}

// ReconcileStreamStatuses checks all Twitch-linked users for active streams and syncs to presence.
func (h *TwitchHandler) ReconcileStreamStatuses(ctx context.Context) {
	// First: check any cached stream keys from EventSub
	keys, _ := h.rdb.Keys(ctx, "nexe:stream:*").Result()
	for _, key := range keys {
		twitchID := key[len("nexe:stream:"):]
		h.notifyPresenceStreamStatus(ctx, twitchID, true)
	}

	// Second: check all Twitch-linked users via Twitch API
	twitchIDs, err := h.users.GetAllTwitchIDs(ctx)
	if err != nil {
		slog.Error("reconcile: failed to get twitch IDs", "error", err)
		return
	}

	slog.Info("reconciling stream statuses", "cachedKeys", len(keys), "twitchUsers", len(twitchIDs))
	for _, twitchID := range twitchIDs {
		stream, err := h.twitch.GetStreamByUserID(ctx, twitchID)
		if err != nil {
			continue
		}
		if stream != nil {
			h.rdb.HSet(ctx, "nexe:stream:"+twitchID, "live", "true", "login", stream.UserLogin)
			h.notifyPresenceStreamStatus(ctx, twitchID, true)
		}
	}
}

// findGuildsByStreamer calls guilds service to get all guilds for a broadcaster.
func (h *TwitchHandler) findGuildsByStreamer(ctx context.Context, broadcasterTwitchID string) ([]struct {
	ID string `json:"id"`
}, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("http://localhost:8082/internal/guilds/by-streamer/%s", broadcasterTwitchID), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var guilds []struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&guilds)
	return guilds, nil
}

// syncAutoRoleBySource assigns or removes a specific auto-role source for a user across all guilds of a broadcaster.
func (h *TwitchHandler) syncAutoRoleBySource(ctx context.Context, broadcasterTwitchID, userTwitchID, source string, assign bool) {
	// Find Nexe user by Twitch ID
	user, err := h.users.GetByTwitchID(ctx, userTwitchID)
	if err != nil || user == nil {
		slog.Debug("eventsub: user not found in Nexe", "twitchId", userTwitchID, "source", source)
		return
	}

	// Find all guilds with this broadcaster
	guilds, err := h.findGuildsByStreamer(ctx, broadcasterTwitchID)
	if err != nil || len(guilds) == 0 {
		return
	}

	for _, g := range guilds {
		autoRoles, err := h.getAutoRolesFromService(ctx, g.ID, user.ID)
		if err != nil {
			continue
		}
		for _, r := range autoRoles {
			if r.AutoSource == source {
				if assign {
					h.assignRoleViaService(ctx, g.ID, user.ID, r.ID)
					slog.Info("eventsub: role assigned", "source", source, "user", user.Username, "guild", g.ID)
				} else {
					h.removeRoleViaService(ctx, g.ID, user.ID, r.ID)
					slog.Info("eventsub: role removed", "source", source, "user", user.Username, "guild", g.ID)
				}
				break
			}
		}
	}
}

func (h *TwitchHandler) handleFollow(ctx context.Context, event json.RawMessage) {
	var e struct {
		UserID            string `json:"user_id"`
		UserLogin         string `json:"user_login"`
		BroadcasterUserID string `json:"broadcaster_user_id"`
	}
	json.Unmarshal(event, &e)
	slog.Info("eventsub: new follow", "from", e.UserLogin, "to", e.BroadcasterUserID)
	go h.syncAutoRoleBySource(context.Background(), e.BroadcasterUserID, e.UserID, "twitch_follower", true)
}

func (h *TwitchHandler) handleSubscribe(ctx context.Context, event json.RawMessage) {
	var e struct {
		UserID            string `json:"user_id"`
		UserLogin         string `json:"user_login"`
		BroadcasterUserID string `json:"broadcaster_user_id"`
		Tier              string `json:"tier"`
	}
	json.Unmarshal(event, &e)
	slog.Info("eventsub: new subscription", "from", e.UserLogin, "to", e.BroadcasterUserID, "tier", e.Tier)

	go func() {
		ctx := context.Background()
		// Assign the appropriate tier role(s)
		h.syncAutoRoleBySource(ctx, e.BroadcasterUserID, e.UserID, "twitch_sub_t1", true)
		if e.Tier == "2000" || e.Tier == "3000" {
			h.syncAutoRoleBySource(ctx, e.BroadcasterUserID, e.UserID, "twitch_sub_t2", true)
		}
		if e.Tier == "3000" {
			h.syncAutoRoleBySource(ctx, e.BroadcasterUserID, e.UserID, "twitch_sub_t3", true)
		}
	}()
}

func (h *TwitchHandler) handleSubscriptionEnd(ctx context.Context, event json.RawMessage) {
	var e struct {
		UserID            string `json:"user_id"`
		UserLogin         string `json:"user_login"`
		BroadcasterUserID string `json:"broadcaster_user_id"`
	}
	json.Unmarshal(event, &e)
	slog.Info("eventsub: subscription ended", "from", e.UserLogin, "to", e.BroadcasterUserID)

	go func() {
		ctx := context.Background()
		h.syncAutoRoleBySource(ctx, e.BroadcasterUserID, e.UserID, "twitch_sub_t1", false)
		h.syncAutoRoleBySource(ctx, e.BroadcasterUserID, e.UserID, "twitch_sub_t2", false)
		h.syncAutoRoleBySource(ctx, e.BroadcasterUserID, e.UserID, "twitch_sub_t3", false)
	}()
}

func (h *TwitchHandler) handleModeratorAdd(ctx context.Context, event json.RawMessage) {
	var e struct {
		UserID            string `json:"user_id"`
		UserLogin         string `json:"user_login"`
		BroadcasterUserID string `json:"broadcaster_user_id"`
	}
	json.Unmarshal(event, &e)
	slog.Info("eventsub: moderator added", "user", e.UserLogin, "broadcaster", e.BroadcasterUserID)
	go h.syncAutoRoleBySource(context.Background(), e.BroadcasterUserID, e.UserID, "twitch_mod", true)
}

func (h *TwitchHandler) handleModeratorRemove(ctx context.Context, event json.RawMessage) {
	var e struct {
		UserID            string `json:"user_id"`
		UserLogin         string `json:"user_login"`
		BroadcasterUserID string `json:"broadcaster_user_id"`
	}
	json.Unmarshal(event, &e)
	slog.Info("eventsub: moderator removed", "user", e.UserLogin, "broadcaster", e.BroadcasterUserID)
	go h.syncAutoRoleBySource(context.Background(), e.BroadcasterUserID, e.UserID, "twitch_mod", false)
}

// SyncTwitchRoles checks the user's Twitch status against a guild's streamer and assigns/removes auto-roles.
func (h *TwitchHandler) SyncTwitchRoles(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	guildID := r.PathValue("id")

	// 1. Get the user's Twitch ID
	user, err := h.users.GetByID(r.Context(), claims.Subject)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	if user.TwitchID == nil || *user.TwitchID == "" {
		writeError(w, http.StatusBadRequest, "no_twitch", "link your Twitch account first")
		return
	}

	// 2. Get the guild from guilds service to check streamer_twitch_id
	guildResp, err := h.getGuildFromService(r.Context(), guildID, claims.Subject)
	if err != nil {
		writeError(w, http.StatusBadGateway, "service_error", "failed to get guild info")
		return
	}
	if guildResp.StreamerTwitchID == "" {
		writeError(w, http.StatusBadRequest, "no_integration", "this server has no Twitch integration enabled")
		return
	}

	// 3. Get valid broadcaster token (auto-refreshes if expired)
	broadcasterToken := h.getValidBroadcasterToken(r.Context(), guildResp.StreamerTwitchID)
	if broadcasterToken == "" {
		writeError(w, http.StatusBadGateway, "token_error", "broadcaster token unavailable for role sync")
		return
	}

	// 4. Check Twitch status
	status, err := h.twitch.CheckUserTwitchStatus(r.Context(), guildResp.StreamerTwitchID, *user.TwitchID, broadcasterToken)
	if err != nil {
		writeError(w, http.StatusBadGateway, "twitch_error", "failed to check Twitch status")
		return
	}

	// 4. Get the guild's auto-roles
	autoRoles, err := h.getAutoRolesFromService(r.Context(), guildID, claims.Subject)
	if err != nil {
		slog.Error("sync twitch roles: failed to get auto roles", "error", err)
		writeError(w, http.StatusBadGateway, "service_error", "failed to get role info")
		return
	}

	// 5. Determine which roles to assign/remove
	sourceToRole := make(map[string]string) // autoSource -> roleID
	for _, role := range autoRoles {
		if role.AutoSource != "" {
			sourceToRole[role.AutoSource] = role.ID
		}
	}

	// Map of auto_source -> should user have this role
	shouldHave := map[string]bool{
		"twitch_follower":  status.IsFollower,
		"twitch_sub_t1":    status.IsSubscriber && (status.SubTier == "1000" || status.SubTier == "2000" || status.SubTier == "3000"),
		"twitch_sub_t2":    status.IsSubscriber && (status.SubTier == "2000" || status.SubTier == "3000"),
		"twitch_sub_t3":    status.IsSubscriber && status.SubTier == "3000",
		"twitch_vip":       status.IsVIP,
		"twitch_lead_mod":  false, // Twitch API doesn't distinguish lead mod from mod — assigned manually or via chat badge
		"twitch_mod":       status.IsMod,
	}

	var assigned []string
	var removed []string
	var errors []string

	for source, shouldAssign := range shouldHave {
		roleID, exists := sourceToRole[source]
		if !exists {
			continue
		}

		if shouldAssign {
			if err := h.assignRoleViaService(r.Context(), guildID, claims.Subject, roleID); err != nil {
				errors = append(errors, fmt.Sprintf("assign %s: %s", source, err.Error()))
			} else {
				assigned = append(assigned, source)
			}
		} else {
			if err := h.removeRoleViaService(r.Context(), guildID, claims.Subject, roleID); err != nil {
				// Ignore "not found" errors — user might not have the role
				if !strings.Contains(err.Error(), "not found") {
					errors = append(errors, fmt.Sprintf("remove %s: %s", source, err.Error()))
				}
			} else {
				removed = append(removed, source)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"status":   status,
			"assigned": assigned,
			"removed":  removed,
			"errors":   errors,
		},
	})
}

// Internal guild service structs for parsing responses
type guildResponse struct {
	StreamerTwitchID string `json:"streamerTwitchId"`
}

type autoRoleResponse struct {
	ID         string `json:"id"`
	AutoSource string `json:"autoSource"`
}

func (h *TwitchHandler) getGuildFromService(ctx context.Context, guildID, userID string) (*guildResponse, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("http://localhost:8082/guilds/%s", guildID), nil)
	req.Header.Set("X-User-ID", userID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var guild guildResponse
	json.NewDecoder(resp.Body).Decode(&guild)
	return &guild, nil
}

func (h *TwitchHandler) getAutoRolesFromService(ctx context.Context, guildID, userID string) ([]autoRoleResponse, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("http://localhost:8082/guilds/%s/roles", guildID), nil)
	req.Header.Set("X-User-ID", userID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var roles []autoRoleResponse
	json.NewDecoder(resp.Body).Decode(&roles)

	// Filter to auto roles only
	var autoRoles []autoRoleResponse
	for _, r := range roles {
		if r.AutoSource != "" {
			autoRoles = append(autoRoles, r)
		}
	}
	return autoRoles, nil
}

func (h *TwitchHandler) assignRoleViaService(ctx context.Context, guildID, userID, roleID string) error {
	req, _ := http.NewRequestWithContext(ctx, "PUT",
		fmt.Sprintf("http://localhost:8082/guilds/%s/members/%s/auto-roles/%s", guildID, userID, roleID), nil)
	req.Header.Set("X-User-ID", userID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("assign role failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

func (h *TwitchHandler) removeRoleViaService(ctx context.Context, guildID, userID, roleID string) error {
	req, _ := http.NewRequestWithContext(ctx, "DELETE",
		fmt.Sprintf("http://localhost:8082/guilds/%s/members/%s/auto-roles/%s", guildID, userID, roleID), nil)
	req.Header.Set("X-User-ID", userID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("remove role failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// getValidBroadcasterToken returns a valid access token for the broadcaster.
// If the current token is expired, it refreshes it and updates the DB.
func (h *TwitchHandler) getValidBroadcasterToken(ctx context.Context, broadcasterTwitchID string) string {
	user, err := h.users.GetByTwitchID(ctx, broadcasterTwitchID)
	if err != nil || user == nil || user.TwitchAccessToken == nil {
		return ""
	}

	token := *user.TwitchAccessToken

	// Check expiration proactively — only refresh if within 5 minutes of expiry or already expired
	if user.TwitchTokenExpiresAt != nil && time.Until(*user.TwitchTokenExpiresAt) > 5*time.Minute {
		return token // token still valid, no API call needed
	}

	// Token expired — use distributed lock to prevent concurrent refreshes
	lockKey := fmt.Sprintf("nexe:token_refresh:%s", broadcasterTwitchID)
	acquired, _ := h.rdb.SetNX(ctx, lockKey, "1", 30*time.Second).Result()
	if !acquired {
		// Another goroutine is refreshing — wait briefly and re-read from DB
		time.Sleep(2 * time.Second)
		user, err = h.users.GetByTwitchID(ctx, broadcasterTwitchID)
		if err == nil && user != nil && user.TwitchAccessToken != nil {
			return *user.TwitchAccessToken
		}
		return ""
	}
	defer h.rdb.Del(ctx, lockKey)

	if user.TwitchRefreshToken == nil || *user.TwitchRefreshToken == "" {
		slog.Warn("broadcaster token expired, no refresh token", "twitchId", broadcasterTwitchID)
		return ""
	}

	newTokens, err := h.twitch.RefreshToken(ctx, *user.TwitchRefreshToken)
	if err != nil {
		slog.Error("failed to refresh broadcaster token", "error", err, "twitchId", broadcasterTwitchID)
		return ""
	}

	// Update DB with new tokens
	if err := h.users.LinkTwitch(ctx, user.ID, broadcasterTwitchID,
		stringVal(user.TwitchLogin), stringVal(user.TwitchDisplayName),
		newTokens.AccessToken, newTokens.RefreshToken); err != nil {
		slog.Error("failed to save refreshed token", "error", err)
	}

	slog.Info("broadcaster token refreshed", "twitchId", broadcasterTwitchID)
	return newTokens.AccessToken
}

func stringVal(s *string) string {
	if s != nil { return *s }
	return ""
}

// SyncAllMembers is an HTTP handler that triggers sync for all guild members.
func (h *TwitchHandler) SyncAllMembers(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	guildID := r.PathValue("id")

	guildResp, err := h.getGuildFromService(r.Context(), guildID, claims.Subject)
	if err != nil || guildResp.StreamerTwitchID == "" {
		writeError(w, http.StatusBadRequest, "no_integration", "no Twitch integration on this server")
		return
	}

	go h.syncAllGuildMembers(context.Background(), guildID, guildResp.StreamerTwitchID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "syncing all members in background"},
	})
}

// syncAllGuildMembers syncs Twitch auto-roles for ALL members of a guild.
// Called after enabling Twitch integration.
func (h *TwitchHandler) syncAllGuildMembers(ctx context.Context, guildID, streamerTwitchID string) {
	members := h.fetchAllGuildMembers(ctx, guildID)
	if len(members) == 0 {
		return
	}

	// Get auto-roles for this guild
	autoRoles, err := h.getAutoRolesFromService(ctx, guildID, "system")
	if err != nil {
		slog.Error("sync-all: failed to get auto roles", "error", err)
		return
	}

	sourceToRole := make(map[string]string)
	for _, r := range autoRoles {
		if r.AutoSource != "" {
			sourceToRole[r.AutoSource] = r.ID
		}
	}

	// Get valid broadcaster token (auto-refreshes if expired)
	bToken := h.getValidBroadcasterToken(ctx, streamerTwitchID)
	if bToken == "" {
		slog.Warn("syncAllGuildMembers: broadcaster token unavailable, skipping", "guild", guildID)
		return
	}

	synced := 0
	for _, member := range members {
		// Get this member's Twitch ID
		user, err := h.users.GetByID(ctx, member.UserID)
		if err != nil || user == nil || user.TwitchID == nil || *user.TwitchID == "" {
			continue // no Twitch linked
		}

		// Check their status against the streamer
		status, err := h.twitch.CheckUserTwitchStatus(ctx, streamerTwitchID, *user.TwitchID, bToken)
		if err != nil {
			slog.Error("sync-all: failed to check status", "error", err, "user", member.UserID)
			continue
		}

		shouldHave := map[string]bool{
			"twitch_follower": status.IsFollower,
			"twitch_sub_t1":   status.IsSubscriber && (status.SubTier == "1000" || status.SubTier == "2000" || status.SubTier == "3000"),
			"twitch_sub_t2":   status.IsSubscriber && (status.SubTier == "2000" || status.SubTier == "3000"),
			"twitch_sub_t3":   status.IsSubscriber && status.SubTier == "3000",
			"twitch_vip":      status.IsVIP,
			"twitch_mod":      status.IsMod,
		}

		for source, should := range shouldHave {
			roleID, exists := sourceToRole[source]
			if !exists {
				continue
			}
			if should {
				if err := h.assignRoleViaService(ctx, guildID, member.UserID, roleID); err != nil {
					slog.Error("sync-all: assign failed", "source", source, "user", member.UserID, "error", err)
				}
			} else {
				if err := h.removeRoleViaService(ctx, guildID, member.UserID, roleID); err != nil {
					slog.Debug("sync-all: remove (no-op or failed)", "source", source, "user", member.UserID, "error", err)
				} else {
					slog.Info("sync-all: role removed", "source", source, "user", member.UserID, "guild", guildID)
				}
			}
		}
		synced++
	}

	slog.Info("sync-all: completed", "guild", guildID, "membersSynced", synced)
}

// autoSyncUserRoles syncs Twitch auto-roles for a user across all their guilds.
// Runs in background (goroutine) after Twitch account is linked.
func (h *TwitchHandler) autoSyncUserRoles(userID, twitchID string) {
	ctx := context.Background()

	// Get all guilds the user is in
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost:8082/guilds/me", nil)
	req.Header.Set("X-User-ID", userID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Error("auto-sync: failed to get user guilds", "error", err)
		return
	}
	defer resp.Body.Close()

	var guilds []struct {
		ID               string  `json:"id"`
		StreamerTwitchID *string `json:"streamerTwitchId"`
	}
	json.NewDecoder(resp.Body).Decode(&guilds)

	for _, g := range guilds {
		if g.StreamerTwitchID == nil || *g.StreamerTwitchID == "" {
			continue // no Twitch integration on this guild
		}

		// Get valid broadcaster token (auto-refreshes if expired)
		bTok := h.getValidBroadcasterToken(ctx, *g.StreamerTwitchID)
		if bTok == "" {
			slog.Warn("autoSyncUserRoles: broadcaster token unavailable, skipping guild", "guild", g.ID)
			continue
		}

		// Check status against this guild's streamer
		status, err := h.twitch.CheckUserTwitchStatus(ctx, *g.StreamerTwitchID, twitchID, bTok)
		if err != nil {
			slog.Error("auto-sync: failed to check status", "error", err, "guild", g.ID)
			continue
		}

		// Get auto-roles for this guild
		autoRoles, err := h.getAutoRolesFromService(ctx, g.ID, userID)
		if err != nil {
			continue
		}

		sourceToRole := make(map[string]string)
		for _, r := range autoRoles {
			if r.AutoSource != "" {
				sourceToRole[r.AutoSource] = r.ID
			}
		}

		shouldHave := map[string]bool{
			"twitch_follower": status.IsFollower,
			"twitch_sub_t1":   status.IsSubscriber && (status.SubTier == "1000" || status.SubTier == "2000" || status.SubTier == "3000"),
			"twitch_sub_t2":   status.IsSubscriber && (status.SubTier == "2000" || status.SubTier == "3000"),
			"twitch_sub_t3":   status.IsSubscriber && status.SubTier == "3000",
			"twitch_vip":      status.IsVIP,
			"twitch_mod":      status.IsMod,
		}

		for source, should := range shouldHave {
			roleID, exists := sourceToRole[source]
			if !exists {
				continue
			}
			if should {
				h.assignRoleViaService(ctx, g.ID, userID, roleID)
			} else {
				h.removeRoleViaService(ctx, g.ID, userID, roleID)
			}
		}

		slog.Info("auto-sync: synced roles", "user", userID, "guild", g.ID)

		// If this user is the broadcaster (owner of Twitch integration), sync ALL members
		if *g.StreamerTwitchID == twitchID {
			slog.Info("auto-sync: broadcaster login, syncing all members", "guild", g.ID)
			h.syncAllMembersForGuild(ctx, g.ID, twitchID, bTok)
		}
	}
}

// fetchAllGuildMembers fetches all members from guilds service with pagination.
func (h *TwitchHandler) fetchAllGuildMembers(ctx context.Context, guildID string) []struct{ UserID string `json:"userId"` } {
	var all []struct {
		UserID string `json:"userId"`
	}
	offset := 0
	limit := 200

	for {
		url := fmt.Sprintf("http://localhost:8082/guilds/%s/members?limit=%d&offset=%d", guildID, limit, offset)
		req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
		req.Header.Set("X-User-ID", "system")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			break
		}

		var batch []struct {
			UserID string `json:"userId"`
		}
		json.NewDecoder(resp.Body).Decode(&batch)
		resp.Body.Close()

		if len(batch) == 0 {
			break
		}
		all = append(all, batch...)

		if len(batch) < limit {
			break // last page
		}
		offset += limit
	}

	return all
}

// syncAllMembersForGuild syncs Twitch roles for all members in a guild.
func (h *TwitchHandler) syncAllMembersForGuild(ctx context.Context, guildID, streamerTwitchID, broadcasterToken string) {
	members := h.fetchAllGuildMembers(ctx, guildID)
	if len(members) == 0 {
		return
	}

	autoRoles, err := h.getAutoRolesFromService(ctx, guildID, "system")
	if err != nil {
		return
	}
	sourceToRole := make(map[string]string)
	for _, r := range autoRoles {
		if r.AutoSource != "" {
			sourceToRole[r.AutoSource] = r.ID
		}
	}

	for _, m := range members {
		user, err := h.users.GetByID(ctx, m.UserID)
		if err != nil || user == nil || user.TwitchID == nil || *user.TwitchID == "" {
			continue
		}

		status, err := h.twitch.CheckUserTwitchStatus(ctx, streamerTwitchID, *user.TwitchID, broadcasterToken)
		if err != nil {
			continue
		}

		shouldHave := map[string]bool{
			"twitch_follower": status.IsFollower,
			"twitch_sub_t1":   status.IsSubscriber && (status.SubTier == "1000" || status.SubTier == "2000" || status.SubTier == "3000"),
			"twitch_sub_t2":   status.IsSubscriber && (status.SubTier == "2000" || status.SubTier == "3000"),
			"twitch_sub_t3":   status.IsSubscriber && status.SubTier == "3000",
			"twitch_vip":      status.IsVIP,
			"twitch_mod":      status.IsMod,
		}

		for source, should := range shouldHave {
			roleID, exists := sourceToRole[source]
			if !exists {
				continue
			}
			if should {
				h.assignRoleViaService(ctx, guildID, m.UserID, roleID)
			} else {
				h.removeRoleViaService(ctx, guildID, m.UserID, roleID)
			}
		}
	}
}

// SetupEventSub subscribes to EventSub for a broadcaster
func (h *TwitchHandler) SetupEventSub(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	user, err := h.users.GetByID(r.Context(), claims.Subject)
	if err != nil || user == nil || user.TwitchID == nil {
		writeError(w, http.StatusBadRequest, "no_twitch", "link your Twitch account first")
		return
	}

	callbackURL := h.baseURL + "/twitch/webhook"
	twitchID := *user.TwitchID

	// Subscribe to events
	events := []struct {
		Type      string
		Version   string
		Condition map[string]string
	}{
		{"stream.online", "1", map[string]string{"broadcaster_user_id": twitchID}},
		{"stream.offline", "1", map[string]string{"broadcaster_user_id": twitchID}},
		{"channel.follow", "2", map[string]string{"broadcaster_user_id": twitchID, "moderator_user_id": twitchID}},
		{"channel.subscribe", "1", map[string]string{"broadcaster_user_id": twitchID}},
		{"channel.subscription.end", "1", map[string]string{"broadcaster_user_id": twitchID}},
		{"channel.moderator.add", "1", map[string]string{"broadcaster_user_id": twitchID}},
		{"channel.moderator.remove", "1", map[string]string{"broadcaster_user_id": twitchID}},
		{"channel.chat.message", "1", map[string]string{"broadcaster_user_id": twitchID, "user_id": twitchID}},
	}

	var errors []string
	for _, ev := range events {
		if err := h.twitch.SubscribeEventSub(r.Context(), ev.Type, ev.Version, ev.Condition, callbackURL, h.eventSubSecret); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %s", ev.Type, err.Error()))
		}
	}

	if len(errors) > 0 {
		writeJSON(w, http.StatusPartialContent, map[string]interface{}{
			"data": map[string]interface{}{
				"message": "some subscriptions failed",
				"errors":  errors,
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "eventsub subscriptions created"},
	})
}

// EnableBridge sets up the bridge channel and registers EventSub for chat messages.
func (h *TwitchHandler) EnableBridge(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	guildID := r.PathValue("id")

	// Read body
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body.Close()

	var body struct {
		ChannelID string `json:"channelId"`
	}
	json.Unmarshal(bodyBytes, &body)

	// Proxy to guilds service to save bridge_channel_id
	proxyReq, _ := http.NewRequest("POST", h.guildsURL+"/guilds/"+guildID+"/bridge", bytes.NewReader(bodyBytes))
	proxyReq.Header.Set("Content-Type", "application/json")
	proxyReq.Header.Set("X-User-ID", claims.Subject)
	proxyReq.Header.Set("X-Username", claims.Username)

	resp, err := http.DefaultClient.Do(proxyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "proxy_error", "service unavailable")
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		w.Write(respBody)
		return
	}

	// Get guild info for broadcaster Twitch ID
	guildResp, err := http.Get(h.guildsURL + "/guilds/" + guildID)
	if err == nil {
		defer guildResp.Body.Close()
		var guild struct {
			StreamerTwitchID *string `json:"streamerTwitchId"`
		}
		json.NewDecoder(guildResp.Body).Decode(&guild)

		if guild.StreamerTwitchID != nil {
			twitchID := *guild.StreamerTwitchID

			// Cache bridge mapping in Redis
			h.rdb.HSet(r.Context(), "nexe:bridge:twitch:"+twitchID, map[string]interface{}{
				"guildId":   guildID,
				"channelId": body.ChannelID,
			})

			// Register EventSub for channel.chat.message — uses app token for webhook creation
			// The user_id in condition must have authorized with user:read:chat scope (done via OAuth)
			callbackURL := h.baseURL + "/twitch/webhook"
			err := h.twitch.SubscribeEventSub(r.Context(), "channel.chat.message", "1",
				map[string]string{"broadcaster_user_id": twitchID, "user_id": twitchID},
				callbackURL, h.eventSubSecret)
			if err != nil {
				slog.Error("failed to subscribe to chat events", "error", err, "twitchId", twitchID)
			} else {
				slog.Info("chat bridge EventSub registered", "twitchId", twitchID, "guildId", guildID)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(respBody)
}

// handleChatMessage processes incoming Twitch chat messages and bridges them to Nexe.
func (h *TwitchHandler) handleChatMessage(ctx context.Context, event json.RawMessage) {
	var chatEvent struct {
		BroadcasterUserID    string `json:"broadcaster_user_id"`
		BroadcasterUserLogin string `json:"broadcaster_user_login"`
		ChatterUserID        string `json:"chatter_user_id"`
		ChatterUserLogin     string `json:"chatter_user_login"`
		ChatterUserName      string `json:"chatter_user_name"`
		MessageID            string `json:"message_id"`
		Message              struct {
			Text string `json:"text"`
		} `json:"message"`
	}
	if err := json.Unmarshal(event, &chatEvent); err != nil {
		slog.Error("failed to parse chat message event", "error", err)
		return
	}

	// Don't bridge messages from the broadcaster — they're either:
	// 1. Sent by Nexe bridge (loop) or 2. Typed by streamer who's already in Nexe
	if chatEvent.ChatterUserID == chatEvent.BroadcasterUserID {
		return
	}

	broadcasterTwitchID := chatEvent.BroadcasterUserID

	// Find the guild with this broadcaster's Twitch integration + bridge channel
	guildData, err := h.findBridgeGuild(ctx, broadcasterTwitchID)
	if err != nil || guildData == nil {
		return // no guild has a bridge for this broadcaster
	}

	// Create bridge message via messaging service
	msgBody, _ := json.Marshal(map[string]interface{}{
		"content":        chatEvent.Message.Text,
		"type":           "bridge",
		"bridgeSource":   "twitch",
		"bridgeAuthor":   chatEvent.ChatterUserName,
		"bridgeAuthorId": chatEvent.ChatterUserID,
	})

	req, err := http.NewRequestWithContext(ctx, "POST",
		h.messagingURL+"/channels/"+guildData.bridgeChannelID+"/messages", bytes.NewReader(msgBody))
	if err != nil {
		slog.Error("failed to create bridge message request", "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "bridge-bot") // system user

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Error("failed to send bridge message", "error", err)
		return
	}
	resp.Body.Close()

	slog.Debug("twitch chat bridged", "from", chatEvent.ChatterUserLogin, "text", chatEvent.Message.Text)
}

type bridgeGuildInfo struct {
	guildID         string
	bridgeChannelID string
}

// findBridgeGuild finds a guild that has a bridge configured for this Twitch broadcaster.
func (h *TwitchHandler) findBridgeGuild(ctx context.Context, twitchID string) (*bridgeGuildInfo, error) {
	// Check Redis cache
	cacheKey := "nexe:bridge:twitch:" + twitchID
	data, err := h.rdb.HGetAll(ctx, cacheKey).Result()
	if err == nil && data["guildId"] != "" && data["channelId"] != "" {
		return &bridgeGuildInfo{guildID: data["guildId"], bridgeChannelID: data["channelId"]}, nil
	}
	return nil, nil
}

// SendToTwitchChat sends a message from Nexe to Twitch chat.
func (h *TwitchHandler) SendToTwitchChat(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var body struct {
		GuildID   string `json:"guildId"`
		ChannelID string `json:"channelId"`
		Message   string `json:"message"`
		Username  string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	// Get the guild to find broadcaster twitch ID
	resp, err := http.Get(h.guildsURL + "/guilds/" + body.GuildID)
	if err != nil || resp.StatusCode != 200 {
		writeError(w, http.StatusBadRequest, "guild_error", "failed to fetch guild")
		return
	}
	defer resp.Body.Close()

	var guild struct {
		StreamerTwitchID *string `json:"streamerTwitchId"`
		BridgeChannelID  *string `json:"bridgeChannelId"`
	}
	json.NewDecoder(resp.Body).Decode(&guild)

	if guild.StreamerTwitchID == nil || guild.BridgeChannelID == nil || *guild.BridgeChannelID != body.ChannelID {
		writeError(w, http.StatusBadRequest, "no_bridge", "this channel is not a bridge channel")
		return
	}

	// Rate limit per user: 5 msg/30s
	userKey := fmt.Sprintf("nexe:bridge:ratelimit:user:%s:%s", body.GuildID, claims.Subject)
	userCount, _ := h.rdb.Incr(r.Context(), userKey).Result()
	if userCount == 1 {
		h.rdb.Expire(r.Context(), userKey, 30*time.Second)
	}
	if userCount > 5 {
		writeError(w, http.StatusTooManyRequests, "bridge_rate_limited", "You're sending too fast to Twitch (max 5/30s)")
		return
	}

	// Rate limit per guild: 20 msg/30s (Twitch channel limit)
	guildKey := fmt.Sprintf("nexe:bridge:ratelimit:guild:%s", body.GuildID)
	guildCount, _ := h.rdb.Incr(r.Context(), guildKey).Result()
	if guildCount == 1 {
		h.rdb.Expire(r.Context(), guildKey, 30*time.Second)
	}
	if guildCount > 20 {
		writeError(w, http.StatusTooManyRequests, "bridge_rate_limited", "Bridge is rate limited — too many messages sent to Twitch (max 20/30s)")
		return
	}

	// Get broadcaster token to send chat
	broadcasterToken := h.getValidBroadcasterToken(r.Context(), *guild.StreamerTwitchID)
	if broadcasterToken == "" {
		writeError(w, http.StatusBadRequest, "token_error", "failed to get broadcaster token")
		return
	}

	// Format message with username prefix
	chatMsg := fmt.Sprintf("[%s] %s", body.Username, body.Message)
	if len(chatMsg) > 500 {
		chatMsg = chatMsg[:500]
	}

	// Send to Twitch chat via Helix API
	chatBody, _ := json.Marshal(map[string]string{
		"broadcaster_id": *guild.StreamerTwitchID,
		"sender_id":      *guild.StreamerTwitchID,
		"message":        chatMsg,
	})

	chatReq, _ := http.NewRequest("POST", "https://api.twitch.tv/helix/chat/messages", bytes.NewReader(chatBody))
	chatReq.Header.Set("Authorization", "Bearer "+broadcasterToken)
	chatReq.Header.Set("Client-Id", h.twitch.GetClientID())
	chatReq.Header.Set("Content-Type", "application/json")

	chatResp, err := http.DefaultClient.Do(chatReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "twitch_error", "failed to send to Twitch")
		return
	}
	defer chatResp.Body.Close()

	if chatResp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(chatResp.Body)
		slog.Error("twitch chat send failed", "status", chatResp.StatusCode, "body", string(respBody))
		writeError(w, http.StatusBadGateway, "twitch_error", "Twitch rejected the message")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// sendLiveNotification sends a system message to all guilds where the streamer is a member.
func (h *TwitchHandler) sendLiveNotification(ctx context.Context, twitchID, displayName, login string) {
	user, err := h.users.GetByTwitchID(ctx, twitchID)
	if err != nil || user == nil {
		return
	}

	// Get stream info for the message
	stream, _ := h.twitch.GetStreamByUserID(ctx, twitchID)
	streamTitle := ""
	gameName := ""
	if stream != nil {
		streamTitle = stream.Title
		gameName = stream.GameName
	}

	// Build notification message
	content := fmt.Sprintf("🔴 **%s** is now live on Twitch!", displayName)
	if streamTitle != "" {
		content += fmt.Sprintf("\n> %s", streamTitle)
	}
	if gameName != "" {
		content += fmt.Sprintf("\n🎮 %s", gameName)
	}
	content += fmt.Sprintf("\nhttps://twitch.tv/%s", login)

	// Get all guilds the user is a member of
	resp, err := http.Get(h.guildsURL + "/users/" + user.ID + "/guilds")
	if err != nil {
		slog.Error("failed to get user guilds for live notification", "error", err)
		return
	}
	defer resp.Body.Close()

	var guilds []struct {
		ID              string  `json:"id"`
		SystemChannelID *string `json:"systemChannelId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&guilds); err != nil {
		return
	}

	for _, guild := range guilds {
		channelID := ""
		if guild.SystemChannelID != nil && *guild.SystemChannelID != "" {
			channelID = *guild.SystemChannelID
		}
		if channelID == "" {
			continue // No system channel configured, skip
		}

		// Send system message via messaging service
		msgBody, _ := json.Marshal(map[string]interface{}{
			"content":      content,
			"type":         "system",
			"bridgeAuthor": displayName,
		})
		req, _ := http.NewRequestWithContext(ctx, "POST",
			h.messagingURL+"/channels/"+channelID+"/messages", bytes.NewReader(msgBody))
		req.Header.Set("Content-Type", "application/json")
		if resp, err := http.DefaultClient.Do(req); err == nil {
			resp.Body.Close()
		}
	}
}
