package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/decatrondev/nexe/services/notifications/internal/model"
	"github.com/decatrondev/nexe/services/notifications/internal/repository"
)

type NotificationService struct {
	notifications *repository.NotificationRepository
	preferences   *repository.PreferenceRepository
	events        *EventPublisher
	rdb           *redis.Client
	email         *EmailService
	messagingURL  string
	guildsURL     string
}

func NewNotificationService(
	notifications *repository.NotificationRepository,
	preferences *repository.PreferenceRepository,
	events *EventPublisher,
	rdb *redis.Client,
	email *EmailService,
	messagingURL string,
	guildsURL string,
) *NotificationService {
	return &NotificationService{
		notifications: notifications,
		preferences:   preferences,
		events:        events,
		rdb:           rdb,
		email:         email,
		messagingURL:  messagingURL,
		guildsURL:     guildsURL,
	}
}

// GetNotifications returns a user's notifications.
func (s *NotificationService) GetNotifications(ctx context.Context, userID string, limit int, unreadOnly bool) ([]model.Notification, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.notifications.GetByUser(ctx, userID, limit, unreadOnly)
}

// CountUnread returns the count of unread notifications.
func (s *NotificationService) CountUnread(ctx context.Context, userID string) (int, error) {
	return s.notifications.CountUnread(ctx, userID)
}

// MarkRead marks a single notification as read.
func (s *NotificationService) MarkRead(ctx context.Context, userID, notifID string) error {
	return s.notifications.MarkRead(ctx, userID, notifID)
}

// MarkAllRead marks all notifications as read for a user.
func (s *NotificationService) MarkAllRead(ctx context.Context, userID string) error {
	return s.notifications.MarkAllRead(ctx, userID)
}

// DeleteNotification deletes a single notification.
func (s *NotificationService) DeleteNotification(ctx context.Context, userID, notifID string) error {
	return s.notifications.Delete(ctx, userID, notifID)
}

// GetPreference returns notification preference for a guild.
func (s *NotificationService) GetPreference(ctx context.Context, userID, guildID string) (*model.NotificationPreference, error) {
	return s.preferences.Get(ctx, userID, guildID)
}

// SendDigest sends email notifications to users with unread notifications.
func (s *NotificationService) SendDigest(ctx context.Context) (int, error) {
	users, err := s.notifications.GetDigestUsers(ctx, 24)
	if err != nil {
		return 0, err
	}

	sent := 0
	for _, u := range users {
		if err := s.email.SendDigest(ctx, u.Email, u.Username, u.Count); err != nil {
			slog.Error("failed to send digest email", "error", err, "user", u.UserID)
			continue
		}
		sent++
	}
	return sent, nil
}

// SetPreference updates notification preference.
func (s *NotificationService) SetPreference(ctx context.Context, pref *model.NotificationPreference) error {
	if pref.Level != model.PrefAll && pref.Level != model.PrefMentions && pref.Level != model.PrefNothing {
		pref.Level = model.PrefMentions
	}
	return s.preferences.Upsert(ctx, pref)
}

// ProcessMentionEvent handles a mention event from the messaging service.
// It creates notifications for mentioned users and publishes real-time events.
func (s *NotificationService) ProcessMentionEvent(ctx context.Context, event *model.MentionEvent) {
	// Collect all users that should be notified
	notifySet := make(map[string]string) // userId -> notification type

	// @everyone
	if event.MentionEveryone {
		members := s.getGuildMemberIDs(ctx, event.GuildID)
		for _, uid := range members {
			if uid != event.AuthorID {
				notifySet[uid] = model.TypeEveryone
			}
		}
	}

	// @role mentions
	for _, roleID := range event.MentionRoles {
		members := s.getRoleMemberIDs(ctx, event.GuildID, roleID)
		for _, uid := range members {
			if uid != event.AuthorID {
				if _, exists := notifySet[uid]; !exists {
					notifySet[uid] = model.TypeRoleMention
				}
			}
		}
	}

	// @user mentions
	for _, uid := range event.MentionUsers {
		if uid != event.AuthorID {
			notifySet[uid] = model.TypeMention
		}
	}

	// Reply notifications
	if event.ReplyToUserID != nil && *event.ReplyToUserID != event.AuthorID {
		if _, exists := notifySet[*event.ReplyToUserID]; !exists {
			notifySet[*event.ReplyToUserID] = model.TypeReply
		}
	}

	// Truncate content for notification preview
	preview := event.Content
	if len(preview) > 100 {
		preview = preview[:100] + "..."
	}

	// Create notifications for each user (respecting preferences)
	for userID, notifType := range notifySet {
		// Check user preference
		pref, err := s.preferences.Get(ctx, userID, event.GuildID)
		if err != nil {
			slog.Error("failed to get notification preference", "error", err, "user", userID)
			continue
		}

		// Skip if muted
		if pref.Level == model.PrefNothing {
			continue
		}

		// For "mentions" level, only notify on direct mentions, replies, and @everyone
		// For "all" level, notify on everything (handled by message event, not here)

		notif := &model.Notification{
			UserID:    userID,
			Type:      notifType,
			GuildID:   event.GuildID,
			ChannelID: event.ChannelID,
			MessageID: event.MessageID,
			AuthorID:  event.AuthorID,
			Content:   preview,
		}

		if err := s.notifications.Create(ctx, notif); err != nil {
			slog.Error("failed to create notification", "error", err, "user", userID)
			continue
		}

		// Publish real-time notification event to the user
		s.events.PublishToUser(ctx, userID, notif)
	}
}

