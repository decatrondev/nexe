package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/decatrondev/nexe/services/guilds/internal/service"
	"github.com/redis/go-redis/v9"
)

var emotePattern = regexp.MustCompile(`:([a-zA-Z0-9_]+):`)

const maxEmotesPerMessage = 20

type Emote struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Animated bool   `json:"animated"`
	Source   string `json:"source"`
}

type EmoteSet struct {
	Twitch        []Emote `json:"twitch"`
	SevenTV       []Emote `json:"seventv"`
	BTTV          []Emote `json:"bttv"`
	FFZ           []Emote `json:"ffz"`
	TwitchGlobal  []Emote `json:"twitchGlobal"`
	SevenTVGlobal []Emote `json:"seventvGlobal"`
	BTTVGlobal    []Emote `json:"bttvGlobal"`
}

type EmoteHandler struct {
	svc *service.GuildService
	rdb *redis.Client
	db  *sql.DB
}

func NewEmoteHandler(svc *service.GuildService, rdb *redis.Client, db *sql.DB) *EmoteHandler {
	return &EmoteHandler{svc: svc, rdb: rdb, db: db}
}

func (h *EmoteHandler) GetEmotes(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")

	guild, err := h.svc.GetGuild(r.Context(), guildID)
	if err != nil || guild == nil {
		writeJSON(w, http.StatusOK, EmoteSet{})
		return
	}

	twitchID := ""
	if guild.StreamerTwitchID != nil {
		twitchID = *guild.StreamerTwitchID
	}

	// Try Redis cache first
	cacheKey := fmt.Sprintf("nexe:emotes:%s", guildID)
	cached, err := h.rdb.Get(r.Context(), cacheKey).Bytes()
	if err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write(cached)
		return
	}

	// Fetch all sources in parallel
	var result EmoteSet
	var mu sync.Mutex
	var wg sync.WaitGroup

	if twitchID != "" {
		wg.Add(4)
		go func() { defer wg.Done(); e := fetchTwitchChannelEmotes(twitchID); mu.Lock(); result.Twitch = e; mu.Unlock() }()
		go func() { defer wg.Done(); e := fetch7TVChannelEmotes(twitchID); mu.Lock(); result.SevenTV = e; mu.Unlock() }()
		go func() { defer wg.Done(); e := fetchBTTVChannelEmotes(twitchID); mu.Lock(); result.BTTV = e; mu.Unlock() }()
		go func() { defer wg.Done(); e := fetchFFZChannelEmotes(twitchID); mu.Lock(); result.FFZ = e; mu.Unlock() }()
	}

	// Globals
	wg.Add(3)
	go func() { defer wg.Done(); e := fetchTwitchGlobalEmotes(); mu.Lock(); result.TwitchGlobal = e; mu.Unlock() }()
	go func() { defer wg.Done(); e := fetch7TVGlobalEmotes(); mu.Lock(); result.SevenTVGlobal = e; mu.Unlock() }()
	go func() { defer wg.Done(); e := fetchBTTVGlobalEmotes(); mu.Lock(); result.BTTVGlobal = e; mu.Unlock() }()

	wg.Wait()

	data, _ := json.Marshal(result)
	h.rdb.Set(r.Context(), cacheKey, data, 3*time.Minute)

	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// ── Twitch Global ──

var (
	twitchGlobalCache     []Emote
	twitchGlobalCacheTime time.Time
	twitchGlobalMu        sync.Mutex
)

