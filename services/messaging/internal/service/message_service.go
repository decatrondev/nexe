package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/decatrondev/nexe/services/messaging/internal/model"
	"github.com/decatrondev/nexe/services/messaging/internal/repository"
)

type MessageService struct {
	messages  *repository.MessageRepository
	reactions *repository.ReactionRepository
	events    *EventPublisher
}

func NewMessageService(messages *repository.MessageRepository, reactions *repository.ReactionRepository, events *EventPublisher) *MessageService {
	return &MessageService{
		messages:  messages,
		reactions: reactions,
		events:    events,
	}
}

// SendMessage validates content and creates a new message.
func (s *MessageService) SendMessage(ctx context.Context, channelID, authorID, content string, replyToID *string) (*model.Message, error) {
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("message content cannot be empty")
	}

	msg := &model.Message{
		ChannelID: channelID,
		AuthorID:  authorID,
		Content:   content,
		Type:      "default",
		ReplyToID: replyToID,
	}

	if err := s.messages.Create(ctx, msg); err != nil {
		return nil, fmt.Errorf("send message: %w", err)
	}

	slog.Debug("message sent", "id", msg.ID, "channel", channelID, "author", authorID)

	// Publish MESSAGE_CREATE event to Redis.
	if s.events != nil {
		go func() {
			guildID, err := s.messages.GetChannelGuildID(context.Background(), channelID)
			if err != nil {
				slog.Error("failed to resolve guild for event", "error", err, "channel", channelID)
				return
			}
			s.events.Publish(context.Background(), guildID, channelID, EventMessageCreate, authorID, msg)
		}()
	}

	return msg, nil
}

// SendBridgeMessage creates a message from an external platform (Twitch, Kick, etc).
func (s *MessageService) SendBridgeMessage(ctx context.Context, channelID, content string, bridgeSource, bridgeAuthor, bridgeAuthorID *string) (*model.Message, error) {
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("message content cannot be empty")
	}

	msg := &model.Message{
		ChannelID:      channelID,
		Content:        content,
		Type:           "bridge",
		BridgeSource:   bridgeSource,
		BridgeAuthor:   bridgeAuthor,
		BridgeAuthorID: bridgeAuthorID,
	}

	if err := s.messages.Create(ctx, msg); err != nil {
		return nil, fmt.Errorf("send bridge message: %w", err)
	}

	slog.Debug("bridge message created", "id", msg.ID, "channel", channelID, "source", bridgeSource)

	if s.events != nil {
		go func() {
			guildID, err := s.messages.GetChannelGuildID(context.Background(), channelID)
			if err != nil {
				return
			}
			s.events.Publish(context.Background(), guildID, channelID, EventMessageCreate, "", msg)
		}()
	}

	return msg, nil
}

// GetMessage retrieves a single message by ID.
func (s *MessageService) GetMessage(ctx context.Context, id string) (*model.Message, error) {
	msg, err := s.messages.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}
	if msg == nil {
		return nil, fmt.Errorf("message not found")
	}
	if msg.Deleted {
		return nil, fmt.Errorf("message not found")
	}
	return msg, nil
}

// ListMessages returns paginated messages for a channel.
func (s *MessageService) ListMessages(ctx context.Context, channelID string, before *string, limit int) ([]model.Message, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	messages, err := s.messages.ListByChannel(ctx, channelID, before, limit)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	return messages, nil
}

// EditMessage updates message content. Only the author can edit their own messages.
func (s *MessageService) EditMessage(ctx context.Context, messageID, authorID, newContent string) error {
	if strings.TrimSpace(newContent) == "" {
		return fmt.Errorf("message content cannot be empty")
	}

	msg, err := s.messages.GetByID(ctx, messageID)
	if err != nil {
		return fmt.Errorf("edit message: %w", err)
	}
	if msg == nil || msg.Deleted {
		return fmt.Errorf("message not found")
	}
	if msg.AuthorID != authorID {
		return fmt.Errorf("permission denied: only the author can edit this message")
	}

	if err := s.messages.Update(ctx, messageID, newContent); err != nil {
		return fmt.Errorf("edit message: %w", err)
	}

	slog.Debug("message edited", "id", messageID, "author", authorID)

	// Publish MESSAGE_UPDATE event to Redis.
	if s.events != nil {
		go func() {
			guildID, err := s.messages.GetChannelGuildID(context.Background(), msg.ChannelID)
			if err != nil {
				slog.Error("failed to resolve guild for event", "error", err, "channel", msg.ChannelID)
				return
			}
			// Re-fetch the updated message to include the edited_at timestamp.
			updated, err := s.messages.GetByID(context.Background(), messageID)
			if err != nil || updated == nil {
				slog.Error("failed to fetch updated message for event", "error", err, "id", messageID)
				return
			}
			s.events.Publish(context.Background(), guildID, msg.ChannelID, EventMessageUpdate, authorID, updated)
		}()
	}

	return nil
}

