package service

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/decatrondev/nexe/services/presence/internal/model"
	"github.com/redis/go-redis/v9"
)

const (
	presenceKeyPrefix = "nexe:presence:"
	guildOnlinePrefix = "nexe:guild:online:"
	presenceTTL       = 5 * time.Minute
)

type PresenceService struct {
	rdb    *redis.Client
	events *EventPublisher
}

func NewPresenceService(rdb *redis.Client) *PresenceService {
	return &PresenceService{
		rdb:    rdb,
		events: NewEventPublisher(rdb),
	}
}

func (s *PresenceService) SetPresence(ctx context.Context, userID string, update model.StatusUpdate) error {
	if !model.ValidStatuses[update.Status] {
		return fmt.Errorf("invalid status: %s", update.Status)
	}

	key := presenceKeyPrefix + userID
	data := map[string]interface{}{
		"status":      update.Status,
		"customText":  update.CustomText,
		"customEmoji": update.CustomEmoji,
		"lastSeen":    time.Now().UTC().Format(time.RFC3339),
	}

	pipe := s.rdb.Pipeline()
	pipe.HSet(ctx, key, data)
	pipe.Expire(ctx, key, presenceTTL)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("set presence: %w", err)
	}

	slog.Debug("presence updated", "userId", userID, "status", update.Status)

	// Publish presence update to guilds
	go s.events.PublishPresenceUpdate(ctx, userID, update.Status)

	return nil
}

func (s *PresenceService) GetPresence(ctx context.Context, userID string) (*model.UserPresence, error) {
	key := presenceKeyPrefix + userID
	data, err := s.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get presence: %w", err)
	}

	if len(data) == 0 {
		return &model.UserPresence{
			UserID:   userID,
			Status:   "offline",
			LastSeen: time.Now(),
		}, nil
	}

	presence := &model.UserPresence{
		UserID:      userID,
		Status:      data["status"],
		CustomText:  data["customText"],
		CustomEmoji: data["customEmoji"],
	}

	if lastSeen, err := time.Parse(time.RFC3339, data["lastSeen"]); err == nil {
		presence.LastSeen = lastSeen
	}

	if data["streamingLive"] == "true" {
		presence.StreamingLive = true
		presence.StreamTitle = data["streamTitle"]
		presence.StreamGame = data["streamGame"]
		if v, err := strconv.Atoi(data["streamViewers"]); err == nil {
			presence.StreamViewers = v
		}
		if t, err := time.Parse(time.RFC3339, data["streamStartedAt"]); err == nil {
			presence.StreamStartedAt = &t
		}
	}

	return presence, nil
}

func (s *PresenceService) Heartbeat(ctx context.Context, userID string) error {
	key := presenceKeyPrefix + userID
	exists, err := s.rdb.Exists(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("heartbeat check: %w", err)
	}

	if exists == 0 {
		return s.SetPresence(ctx, userID, model.StatusUpdate{Status: "online"})
	}

	pipe := s.rdb.Pipeline()
	pipe.HSet(ctx, key, "lastSeen", time.Now().UTC().Format(time.RFC3339))
	pipe.Expire(ctx, key, presenceTTL)
	_, err = pipe.Exec(ctx)
	return err
}

func (s *PresenceService) SetOffline(ctx context.Context, userID string) error {
	key := presenceKeyPrefix + userID
	pipe := s.rdb.Pipeline()
	pipe.HSet(ctx, key, "status", "offline", "lastSeen", time.Now().UTC().Format(time.RFC3339))
	pipe.Expire(ctx, key, 24*time.Hour) // keep offline presence for 24h
	_, err := pipe.Exec(ctx)
	return err
}

func (s *PresenceService) SetStreamStatus(ctx context.Context, userID string, stream model.StreamStatus) error {
	key := presenceKeyPrefix + userID

	if stream.Live {
		s.rdb.HSet(ctx, key,
			"streamingLive", "true",
			"streamTitle", stream.Title,
			"streamGame", stream.Game,
			"streamViewers", strconv.Itoa(stream.Viewers),
			"streamStartedAt", stream.StartedAt,
		)
	} else {
		s.rdb.HDel(ctx, key, "streamingLive", "streamTitle", "streamGame", "streamViewers", "streamStartedAt")
	}

	return nil
}

func (s *PresenceService) TrackGuildOnline(ctx context.Context, guildID, userID string) error {
	key := guildOnlinePrefix + guildID
	return s.rdb.SAdd(ctx, key, userID).Err()
}

func (s *PresenceService) UntrackGuildOnline(ctx context.Context, guildID, userID string) error {
	key := guildOnlinePrefix + guildID
	return s.rdb.SRem(ctx, key, userID).Err()
}

func (s *PresenceService) GetGuildOnline(ctx context.Context, guildID string) ([]string, error) {
	key := guildOnlinePrefix + guildID
	return s.rdb.SMembers(ctx, key).Result()
}

func (s *PresenceService) GetBulkPresence(ctx context.Context, userIDs []string) ([]model.UserPresence, error) {
	pipe := s.rdb.Pipeline()
	cmds := make([]*redis.MapStringStringCmd, len(userIDs))

	for i, uid := range userIDs {
		cmds[i] = pipe.HGetAll(ctx, presenceKeyPrefix+uid)
	}

	_, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("bulk presence: %w", err)
	}

	presences := make([]model.UserPresence, len(userIDs))
	for i, uid := range userIDs {
		data, _ := cmds[i].Result()
		if len(data) == 0 {
			presences[i] = model.UserPresence{UserID: uid, Status: "offline", LastSeen: time.Now()}
			continue
		}

		p := model.UserPresence{
			UserID:      uid,
			Status:      data["status"],
			CustomText:  data["customText"],
			CustomEmoji: data["customEmoji"],
		}
		if t, err := time.Parse(time.RFC3339, data["lastSeen"]); err == nil {
			p.LastSeen = t
		}
		if data["streamingLive"] == "true" {
			p.StreamingLive = true
			p.StreamTitle = data["streamTitle"]
			p.StreamGame = data["streamGame"]
			if v, err := strconv.Atoi(data["streamViewers"]); err == nil {
				p.StreamViewers = v
			}
		}
		presences[i] = p
	}

	return presences, nil
}

// GetGuildOnlinePresences returns presences for all online members of a guild
func (s *PresenceService) GetGuildOnlinePresences(ctx context.Context, guildID string) ([]model.UserPresence, error) {
	userIDs, err := s.GetGuildOnline(ctx, guildID)
	if err != nil {
		return nil, err
	}
	if len(userIDs) == 0 {
		return []model.UserPresence{}, nil
	}
	return s.GetBulkPresence(ctx, userIDs)
}

