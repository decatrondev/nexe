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

// Event types for guild operations.
const (
	EventGuildMemberRemove = "GUILD_MEMBER_REMOVE"
	EventGuildMemberUpdate = "GUILD_MEMBER_UPDATE"
	EventGuildBanRemove    = "GUILD_BAN_REMOVE"
	EventGuildRoleCreate     = "GUILD_ROLE_CREATE"
	EventGuildRoleUpdate     = "GUILD_ROLE_UPDATE"
	EventGuildRoleDelete     = "GUILD_ROLE_DELETE"
	EventCategoryCreate      = "CATEGORY_CREATE"
	EventCategoryUpdate      = "CATEGORY_UPDATE"
	EventCategoryDelete      = "CATEGORY_DELETE"
)

// GuildEvent is the envelope published to Redis.
type GuildEvent struct {
	Type    string      `json:"type"`
	GuildID string      `json:"guildId"`
	Data    interface{} `json:"data"`
}

// Publish serialises an event and publishes it to the guild's Redis channel.
// Errors are logged but never returned -- event publishing must not block the
// request path.
func (p *EventPublisher) Publish(ctx context.Context, guildID, eventType string, data interface{}) {
	event := GuildEvent{
		Type:    eventType,
		GuildID: guildID,
		Data:    data,
	}

	payload, err := json.Marshal(event)
	if err != nil {
		slog.Error("failed to marshal guild event", "error", err, "type", eventType)
		return
	}

	channel := fmt.Sprintf("nexe:events:guild:%s", guildID)
	if err := p.rdb.Publish(ctx, channel, payload).Err(); err != nil {
		slog.Error("failed to publish guild event", "error", err, "channel", channel, "type", eventType)
	} else {
		slog.Debug("guild event published", "type", eventType, "guild", guildID)
	}
}
