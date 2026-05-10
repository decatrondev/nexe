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
	EventVoiceStateUpdate = "VOICE_STATE_UPDATE"
)

type Event struct {
	Type      string      `json:"type"`
	GuildID   string      `json:"guildId"`
	ChannelID string      `json:"channelId"`
	UserID    string      `json:"userId,omitempty"`
	Data      interface{} `json:"data"`
}

func (p *EventPublisher) Publish(ctx context.Context, guildID, channelID, eventType, userID string, data interface{}) {
	event := Event{
		Type:      eventType,
		GuildID:   guildID,
		ChannelID: channelID,
		UserID:    userID,
		Data:      data,
	}

	payload, err := json.Marshal(event)
	if err != nil {
		slog.Error("failed to marshal event", "error", err, "type", eventType)
		return
	}

	channel := fmt.Sprintf("nexe:events:guild:%s", guildID)
	if err := p.rdb.Publish(ctx, channel, payload).Err(); err != nil {
		slog.Error("failed to publish event", "error", err, "channel", channel, "type", eventType)
	} else {
		slog.Debug("event published", "type", eventType, "guild", guildID)
	}
}