func fetchTwitchGlobalEmotes() []Emote {
	twitchGlobalMu.Lock()
	defer twitchGlobalMu.Unlock()

	if twitchGlobalCache != nil && time.Since(twitchGlobalCacheTime) < 10*time.Minute {
		return twitchGlobalCache
	}

	body := httpGet("https://emotes.adamcy.pl/v1/global/emotes/twitch")
	if body == nil {
		return twitchGlobalCache
	}

	var raw []struct {
		Code string `json:"code"`
		URLs []struct {
			Size string `json:"size"`
			URL  string `json:"url"`
		} `json:"urls"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}

	emotes := make([]Emote, 0, len(raw))
	for _, e := range raw {
		url := pickURL(e.URLs)
		if url != "" {
			emotes = append(emotes, Emote{Name: e.Code, URL: url, Source: "twitch_global"})
		}
	}

	twitchGlobalCache = emotes
	twitchGlobalCacheTime = time.Now()
	return emotes
}

// ── Twitch Channel ──

func fetchTwitchChannelEmotes(twitchID string) []Emote {
	body := httpGet(fmt.Sprintf("https://emotes.adamcy.pl/v1/channel/%s/emotes/twitch", twitchID))
	if body == nil {
		return nil
	}

	var raw []struct {
		Code string `json:"code"`
		URLs []struct {
			Size string `json:"size"`
			URL  string `json:"url"`
		} `json:"urls"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}

	emotes := make([]Emote, 0, len(raw))
	for _, e := range raw {
		url := pickURL(e.URLs)
		if url != "" {
			emotes = append(emotes, Emote{Name: e.Code, URL: url, Source: "twitch"})
		}
	}
	return emotes
}

func pickURL(urls []struct {
	Size string `json:"size"`
	URL  string `json:"url"`
}) string {
	for _, u := range urls {
		if u.Size == "2" || u.Size == "2x" {
			return u.URL
		}
	}
	if len(urls) > 0 {
		return urls[0].URL
	}
	return ""
}

// ── 7TV Channel ──

func fetch7TVChannelEmotes(twitchID string) []Emote {
	body := httpGet(fmt.Sprintf("https://7tv.io/v3/users/twitch/%s", twitchID))
	if body == nil {
		return nil
	}
	return parse7TVEmotes(body, "seventv")
}

// ── 7TV Global ──

var (
	seventvGlobalCache     []Emote
	seventvGlobalCacheTime time.Time
	seventvGlobalMu        sync.Mutex
)

func fetch7TVGlobalEmotes() []Emote {
	seventvGlobalMu.Lock()
	defer seventvGlobalMu.Unlock()

	if seventvGlobalCache != nil && time.Since(seventvGlobalCacheTime) < 10*time.Minute {
		return seventvGlobalCache
	}

	body := httpGet("https://7tv.io/v3/emote-sets/global")
	if body == nil {
		return seventvGlobalCache
	}

	var raw struct {
		Emotes []struct {
			Name string `json:"name"`
			Data struct {
				Animated bool `json:"animated"`
				Host     struct {
					URL   string `json:"url"`
					Files []struct {
						Name string `json:"name"`
					} `json:"files"`
				} `json:"host"`
			} `json:"data"`
		} `json:"emotes"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}

	emotes := make([]Emote, 0, len(raw.Emotes))
	for _, e := range raw.Emotes {
		url := pick7TVURL(e.Data.Host.URL, e.Data.Host.Files)
		if url != "" {
			emotes = append(emotes, Emote{Name: e.Name, URL: url, Animated: e.Data.Animated, Source: "seventv_global"})
		}
	}

	seventvGlobalCache = emotes
	seventvGlobalCacheTime = time.Now()
	return emotes
}

func parse7TVEmotes(body []byte, source string) []Emote {
	var raw struct {
		EmoteSet struct {
			Emotes []struct {
				Name string `json:"name"`
				Data struct {
					Animated bool `json:"animated"`
					Host     struct {
						URL   string `json:"url"`
						Files []struct {
							Name string `json:"name"`
						} `json:"files"`
					} `json:"host"`
				} `json:"data"`
			} `json:"emotes"`
		} `json:"emote_set"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}

	emotes := make([]Emote, 0, len(raw.EmoteSet.Emotes))
	for _, e := range raw.EmoteSet.Emotes {
		url := pick7TVURL(e.Data.Host.URL, e.Data.Host.Files)
		if url != "" {
			emotes = append(emotes, Emote{Name: e.Name, URL: url, Animated: e.Data.Animated, Source: source})
		}
	}
	return emotes
}

func pick7TVURL(hostURL string, files []struct{ Name string `json:"name"` }) string {
	for _, f := range files {
		if f.Name == "2x.webp" {
			return "https:" + hostURL + "/" + f.Name
		}
	}
	for _, f := range files {
		if f.Name == "1x.webp" {
			return "https:" + hostURL + "/" + f.Name
		}
	}
	return ""
}

