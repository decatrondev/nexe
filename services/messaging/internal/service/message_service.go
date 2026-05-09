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
}

func NewMessageService(messages *repository.MessageRepository, reactions *repository.ReactionRepository) *MessageService {
	return &MessageService{
		messages:  messages,
		reactions: reactions,
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
