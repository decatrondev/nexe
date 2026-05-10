package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/redis/go-redis/v9"
)

// EventPublisher publishes domain events to Redis pub/sub channels
// so the gateway can broadcast them to connected WebSocket clients.
type EventPublisher struct {
	rdb *redis.Client
}

// NewEventPublisher creates an EventPublisher backed by the given Redis client.
func NewEventPublisher(rdb *redis.Client) *EventPublisher {
	return &EventPublisher{rdb: rdb}
}

// Event types for messaging.
const (
	EventMessageCreate = "MESSAGE_CREATE"
	EventMessageUpdate = "MESSAGE_UPDATE"
	EventMessageDelete = "MESSAGE_DELETE"
)

// Event is the envelope published to Redis.
type Event struct {
	Type      string      `json:"type"`
	GuildID   string      `json:"guildId"`
	ChannelID string      `json:"channelId"`
	UserID    string      `json:"userId,omitempty"` // sender — gateway excludes this user from broadcast
	Data      interface{} `json:"data"`
}

// Publish serialises an event and publishes it to the guild's Redis channel.
// Errors are logged but never returned — event publishing must not block the
// request path.
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
		slog.Debug("event published", "type", eventType, "guild", guildID, "channel", channelID)
	}
}