// ── BTTV Channel ──

func fetchBTTVChannelEmotes(twitchID string) []Emote {
	body := httpGet(fmt.Sprintf("https://api.betterttv.net/3/cached/users/twitch/%s", twitchID))
	if body == nil {
		return nil
	}

	var raw struct {
		ChannelEmotes []bttvEmote `json:"channelEmotes"`
		SharedEmotes  []bttvEmote `json:"sharedEmotes"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}

	all := append(raw.ChannelEmotes, raw.SharedEmotes...)
	return parseBTTVEmotes(all, "bttv")
}

// ── BTTV Global ──

var (
	bttvGlobalCache     []Emote
	bttvGlobalCacheTime time.Time
	bttvGlobalMu        sync.Mutex
)

func fetchBTTVGlobalEmotes() []Emote {
	bttvGlobalMu.Lock()
	defer bttvGlobalMu.Unlock()

	if bttvGlobalCache != nil && time.Since(bttvGlobalCacheTime) < 10*time.Minute {
		return bttvGlobalCache
	}

	body := httpGet("https://api.betterttv.net/3/cached/emotes/global")
	if body == nil {
		return bttvGlobalCache
	}

	var raw []bttvEmote
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}

	bttvGlobalCache = parseBTTVEmotes(raw, "bttv_global")
	bttvGlobalCacheTime = time.Now()
	return bttvGlobalCache
}

type bttvEmote struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	ImageType string `json:"imageType"`
}

func parseBTTVEmotes(raw []bttvEmote, source string) []Emote {
	emotes := make([]Emote, 0, len(raw))
	for _, e := range raw {
		// BTTV CDN requires no extension — the /2x path works directly
		url := fmt.Sprintf("https://cdn.betterttv.net/emote/%s/2x", e.ID)
		emotes = append(emotes, Emote{
			Name:     e.Code,
			URL:      url,
			Animated: e.ImageType == "gif",
			Source:   source,
		})
	}
	return emotes
}

// ── FFZ Channel ──

func fetchFFZChannelEmotes(twitchID string) []Emote {
	body := httpGet(fmt.Sprintf("https://api.frankerfacez.com/v1/room/id/%s", twitchID))
	if body == nil {
		return nil
	}

	var raw struct {
		Sets map[string]struct {
			Emoticons []struct {
				Name string            `json:"name"`
				URLs map[string]string `json:"urls"`
			} `json:"emoticons"`
		} `json:"sets"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}

	var emotes []Emote
	for _, set := range raw.Sets {
		for _, e := range set.Emoticons {
			url := e.URLs["2"]
			if url == "" {
				url = e.URLs["1"]
			}
			if url != "" {
				if len(url) > 2 && url[:2] == "//" {
					url = "https:" + url
				}
				emotes = append(emotes, Emote{Name: e.Name, URL: url, Source: "ffz"})
			}
		}
	}
	return emotes
}

// ValidateEmotes checks emotes in a message for tier restrictions.
// Strips cross-server emotes for free users, enforces max emote count.
func (h *EmoteHandler) ValidateEmotes(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	var body struct {
		Content string `json:"content"`
		UserID  string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	// Find all :emote: in content
	matches := emotePattern.FindAllStringIndex(body.Content, -1)
	if len(matches) == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{"content": body.Content, "modified": false})
		return
	}

	// Rate limit: max emotes per message
	if len(matches) > maxEmotesPerMessage {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"blocked": true,
			"reason":  fmt.Sprintf("too many emotes (max %d per message)", maxEmotesPerMessage),
		})
		return
	}

	// Get user tier
	userTier := h.getUserTier(r.Context(), body.UserID)
	isPremium := userTier == "nexe" || userTier == "nexe_plus"

	// If premium, allow everything
	if isPremium {
		writeJSON(w, http.StatusOK, map[string]interface{}{"content": body.Content, "modified": false})
		return
	}

	// Ensure emote cache is populated for this guild
	h.ensureEmoteCache(r.Context(), guildID)

	// Free user — check each emote belongs to this guild or is global
	guildEmotes := h.getGuildEmoteNames(r.Context(), guildID)
	globalEmotes := h.getGlobalEmoteNames(r.Context())

	result := body.Content
	modified := false
	emoteNames := emotePattern.FindAllStringSubmatch(body.Content, -1)
	for _, match := range emoteNames {
		name := match[1]
		if guildEmotes[name] || globalEmotes[name] {
			continue // allowed
		}
		// Cross-server emote, free user → strip it (leave as text)
		// Actually we just leave it as-is — it won't render for anyone
		// because the emote won't be in their lookup for this guild
		// But to be explicit, we could strip the colons
		result = strings.Replace(result, ":"+name+":", name, 1)
		modified = true
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"content":  result,
		"modified": modified,
	})
}

