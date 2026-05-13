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

// PublishPresenceUpdate publishes a presence change to all guilds the user belongs to.
// The gateway subscribes to nexe:events:guild:* and will broadcast it.
func (p *EventPublisher) PublishPresenceUpdate(ctx context.Context, userID, status string) {
	// Get all guilds this user is tracked in
	guildKeys, err := p.rdb.Keys(ctx, "nexe:guild:online:*").Result()
	if err != nil {
		return
	}

	data := map[string]string{"userId": userID, "status": status}
	payload, _ := json.Marshal(data)

	for _, key := range guildKeys {
		isMember, _ := p.rdb.SIsMember(ctx, key, userID).Result()
		if !isMember {
			continue
		}
		// Extract guildID from key
		guildID := key[len("nexe:guild:online:"):]

		event := map[string]interface{}{
			"type":    "PRESENCE_UPDATE",
			"guildId": guildID,
			"data":    json.RawMessage(payload),
		}
		eventJSON, _ := json.Marshal(event)
		channel := fmt.Sprintf("nexe:events:guild:%s", guildID)
		if err := p.rdb.Publish(ctx, channel, eventJSON).Err(); err != nil {
			slog.Error("failed to publish presence event", "error", err, "guild", guildID)
		}
	}
}

// PublishStreamStatusUpdate publishes a stream status change to all guilds the user belongs to.
func (p *EventPublisher) PublishStreamStatusUpdate(ctx context.Context, userID string, live bool, title, game string, viewers int, startedAt, thumbnail string) {
	guildKeys, err := p.rdb.Keys(ctx, "nexe:guild:online:*").Result()
	if err != nil {
		return
	}

	data := map[string]interface{}{
		"userId": userID,
		"live":   live,
	}
	if live {
		data["title"] = title
		data["game"] = game
		data["viewers"] = viewers
		data["startedAt"] = startedAt
		data["thumbnail"] = thumbnail
	}
	payload, _ := json.Marshal(data)

	for _, key := range guildKeys {
		isMember, _ := p.rdb.SIsMember(ctx, key, userID).Result()
		if !isMember {
			continue
		}
		guildID := key[len("nexe:guild:online:"):]

		event := map[string]interface{}{
			"type":    "STREAM_STATUS_UPDATE",
			"guildId": guildID,
			"data":    json.RawMessage(payload),
		}
		eventJSON, _ := json.Marshal(event)
		channel := fmt.Sprintf("nexe:events:guild:%s", guildID)
		if err := p.rdb.Publish(ctx, channel, eventJSON).Err(); err != nil {
			slog.Error("failed to publish stream status event", "error", err, "guild", guildID)
		}
	}
}
