package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type TwitchService struct {
	clientID     string
	clientSecret string
	redirectURI  string
	appToken     string
	tokenExpires time.Time
}

func NewTwitchService(clientID, clientSecret, redirectURI string) *TwitchService {
	return &TwitchService{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
	}
}

// GetAuthURL returns the Twitch OAuth2 authorization URL
func (s *TwitchService) GetAuthURL(state string) string {
	params := url.Values{
		"client_id":     {s.clientID},
		"redirect_uri":  {s.redirectURI},
		"response_type": {"code"},
		"scope":         {"user:read:email user:read:subscriptions user:read:follows moderator:read:followers channel:read:subscriptions"},
		"state":         {state},
	}
	return "https://id.twitch.tv/oauth2/authorize?" + params.Encode()
}

// ExchangeCode exchanges an authorization code for tokens
func (s *TwitchService) ExchangeCode(ctx context.Context, code string) (*TwitchTokenResponse, error) {
	data := url.Values{
		"client_id":     {s.clientID},
		"client_secret": {s.clientSecret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {s.redirectURI},
	}

	resp, err := http.PostForm("https://id.twitch.tv/oauth2/token", data)
	if err != nil {
		return nil, fmt.Errorf("exchange code: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("twitch token error: %s", string(body))
	}

	var token TwitchTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("decode token: %w", err)
	}

	return &token, nil
}

// GetUser gets the authenticated user's info
func (s *TwitchService) GetUser(ctx context.Context, accessToken string) (*TwitchUser, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.twitch.tv/helix/users", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Client-Id", s.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data []TwitchUser `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode user: %w", err)
	}

	if len(result.Data) == 0 {
		return nil, fmt.Errorf("no user data returned")
	}

	return &result.Data[0], nil
}

// GetAppToken gets a client credentials token for app-level API calls
func (s *TwitchService) GetAppToken(ctx context.Context) (string, error) {
	if s.appToken != "" && time.Now().Before(s.tokenExpires) {
		return s.appToken, nil
	}

	data := url.Values{
		"client_id":     {s.clientID},
		"client_secret": {s.clientSecret},
		"grant_type":    {"client_credentials"},
	}

	resp, err := http.PostForm("https://id.twitch.tv/oauth2/token", data)
	if err != nil {
		return "", fmt.Errorf("get app token: %w", err)
	}
	defer resp.Body.Close()

	var token TwitchTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return "", fmt.Errorf("decode app token: %w", err)
	}

	s.appToken = token.AccessToken
	s.tokenExpires = time.Now().Add(time.Duration(token.ExpiresIn-60) * time.Second)

	return s.appToken, nil
}

// GetStreamByUserID checks if a user is currently streaming
func (s *TwitchService) GetStreamByUserID(ctx context.Context, twitchUserID string) (*TwitchStream, error) {
	token, err := s.GetAppToken(ctx)
	if err != nil {
		return nil, err
	}

	req, _ := http.NewRequestWithContext(ctx, "GET",
		"https://api.twitch.tv/helix/streams?user_id="+twitchUserID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", s.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get stream: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data []TwitchStream `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode stream: %w", err)
	}

	if len(result.Data) == 0 {
		return nil, nil // not live
	}

	return &result.Data[0], nil
}

// SubscribeEventSub creates an EventSub subscription
func (s *TwitchService) SubscribeEventSub(ctx context.Context, subType, version string, condition map[string]string, callbackURL, secret string) error {
	token, err := s.GetAppToken(ctx)
	if err != nil {
		return err
	}

	body := map[string]interface{}{
		"type":    subType,
		"version": version,
		"condition": condition,
		"transport": map[string]string{
			"method":   "webhook",
			"callback": callbackURL,
			"secret":   secret,
		},
	}

	bodyJSON, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, "POST",
		"https://api.twitch.tv/helix/eventsub/subscriptions",
		strings.NewReader(string(bodyJSON)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", s.clientID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("subscribe eventsub: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 202 && resp.StatusCode != 200 && resp.StatusCode != 409 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("eventsub error (%d): %s", resp.StatusCode, string(respBody))
	}

	slog.Info("eventsub subscribed", "type", subType)
	return nil
}

// Types

type TwitchTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Scope        []string `json:"scope"`
}

type TwitchUser struct {
	ID              string `json:"id"`
	Login           string `json:"login"`
	DisplayName     string `json:"display_name"`
	Email           string `json:"email"`
	ProfileImageURL string `json:"profile_image_url"`
	BroadcasterType string `json:"broadcaster_type"`
}

type TwitchStream struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	UserLogin   string `json:"user_login"`
	GameName    string `json:"game_name"`
	Title       string `json:"title"`
	ViewerCount int    `json:"viewer_count"`
	StartedAt   string `json:"started_at"`
	ThumbnailURL string `json:"thumbnail_url"`
}