func (h *EmoteHandler) getUserTier(ctx context.Context, userID string) string {
	var tier string
	err := h.db.QueryRowContext(ctx,
		`SELECT tier FROM user_tiers WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
		userID,
	).Scan(&tier)
	if err != nil {
		return "free"
	}
	return tier
}

func (h *EmoteHandler) ensureEmoteCache(ctx context.Context, guildID string) {
	cacheKey := fmt.Sprintf("nexe:emotes:%s", guildID)
	exists, _ := h.rdb.Exists(ctx, cacheKey).Result()
	if exists > 0 {
		return
	}
	// Simulate a GET /emotes request to populate cache
	guild, err := h.svc.GetGuild(ctx, guildID)
	if err != nil || guild == nil {
		return
	}
	twitchID := ""
	if guild.StreamerTwitchID != nil {
		twitchID = *guild.StreamerTwitchID
	}

	var result EmoteSet
	var mu sync.Mutex
	var wg sync.WaitGroup

	if twitchID != "" {
		wg.Add(4)
		go func() { defer wg.Done(); e := fetchTwitchChannelEmotes(twitchID); mu.Lock(); result.Twitch = e; mu.Unlock() }()
		go func() { defer wg.Done(); e := fetch7TVChannelEmotes(twitchID); mu.Lock(); result.SevenTV = e; mu.Unlock() }()
		go func() { defer wg.Done(); e := fetchBTTVChannelEmotes(twitchID); mu.Lock(); result.BTTV = e; mu.Unlock() }()
		go func() { defer wg.Done(); e := fetchFFZChannelEmotes(twitchID); mu.Lock(); result.FFZ = e; mu.Unlock() }()
	}
	wg.Add(3)
	go func() { defer wg.Done(); e := fetchTwitchGlobalEmotes(); mu.Lock(); result.TwitchGlobal = e; mu.Unlock() }()
	go func() { defer wg.Done(); e := fetch7TVGlobalEmotes(); mu.Lock(); result.SevenTVGlobal = e; mu.Unlock() }()
	go func() { defer wg.Done(); e := fetchBTTVGlobalEmotes(); mu.Lock(); result.BTTVGlobal = e; mu.Unlock() }()
	wg.Wait()

	data, _ := json.Marshal(result)
	h.rdb.Set(ctx, cacheKey, data, 3*time.Minute)
}

func (h *EmoteHandler) getGuildEmoteNames(ctx context.Context, guildID string) map[string]bool {
	cacheKey := fmt.Sprintf("nexe:emotes:%s", guildID)
	cached, err := h.rdb.Get(ctx, cacheKey).Bytes()
	if err != nil {
		return map[string]bool{}
	}
	var set EmoteSet
	json.Unmarshal(cached, &set)

	names := map[string]bool{}
	for _, e := range set.Twitch { names[e.Name] = true }
	for _, e := range set.SevenTV { names[e.Name] = true }
	for _, e := range set.BTTV { names[e.Name] = true }
	for _, e := range set.FFZ { names[e.Name] = true }
	return names
}

func (h *EmoteHandler) getGlobalEmoteNames(ctx context.Context) map[string]bool {
	names := map[string]bool{}
	// Global emotes are cached in memory
	for _, e := range twitchGlobalCache { names[e.Name] = true }
	for _, e := range seventvGlobalCache { names[e.Name] = true }
	for _, e := range bttvGlobalCache { names[e.Name] = true }
	return names
}

// ── HTTP helper ──

func httpGet(url string) []byte {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Debug("emote fetch failed", "url", url, "error", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	return data
}