// StartEventSubscriber listens for mention events from the messaging service.
func (s *NotificationService) StartEventSubscriber(ctx context.Context) {
	sub := s.rdb.PSubscribe(ctx, "nexe:events:guild:*")
	defer sub.Close()

	slog.Info("notification event subscriber started")

	for msg := range sub.Channel() {
		var event struct {
			Type      string          `json:"type"`
			GuildID   string          `json:"guildId"`
			ChannelID string          `json:"channelId"`
			UserID    string          `json:"userId"`
			Data      json.RawMessage `json:"data"`
		}

		if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
			continue
		}

		switch event.Type {
		case "MESSAGE_CREATE":
			s.handleMessageCreate(ctx, event.GuildID, event.ChannelID, event.UserID, event.Data)
		}
	}
}

func (s *NotificationService) handleMessageCreate(ctx context.Context, guildID, channelID, authorID string, data json.RawMessage) {
	var msg struct {
		ID              string  `json:"id"`
		Content         string  `json:"content"`
		AuthorID        string  `json:"authorId"`
		MentionEveryone bool    `json:"mentionEveryone"`
		ReplyToID       *string `json:"replyToId,omitempty"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}

	// Parse @mentions from content: <@userId> for users, <@&roleId> for roles
	mentionUsers := parseMentionUsers(msg.Content)
	mentionRoles := parseMentionRoles(msg.Content)

	// Check if @everyone is in content
	mentionEveryone := msg.MentionEveryone || strings.Contains(msg.Content, "@everyone")

	// If no mentions, reply, or @everyone, skip
	if len(mentionUsers) == 0 && len(mentionRoles) == 0 && !mentionEveryone && msg.ReplyToID == nil {
		return
	}

	// Resolve reply target user
	var replyToUserID *string
	if msg.ReplyToID != nil {
		uid := s.getMessageAuthor(ctx, *msg.ReplyToID)
		if uid != "" {
			replyToUserID = &uid
		}
	}

	mentionEvent := &model.MentionEvent{
		MessageID:       msg.ID,
		ChannelID:       channelID,
		GuildID:         guildID,
		AuthorID:        authorID,
		Content:         msg.Content,
		MentionUsers:    mentionUsers,
		MentionRoles:    mentionRoles,
		MentionEveryone: mentionEveryone,
		ReplyToUserID:   replyToUserID,
	}

	s.ProcessMentionEvent(ctx, mentionEvent)
}

// parseMentionUsers extracts user IDs from <@userId> patterns.
func parseMentionUsers(content string) []string {
	var ids []string
	for {
		idx := strings.Index(content, "<@")
		if idx == -1 {
			break
		}
		content = content[idx+2:]
		// Skip role mentions <@&...>
		if len(content) > 0 && content[0] == '&' {
			continue
		}
		end := strings.Index(content, ">")
		if end == -1 {
			break
		}
		id := content[:end]
		if len(id) > 0 && id[0] != '&' {
			ids = append(ids, id)
		}
		content = content[end+1:]
	}
	return ids
}

// parseMentionRoles extracts role IDs from <@&roleId> patterns.
func parseMentionRoles(content string) []string {
	var ids []string
	for {
		idx := strings.Index(content, "<@&")
		if idx == -1 {
			break
		}
		content = content[idx+3:]
		end := strings.Index(content, ">")
		if end == -1 {
			break
		}
		ids = append(ids, content[:end])
		content = content[end+1:]
	}
	return ids
}

// getGuildMemberIDs fetches all member user IDs for a guild.
func (s *NotificationService) getGuildMemberIDs(ctx context.Context, guildID string) []string {
	resp, err := http.Get(s.guildsURL + "/guilds/" + guildID + "/members?limit=1000")
	if err != nil || resp.StatusCode != 200 {
		return nil
	}
	defer resp.Body.Close()

	var members []struct {
		UserID string `json:"userId"`
	}
	if json.NewDecoder(resp.Body).Decode(&members) != nil {
		return nil
	}

	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.UserID
	}
	return ids
}

// getRoleMemberIDs returns user IDs that have a specific role.
func (s *NotificationService) getRoleMemberIDs(ctx context.Context, guildID, roleID string) []string {
	// Get all members and filter by role
	allMembers := s.getGuildMemberIDs(ctx, guildID)
	// For now, return all members for role mentions
	// TODO: filter by actual role assignment when guild service supports it
	_ = roleID
	return allMembers
}

// getMessageAuthor resolves the author of a message for reply notifications.
func (s *NotificationService) getMessageAuthor(ctx context.Context, messageID string) string {
	// Check Redis cache first
	key := "nexe:message:" + messageID + ":author"
	author, err := s.rdb.Get(ctx, key).Result()
	if err == nil {
		return author
	}

	// Fall back to messaging service HTTP API
	resp, err := http.Get(s.messagingURL + "/messages/" + messageID)
	if err != nil || resp.StatusCode != 200 {
		return ""
	}
	defer resp.Body.Close()
	var msg struct {
		AuthorID string `json:"authorId"`
	}
	if json.NewDecoder(resp.Body).Decode(&msg) == nil && msg.AuthorID != "" {
		// Cache for future lookups
		s.rdb.Set(ctx, key, msg.AuthorID, 24*time.Hour)
		return msg.AuthorID
	}
	return ""
}
