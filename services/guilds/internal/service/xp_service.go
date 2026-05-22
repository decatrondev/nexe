package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
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

// AwardJoinXP grants 50 XP for joining a server (once per server per user).
func (s *XPService) AwardJoinXP(ctx context.Context, userID, guildID string) {
	joinKey := fmt.Sprintf("nexe:xp:join:%s:%s", userID, guildID)

	if !s.rdb.SetNX(ctx, joinKey, "1", 0).Val() {
		return
	}

	body, _ := json.Marshal(map[string]interface{}{
		"userId": userID,
		"xp":     50,
		"reason": "server_join",
	})

	req, err := http.NewRequestWithContext(ctx, "POST", s.gatewayURL+"/internal/xp", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		slog.Debug("xp grant: request failed", "error", err, "user", userID)
		return
	}
	resp.Body.Close()
}
