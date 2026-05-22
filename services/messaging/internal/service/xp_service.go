package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	xpMsgCooldownKey    = "nexe:xp:msg:%s"     // per-user message XP cooldown
	xpReactCooldownKey  = "nexe:xp:react:%s"    // per-user reaction XP counter
	xpDailyKey          = "nexe:xp:daily:%s:%s"  // per-user daily bonus (user:date)
	xpJoinKey           = "nexe:xp:join:%s:%s"   // per-user per-guild join (user:guild)

	xpMsgCooldown      = 60 * time.Second
	xpReactWindow      = 60 * time.Second
	xpReactMaxPerMin   = 5

	xpMsgMin           = 5
	xpMsgMax           = 15
	xpDailyBonus       = 25
	xpJoinAmount       = 50
	xpReactAmount      = 2
)

type XPService struct {
	rdb        *redis.Client
	gatewayURL string
	httpClient *http.Client
}

func NewXPService(rdb *redis.Client, gatewayURL string) *XPService {
	return &XPService{
		rdb:        rdb,
		gatewayURL: gatewayURL,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}
}

// AwardMessageXP grants XP for sending a message (5-15 random, 60s cooldown, daily bonus).
func (s *XPService) AwardMessageXP(ctx context.Context, userID string) {
	cooldownKey := fmt.Sprintf(xpMsgCooldownKey, userID)

	// Check cooldown
	if s.rdb.Exists(ctx, cooldownKey).Val() > 0 {
		return
	}

	// Set cooldown
	s.rdb.Set(ctx, cooldownKey, "1", xpMsgCooldown)

	// Random XP
	amount := xpMsgMin + rand.Intn(xpMsgMax-xpMsgMin+1)

	// Daily bonus — first message of the day
	today := time.Now().Format("2006-01-02")
	dailyKey := fmt.Sprintf(xpDailyKey, userID, today)
	if s.rdb.SetNX(ctx, dailyKey, "1", 24*time.Hour).Val() {
		amount += xpDailyBonus
	}

	s.grant(ctx, userID, int64(amount), "message")
}

// AwardReactionXP grants XP for adding a reaction (2 XP, max 5 per minute).
func (s *XPService) AwardReactionXP(ctx context.Context, userID string) {
	counterKey := fmt.Sprintf(xpReactCooldownKey, userID)

	count, err := s.rdb.Incr(ctx, counterKey).Result()
	if err != nil {
		return
	}
	if count == 1 {
		s.rdb.Expire(ctx, counterKey, xpReactWindow)
	}
	if count > xpReactMaxPerMin {
		return
	}

	s.grant(ctx, userID, xpReactAmount, "reaction")
}

// AwardJoinXP grants XP for joining a server (50 XP, once per server).
func (s *XPService) AwardJoinXP(ctx context.Context, userID, guildID string) {
	joinKey := fmt.Sprintf(xpJoinKey, userID, guildID)

	// Only award once per user per guild (never expires)
	if !s.rdb.SetNX(ctx, joinKey, "1", 0).Val() {
		return
	}

	s.grant(ctx, userID, xpJoinAmount, "server_join")
}

func (s *XPService) grant(ctx context.Context, userID string, xp int64, reason string) {
	body, _ := json.Marshal(map[string]interface{}{
		"userId": userID,
		"xp":     xp,
		"reason": reason,
	})

	req, err := http.NewRequestWithContext(ctx, "POST", s.gatewayURL+"/internal/xp", bytes.NewReader(body))
	if err != nil {
		slog.Warn("xp grant: create request failed", "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		slog.Debug("xp grant: request failed", "error", err, "user", userID, "xp", xp)
		return
	}
	resp.Body.Close()

	if resp.StatusCode >= 300 {
		slog.Debug("xp grant: non-ok status", "status", resp.StatusCode, "user", userID, "xp", xp)
	}
}
