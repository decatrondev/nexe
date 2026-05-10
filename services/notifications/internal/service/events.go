package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/redis/go-redis/v9"
)

type EventPublisher struct {
	rdb *redis.Client
}

func NewEventPublisher(rdb *redis.Client) *EventPublisher {
	return &EventPublisher{rdb: rdb}
}

const (
	EventNotificationCreate = "NOTIFICATION_CREATE"
)

type Event struct {
	Type      string      `json:"type"`
	GuildID   string      `json:"guildId"`
	ChannelID string      `json:"channelId"`
	UserID    string      `json:"userId,omitempty"`
	Data      interface{} `json:"data"`
}

// PublishToUser sends a notification event targeted at a specific user.
// We publish to a user-specific Redis channel so the gateway can route it.
func (p *EventPublisher) PublishToUser(ctx context.Context, userID string, data interface{}) {
	event := Event{
		Type:   EventNotificationCreate,
		UserID: userID,
		Data:   data,
	}

	payload, err := json.Marshal(event)
	if err != nil {
		slog.Error("failed to marshal notification event", "error", err)
		return
	}

	channel := fmt.Sprintf("nexe:notifications:user:%s", userID)
	if err := p.rdb.Publish(ctx, channel, payload).Err(); err != nil {
		slog.Error("failed to publish notification", "error", err, "user", userID)
	}
}
