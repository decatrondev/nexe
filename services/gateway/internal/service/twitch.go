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
	"sync"
	"time"
)

type TwitchService struct {
	clientID     string
	clientSecret string
	redirectURI  string
	appToken     string
	tokenExpires time.Time
	tokenMu      sync.Mutex
}

func NewTwitchService(clientID, clientSecret, redirectURI string) *TwitchService {
	return &TwitchService{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
	}
}

func (s *TwitchService) GetClientID() string {
	return s.clientID
}

// GetAuthURL returns the Twitch OAuth2 authorization URL
func (s *TwitchService) GetAuthURL(state string) string {
	params := url.Values{
		"client_id":     {s.clientID},
		"redirect_uri":  {s.redirectURI},
		"response_type": {"code"},
		"scope":         {"user:read:email user:read:subscriptions user:read:follows moderator:read:followers channel:read:subscriptions moderation:read channel:read:vips user:read:chat user:write:chat user:bot"},
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

// RefreshToken refreshes an expired Twitch access token using a refresh token.
func (s *TwitchService) RefreshToken(ctx context.Context, refreshToken string) (*TwitchTokenResponse, error) {
	data := url.Values{
		"client_id":     {s.clientID},
		"client_secret": {s.clientSecret},
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	}

	resp, err := http.PostForm("https://id.twitch.tv/oauth2/token", data)
	if err != nil {
		return nil, fmt.Errorf("refresh token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("twitch refresh error (%d): %s", resp.StatusCode, string(body))
	}

	var token TwitchTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("decode refresh token: %w", err)
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
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()

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

// GetClip fetches clip data from Twitch API and resolves the MP4 video URL.
func (s *TwitchService) GetClip(ctx context.Context, clipID string) (map[string]interface{}, error) {
	token, err := s.GetAppToken(ctx)
	if err != nil {
		return nil, err
	}

	req, _ := http.NewRequestWithContext(ctx, "GET",
		"https://api.twitch.tv/helix/clips?id="+url.QueryEscape(clipID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", s.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get clip: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode clip: %w", err)
	}

	if len(result.Data) == 0 {
		return nil, fmt.Errorf("clip not found")
	}

	clip := result.Data[0]

	// Method 1: Old format — derive MP4 from thumbnail with -preview- pattern
	// Thumbnail: https://clips-media-assets2.twitch.tv/AT-cm|123-preview-480x272.jpg
	// Video:     https://clips-media-assets2.twitch.tv/AT-cm|123.mp4
	if thumb, ok := clip["thumbnail_url"].(string); ok {
		if idx := strings.Index(thumb, "-preview-"); idx != -1 {
			clip["video_url"] = thumb[:idx] + ".mp4"
			return clip, nil
		}
	}

	// Method 2: New format — use Twitch GQL to get direct MP4 URL from CloudFront
	videoURL := s.resolveClipVideoGQL(ctx, clipID)
	if videoURL != "" {
		clip["video_url"] = videoURL
	}

	return clip, nil
}

// GetClipsByBroadcaster fetches recent clips for a broadcaster from Twitch API.
func (s *TwitchService) GetClipsByBroadcaster(ctx context.Context, broadcasterID string, limit int) ([]map[string]interface{}, error) {
	token, err := s.GetAppToken(ctx)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 20 {
		limit = 12
	}

	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("https://api.twitch.tv/helix/clips?broadcaster_id=%s&first=%d", url.QueryEscape(broadcasterID), limit), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", s.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get clips: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode clips: %w", err)
	}

	// Resolve video URLs for each clip
	for _, clip := range result.Data {
		if thumb, ok := clip["thumbnail_url"].(string); ok {
			if idx := strings.Index(thumb, "-preview-"); idx != -1 {
				clip["video_url"] = thumb[:idx] + ".mp4"
				continue
			}
		}
		if slug, ok := clip["id"].(string); ok {
			if videoURL := s.resolveClipVideoGQL(ctx, slug); videoURL != "" {
				clip["video_url"] = videoURL
			}
		}
	}

	return result.Data, nil
}

// resolveClipVideoGQL uses Twitch's internal GQL API to get the direct MP4 URL for a clip.
// This handles the new CloudFront-based clip format that doesn't use the -preview- thumbnail pattern.
// Returns the full video URL including auth signature and token query params.
func (s *TwitchService) resolveClipVideoGQL(ctx context.Context, slug string) string {
	gqlPayload := fmt.Sprintf(
		`[{"operationName":"VideoAccessToken_Clip","variables":{"slug":"%s"},"extensions":{"persistedQuery":{"version":1,"sha256Hash":"36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11"}}}]`,
		slug,
	)

	req, err := http.NewRequestWithContext(ctx, "POST", "https://gql.twitch.tv/gql", strings.NewReader(gqlPayload))
	if err != nil {
		return ""
	}
	req.Header.Set("Client-ID", "kimne78kx3ncx6brgo4mv6wki5h1ko")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	var gqlResult []struct {
		Data struct {
			Clip struct {
				PlaybackAccessToken struct {
					Signature string `json:"signature"`
					Value     string `json:"value"`
				} `json:"playbackAccessToken"`
				VideoQualities []struct {
					Quality   string `json:"quality"`
					SourceURL string `json:"sourceURL"`
				} `json:"videoQualities"`
			} `json:"clip"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&gqlResult); err != nil || len(gqlResult) == 0 {
		return ""
	}

	clip := gqlResult[0].Data.Clip
	qualities := clip.VideoQualities
	if len(qualities) == 0 {
		return ""
	}

	// Prefer 720p, fallback to first available
	var sourceURL string
	for _, q := range qualities {
		if q.Quality == "720" {
			sourceURL = q.SourceURL
			break
		}
	}
	if sourceURL == "" {
		sourceURL = qualities[0].SourceURL
	}

	// Append auth params — CloudFront requires sig + token
	sig := clip.PlaybackAccessToken.Signature
	token := clip.PlaybackAccessToken.Value
	if sig != "" && token != "" {
		sourceURL += "?sig=" + sig + "&token=" + url.QueryEscape(token)
	}

	return sourceURL
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
// SubscribeEventSubWithToken creates an EventSub subscription using a specific token (user or app).
func (s *TwitchService) SubscribeEventSubWithToken(ctx context.Context, token, subType, version string, condition map[string]string, callbackURL, secret string) error {
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

// CheckFollower checks if userID follows broadcasterID.
// Requires the broadcaster's user token (moderator:read:followers scope).
func (s *TwitchService) CheckFollower(ctx context.Context, broadcasterID, userID string, broadcasterToken ...string) (bool, error) {
	var token string
	if len(broadcasterToken) > 0 && broadcasterToken[0] != "" {
		token = broadcasterToken[0]
	} else {
		var err error
		token, err = s.GetAppToken(ctx)
		if err != nil {
			return false, err
		}
	}

	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("https://api.twitch.tv/helix/channels/followers?broadcaster_id=%s&user_id=%s", broadcasterID, userID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", s.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("check follower: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Total int `json:"total"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Total > 0, nil
}

// CheckSubscription checks if userID is subscribed to broadcasterID and returns the tier ("1000", "2000", "3000") or empty.
// Requires broadcaster access token with channel:read:subscriptions scope.
func (s *TwitchService) CheckSubscription(ctx context.Context, broadcasterID, userID, broadcasterToken string) (bool, string, error) {
	token := broadcasterToken
	if token == "" {
		var err error
		token, err = s.GetAppToken(ctx)
		if err != nil {
			return false, "", err
		}
	}

	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("https://api.twitch.tv/helix/subscriptions/user?broadcaster_id=%s&user_id=%s", broadcasterID, userID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", s.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, "", fmt.Errorf("check subscription: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return false, "", nil
	}

	var result struct {
		Data []struct {
			Tier string `json:"tier"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	if len(result.Data) == 0 {
		return false, "", nil
	}
	return true, result.Data[0].Tier, nil
}

// CheckModerator checks if userID is a moderator for broadcasterID.
// Requires broadcaster access token with moderation:read scope.
func (s *TwitchService) CheckModerator(ctx context.Context, broadcasterID, userID, broadcasterToken string) (bool, error) {
	token := broadcasterToken
	if token == "" {
		var err error
		token, err = s.GetAppToken(ctx)
		if err != nil {
			return false, err
		}
	}

	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=%s&user_id=%s", broadcasterID, userID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", s.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("check moderator: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			UserID string `json:"user_id"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return len(result.Data) > 0, nil
}

// CheckVIP checks if userID is a VIP for broadcasterID.
// Requires broadcaster access token with channel:read:vips scope.
func (s *TwitchService) CheckVIP(ctx context.Context, broadcasterID, userID, broadcasterToken string) (bool, error) {
	token := broadcasterToken
	if token == "" {
		var err error
		token, err = s.GetAppToken(ctx)
		if err != nil {
			return false, err
		}
	}

	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("https://api.twitch.tv/helix/channels/vips?broadcaster_id=%s&user_id=%s", broadcasterID, userID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", s.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("check vip: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			UserID string `json:"user_id"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return len(result.Data) > 0, nil
}

// TwitchRoleSyncResult holds the results of a Twitch role sync check.
type TwitchRoleSyncResult struct {
	IsFollower  bool   `json:"isFollower"`
	IsSubscriber bool  `json:"isSubscriber"`
	SubTier     string `json:"subTier,omitempty"`
	IsMod       bool   `json:"isMod"`
	IsVIP       bool   `json:"isVip"`
}

// CheckUserTwitchStatus checks all Twitch statuses for a user against a broadcaster.
// broadcasterAccessToken is optional — needed for follower checks (moderator:read:followers scope).
func (s *TwitchService) CheckUserTwitchStatus(ctx context.Context, broadcasterID, userTwitchID, broadcasterAccessToken string) (*TwitchRoleSyncResult, error) {
	result := &TwitchRoleSyncResult{}

	// Check follower — needs broadcaster's user token
	isFollower, err := s.CheckFollower(ctx, broadcasterID, userTwitchID, broadcasterAccessToken)
	if err != nil {
		slog.Warn("twitch check follower failed", "error", err)
	}
	result.IsFollower = isFollower

	// Check subscription
	isSub, tier, err := s.CheckSubscription(ctx, broadcasterID, userTwitchID, broadcasterAccessToken)
	if err != nil {
		slog.Warn("twitch check subscription failed", "error", err)
	}
	result.IsSubscriber = isSub
	result.SubTier = tier

	// Check moderator (needs broadcaster token)
	isMod, err := s.CheckModerator(ctx, broadcasterID, userTwitchID, broadcasterAccessToken)
	if err != nil {
		slog.Warn("twitch check moderator failed", "error", err)
	}
	result.IsMod = isMod

	// Check VIP (needs broadcaster token)
	isVIP, err := s.CheckVIP(ctx, broadcasterID, userTwitchID, broadcasterAccessToken)
	if err != nil {
		slog.Warn("twitch check vip failed", "error", err)
	}
	result.IsVIP = isVIP

	return result, nil
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
