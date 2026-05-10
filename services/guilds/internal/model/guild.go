package model

import "time"

type Guild struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	IconUrl          string   `json:"iconUrl"`
	BannerUrl        string   `json:"bannerUrl"`
	OwnerID          string   `json:"ownerId"`
	IsStreamerServer  bool     `json:"isStreamerServer"`
	StreamerTwitchID *string  `json:"streamerTwitchId,omitempty"`
	MemberCount      int      `json:"memberCount"`
	Features         []string `json:"features"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Category struct {
	ID        string    `json:"id"`
	GuildID   string    `json:"guildId"`
	Name      string    `json:"name"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
}

type Channel struct {
	ID               string    `json:"id"`
	GuildID          string    `json:"guildId"`
	CategoryID       *string   `json:"categoryId,omitempty"`
	Name             string    `json:"name"`
	Topic            string    `json:"topic"`
	Type             string    `json:"type"`
	Position         int       `json:"position"`
	SlowmodeSeconds  int       `json:"slowmodeSeconds"`
	IsSubOnly        bool      `json:"isSubOnly"`
	IsLiveChannel    bool      `json:"isLiveChannel"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Role struct {
	ID          string    `json:"id"`
	GuildID     string    `json:"guildId"`
	Name        string    `json:"name"`
	Color       *string   `json:"color,omitempty"`
	Position    int       `json:"position"`
	Permissions int64     `json:"permissions"`
	Mentionable bool      `json:"mentionable"`
	Hoisted     bool      `json:"hoisted"`
	IsDefault   bool      `json:"isDefault"`
	IsAuto      bool      `json:"isAuto"`
	AutoSource  *string   `json:"autoSource,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type GuildMember struct {
	ID         string     `json:"id"`
	GuildID    string     `json:"guildId"`
	UserID     string     `json:"userId"`
	Nickname   *string    `json:"nickname,omitempty"`
	RoleIds    []string   `json:"roleIds"`
	JoinedAt   time.Time  `json:"joinedAt"`
	Muted      bool       `json:"muted"`
	MutedUntil *time.Time `json:"mutedUntil,omitempty"`
}

type Invite struct {
	Code      string     `json:"code"`
	GuildID   string     `json:"guildId"`
	ChannelID string     `json:"channelId"`
	InviterID string     `json:"inviterId"`
	MaxUses   *int       `json:"maxUses,omitempty"`
	Uses      *int       `json:"uses,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

type Ban struct {
	GuildID   string    `json:"guildId"`
	UserID    string    `json:"userId"`
	BannedBy  string    `json:"bannedBy"`
	Reason    *string   `json:"reason,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type ModerationLog struct {
	ID              string    `json:"id"`
	GuildID         string    `json:"guildId"`
	ModeratorID     string    `json:"moderatorId"`
	TargetID        string    `json:"targetId"`
	Action          string    `json:"action"`
	Reason          *string   `json:"reason,omitempty"`
	DurationSeconds *int      `json:"durationSeconds,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}