// DeleteMessage soft-deletes a message.
func (s *MessageService) DeleteMessage(ctx context.Context, messageID, requesterID string) error {
	msg, err := s.messages.GetByID(ctx, messageID)
	if err != nil {
		return fmt.Errorf("delete message: %w", err)
	}
	if msg == nil || msg.Deleted {
		return fmt.Errorf("message not found")
	}

	// For now anyone can delete; permission check will be added when gateway proxies.
	if err := s.messages.Delete(ctx, messageID); err != nil {
		return fmt.Errorf("delete message: %w", err)
	}

	slog.Debug("message deleted", "id", messageID, "by", requesterID)

	// Publish MESSAGE_DELETE event to Redis.
	if s.events != nil {
		go func() {
			guildID, err := s.messages.GetChannelGuildID(context.Background(), msg.ChannelID)
			if err != nil {
				slog.Error("failed to resolve guild for event", "error", err, "channel", msg.ChannelID)
				return
			}
			s.events.Publish(context.Background(), guildID, msg.ChannelID, EventMessageDelete, requesterID, map[string]string{
				"id":        messageID,
				"channelId": msg.ChannelID,
			})
		}()
	}

	return nil
}

// PinMessage pins a message in its channel.
func (s *MessageService) PinMessage(ctx context.Context, messageID, requesterID string) error {
	msg, err := s.messages.GetByID(ctx, messageID)
	if err != nil {
		return fmt.Errorf("pin message: %w", err)
	}
	if msg == nil || msg.Deleted {
		return fmt.Errorf("message not found")
	}

	if err := s.messages.Pin(ctx, messageID, requesterID); err != nil {
		return fmt.Errorf("pin message: %w", err)
	}

	slog.Debug("message pinned", "id", messageID, "by", requesterID)
	return nil
}

// UnpinMessage unpins a message.
func (s *MessageService) UnpinMessage(ctx context.Context, messageID, requesterID string) error {
	msg, err := s.messages.GetByID(ctx, messageID)
	if err != nil {
		return fmt.Errorf("unpin message: %w", err)
	}
	if msg == nil || msg.Deleted {
		return fmt.Errorf("message not found")
	}

	if err := s.messages.Unpin(ctx, messageID); err != nil {
		return fmt.Errorf("unpin message: %w", err)
	}

	slog.Debug("message unpinned", "id", messageID, "by", requesterID)
	return nil
}

// ListPins returns all pinned messages in a channel.
func (s *MessageService) ListPins(ctx context.Context, channelID string) ([]model.Message, error) {
	pins, err := s.messages.ListPins(ctx, channelID)
	if err != nil {
		return nil, fmt.Errorf("list pins: %w", err)
	}
	return pins, nil
}

// SearchMessages performs full-text search within a channel.
func (s *MessageService) SearchMessages(ctx context.Context, channelID, query string, limit int) ([]model.Message, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("search query cannot be empty")
	}
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}

	results, err := s.messages.Search(ctx, channelID, query, nil, limit)
	if err != nil {
		return nil, fmt.Errorf("search messages: %w", err)
	}
	return results, nil
}

// GetEditHistory returns the edit history for a message.
func (s *MessageService) GetEditHistory(ctx context.Context, messageID string) ([]model.MessageEdit, error) {
	msg, err := s.messages.GetByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("get edit history: %w", err)
	}
	if msg == nil || msg.Deleted {
		return nil, fmt.Errorf("message not found")
	}

	edits, err := s.messages.GetEditHistory(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("get edit history: %w", err)
	}
	return edits, nil
}

// AddReaction adds a reaction to a message.
func (s *MessageService) AddReaction(ctx context.Context, messageID, userID, emoji string) error {
	msg, err := s.messages.GetByID(ctx, messageID)
	if err != nil {
		return fmt.Errorf("add reaction: %w", err)
	}
	if msg == nil || msg.Deleted {
		return fmt.Errorf("message not found")
	}

	if err := s.reactions.Add(ctx, messageID, userID, emoji); err != nil {
		return fmt.Errorf("add reaction: %w", err)
	}
	return nil
}

// RemoveReaction removes a user's reaction from a message.
func (s *MessageService) RemoveReaction(ctx context.Context, messageID, userID, emoji string) error {
	if err := s.reactions.Remove(ctx, messageID, userID, emoji); err != nil {
		return fmt.Errorf("remove reaction: %w", err)
	}
	return nil
}

// GetReactions returns grouped reactions for a message.
func (s *MessageService) GetReactions(ctx context.Context, messageID string) ([]model.ReactionGroup, error) {
	groups, err := s.reactions.ListByMessage(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("get reactions: %w", err)
	}
	return groups, nil
}

// RemoveAllReactions removes all reactions from a message.
func (s *MessageService) RemoveAllReactions(ctx context.Context, messageID string) error {
	if err := s.reactions.RemoveAll(ctx, messageID); err != nil {
		return fmt.Errorf("remove all reactions: %w", err)
	}
	return nil
}

// ---- Read States ----

func (s *MessageService) AckChannel(ctx context.Context, userID, channelID, messageID string) error {
	return s.messages.AckChannel(ctx, userID, channelID, messageID)
}

func (s *MessageService) GetUnreadChannels(ctx context.Context, userID string) ([]repository.UnreadChannel, error) {
	return s.messages.GetUnreadChannels(ctx, userID)
}
