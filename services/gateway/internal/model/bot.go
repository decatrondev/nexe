package model

import "time"

type BotApplication struct {
	ID           string   `json:"id"`
	OwnerID      string   `json:"ownerId"`
	Name         string   `json:"name"`
	Description  *string  `json:"description,omitempty"`
	IconUrl      *string  `json:"iconUrl,omitempty"`
	ClientID     string   `json:"clientId"`
	ClientSecret string   `json:"clientSecret,omitempty"` // only shown once on creation
	RedirectURIs []string `json:"redirectUris"`
	Scopes       []string `json:"scopes"`
	BotUserID    *string  `json:"botUserId,omitempty"`
	Public       bool     `json:"public"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// Available bot scopes
var ValidBotScopes = map[string]string{
	"read:messages":    "Read messages in channels the bot has access to",
	"send:messages":    "Send messages in channels",
	"read:guilds":      "Read guild info, channels, roles",
	"manage:guilds":    "Manage guild settings",
	"read:members":     "Read member lists and info",
	"manage:members":   "Kick, ban, timeout members",
	"read:roles":       "Read roles and permissions",
	"manage:roles":     "Create, edit, delete, assign roles",
	"read:channels":    "Read channel info",
	"manage:channels":  "Create, edit, delete channels",
	"read:presence":    "Read user presence/status",
	"read:profiles":    "Read user profiles",
	"manage:reactions": "Add/remove reactions",
	"manage:threads":   "Create and manage threads",
	"manage:invites":   "Create and manage invites",
	"read:analytics":   "Read server analytics",
}

type BotToken struct {
	AccessToken string   `json:"accessToken"`
	TokenType   string   `json:"tokenType"`
	ExpiresIn   int      `json:"expiresIn"`
	Scopes      []string `json:"scopes"`
}
