package model

import "time"

// Notification types
const (
	TypeMention      = "mention"       // @user
	TypeRoleMention  = "role_mention"  // @role
	TypeEveryone     = "everyone"      // @everyone
	TypeReply        = "reply"         // reply to your message
	TypeWelcome      = "welcome"       // someone joined server
	TypeModeration   = "moderation"    // kick/ban/warn action on you
)

// Notification preference levels
const (
	PrefAll      = "all"      // all messages
	PrefMentions = "mentions" // only mentions (default)
	PrefNothing  = "nothing"  // muted
)

type Notification struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Type      string    `json:"type"`
	GuildID   string    `json:"guildId"`
	ChannelID string    `json:"channelId"`
	MessageID string    `json:"messageId,omitempty"`
	AuthorID  string    `json:"authorId,omitempty"`
	Content   string    `json:"content"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"createdAt"`
}

type NotificationPreference struct {
	UserID    string  `json:"userId"`
	GuildID   string  `json:"guildId"`
	ChannelID *string `json:"channelId,omitempty"` // nil = guild-level
	Level     string  `json:"level"`               // all, mentions, nothing
}

// MentionEvent is published by messaging service when a message contains mentions.
type MentionEvent struct {
	MessageID       string   `json:"messageId"`
	ChannelID       string   `json:"channelId"`
	GuildID         string   `json:"guildId"`
	AuthorID        string   `json:"authorId"`
	Content         string   `json:"content"`
	MentionUsers    []string `json:"mentionUsers,omitempty"`
	MentionRoles    []string `json:"mentionRoles,omitempty"`
	MentionEveryone bool     `json:"mentionEveryone"`
	ReplyToUserID   *string  `json:"replyToUserId,omitempty"`
}
