package model

import "time"

type Message struct {
	ID              string          `json:"id"`
	ChannelID       string          `json:"channelId"`
	AuthorID        string          `json:"authorId"`
	Content         string          `json:"content"`
	Type            string          `json:"type"`
	BridgeSource    *string         `json:"bridgeSource,omitempty"`
	BridgeAuthor    *string         `json:"bridgeAuthor,omitempty"`
	BridgeAuthorID  *string         `json:"bridgeAuthorId,omitempty"`
	ReplyToID       *string         `json:"replyToId,omitempty"`
	ThreadID        *string         `json:"threadId,omitempty"`
	EditedAt        *time.Time      `json:"editedAt,omitempty"`
	Deleted         bool            `json:"deleted"`
	Pinned          bool            `json:"pinned"`
	PinnedBy        *string         `json:"pinnedBy,omitempty"`
	Embeds          []Embed         `json:"embeds,omitempty"`
	MentionEveryone bool            `json:"mentionEveryone"`
	Attachments     []Attachment    `json:"attachments,omitempty"`
	Reactions       []ReactionGroup `json:"reactions,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
}

type Embed struct {
	Title        string `json:"title,omitempty"`
	Description  string `json:"description,omitempty"`
	URL          string `json:"url,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	ProviderName string `json:"providerName,omitempty"`
}

type Attachment struct {
	ID          string `json:"id"`
	MessageID   string `json:"messageId"`
	Filename    string `json:"filename"`
	URL         string `json:"url"`
	ContentType string `json:"contentType"`
	SizeBytes   int64  `json:"sizeBytes"`
	Width       *int   `json:"width,omitempty"`
	Height      *int   `json:"height,omitempty"`
}

type ReactionGroup struct {
	Emoji string   `json:"emoji"`
	Count int      `json:"count"`
	Users []string `json:"users"`
}

type MessageEdit struct {
	ID         string    `json:"id"`
	MessageID  string    `json:"messageId"`
	OldContent string    `json:"oldContent"`
	EditedAt   time.Time `json:"editedAt"`
}
