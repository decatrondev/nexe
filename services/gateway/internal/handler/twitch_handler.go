package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
	"github.com/decatrondev/nexe/services/gateway/internal/service"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type TwitchHandler struct {
	twitch       *service.TwitchService
	users        *repository.UserRepository
	auth         *service.AuthService
	jwt          *service.JWTService
	rdb          *redis.Client
	eventSubSecret string
	baseURL      string
}

func NewTwitchHandler(
	twitch *service.TwitchService,
	users *repository.UserRepository,
	auth *service.AuthService,
	jwt *service.JWTService,
	rdb *redis.Client,
	eventSubSecret, baseURL string,
) *TwitchHandler {
	return &TwitchHandler{
		twitch:         twitch,
		users:          users,
		auth:           auth,
		jwt:            jwt,
		rdb:            rdb,
		eventSubSecret: eventSubSecret,
		baseURL:        baseURL,
	}
}

// TwitchAuth redirects to Twitch OAuth
func (h *TwitchHandler) TwitchAuth(w http.ResponseWriter, r *http.Request) {
	state := uuid.NewString()

	// Store state in Redis for 10 minutes
	h.rdb.Set(r.Context(), "nexe:twitch_state:"+state, "1", 600_000_000_000) // 10 min in nanoseconds

	url := h.twitch.GetAuthURL(state)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// TwitchCallback handles the OAuth callback
func (h *TwitchHandler) TwitchCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" || state == "" {
		writeError(w, http.StatusBadRequest, "missing_params", "code and state required")
		return
	}

	// Verify state
	exists, _ := h.rdb.Exists(r.Context(), "nexe:twitch_state:"+state).Result()
	if exists == 0 {
		writeError(w, http.StatusBadRequest, "invalid_state", "invalid or expired state")
		return
	}
	h.rdb.Del(r.Context(), "nexe:twitch_state:"+state)

	// Exchange code for token
	token, err := h.twitch.ExchangeCode(r.Context(), code)
	if err != nil {
		slog.Error("twitch exchange failed", "error", err)
		writeError(w, http.StatusBadGateway, "twitch_error", "failed to exchange code")
		return
	}

	// Get Twitch user info
	twitchUser, err := h.twitch.GetUser(r.Context(), token.AccessToken)
	if err != nil {
		slog.Error("twitch get user failed", "error", err)
		writeError(w, http.StatusBadGateway, "twitch_error", "failed to get user info")
		return
	}

	// Check if user exists with this Twitch ID
	user, err := h.users.GetByTwitchID(r.Context(), twitchUser.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	if user != nil {
		// Existing user — login
		ip := r.Header.Get("X-Real-IP")
		if ip == "" {
			ip = r.RemoteAddr
		}
		tokens, _, err := h.auth.Login(r.Context(), service.LoginInput{Email: user.Email}, ip, r.UserAgent())
		if err != nil {
			// User might not have password, generate token directly
			accessToken, _ := h.jwt.GenerateAccessToken(user.ID, user.Username, user.Email, user.Tier, *user.TwitchID)
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"data": map[string]interface{}{
					"accessToken": accessToken,
					"user": map[string]interface{}{
						"id":       user.ID,
						"username": user.Username,
						"email":    user.Email,
						"twitchId": user.TwitchID,
					},
					"isNew": false,
				},
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"data": map[string]interface{}{
				"accessToken":  tokens.AccessToken,
				"refreshToken": tokens.RefreshToken,
				"expiresIn":    tokens.ExpiresIn,
				"isNew":        false,
			},
		})
		return
	}

	// New user — return Twitch data for registration completion
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"isNew": true,
			"twitch": map[string]interface{}{
				"id":              twitchUser.ID,
				"login":           twitchUser.Login,
				"displayName":     twitchUser.DisplayName,
				"email":           twitchUser.Email,
				"profileImageUrl": twitchUser.ProfileImageURL,
				"broadcasterType": twitchUser.BroadcasterType,
			},
			"accessToken":  token.AccessToken,
			"refreshToken": token.RefreshToken,
		},
	})
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
}

func (h *TwitchHandler) handleStreamOffline(ctx context.Context, event json.RawMessage) {
	var e struct {
		BroadcasterUserID string `json:"broadcaster_user_id"`
	}
	json.Unmarshal(event, &e)

	slog.Info("stream offline", "twitchId", e.BroadcasterUserID)

	h.rdb.Del(ctx, "nexe:stream:"+e.BroadcasterUserID)
}

func (h *TwitchHandler) handleFollow(ctx context.Context, event json.RawMessage) {
	var e struct {
		UserID               string `json:"user_id"`
		UserLogin            string `json:"user_login"`
		BroadcasterUserID    string `json:"broadcaster_user_id"`
	}
	json.Unmarshal(event, &e)

	slog.Info("new follow", "from", e.UserLogin, "to", e.BroadcasterUserID)
	// TODO: auto-assign follower role in streamer servers
}

func (h *TwitchHandler) handleSubscribe(ctx context.Context, event json.RawMessage) {
	var e struct {
		UserID               string `json:"user_id"`
		UserLogin            string `json:"user_login"`
		BroadcasterUserID    string `json:"broadcaster_user_id"`
		Tier                 string `json:"tier"`
	}
	json.Unmarshal(event, &e)

	slog.Info("new subscription", "from", e.UserLogin, "to", e.BroadcasterUserID, "tier", e.Tier)
	// TODO: auto-assign subscriber role in streamer servers
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
