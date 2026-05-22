package model

import (
	"math"
	"time"
)

type Profile struct {
	UserID         string       `json:"userId"`
	Username       string       `json:"username"`
	DisplayName    *string      `json:"displayName,omitempty"`
	Bio            *string      `json:"bio,omitempty"`
	AvatarUrl      *string      `json:"avatarUrl,omitempty"`
	BannerUrl      *string      `json:"bannerUrl,omitempty"`
	AccentColor    *string      `json:"accentColor,omitempty"`
	BackgroundUrl  *string      `json:"backgroundUrl,omitempty"`
	Layout         interface{}  `json:"layout"`
	SocialLinks    interface{}  `json:"socialLinks"`
	FeaturedClips  interface{}  `json:"featuredClips"`
	StreamSchedule interface{}  `json:"streamSchedule"`
	Visibility     interface{}  `json:"visibility"`
	Level          int          `json:"level"`
	TotalXP        int64        `json:"totalXp"`
	CreatedAt      time.Time    `json:"createdAt"`
	UpdatedAt      time.Time    `json:"updatedAt"`
	TwitchID       *string      `json:"twitchId,omitempty"`
	TwitchLogin    *string      `json:"twitchLogin,omitempty"`
}

type Badge struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Description  *string `json:"description,omitempty"`
	IconUrl      string  `json:"iconUrl"`
	Type         string  `json:"type"` // global, server, achievement
	GuildID      *string `json:"guildId,omitempty"`
	TierRequired string  `json:"tierRequired"`
	CreatedAt    time.Time `json:"createdAt"`
}

type UserBadge struct {
	Badge
	Displayed    bool      `json:"displayed"`
	DisplayOrder int       `json:"displayOrder"`
	EarnedAt     time.Time `json:"earnedAt"`
}

type ProfileActivity struct {
	ID        string      `json:"id"`
	UserID    string      `json:"userId"`
	Type      string      `json:"type"` // clip_shared, server_joined, badge_earned, message_milestone, level_up
	Data      interface{} `json:"data"`
	Public    bool        `json:"public"`
	CreatedAt time.Time   `json:"createdAt"`
}

// XpForLevel returns the XP needed to go from level n to n+1.
// Formula: 100 * n^1.8 — scales infinitely, no cap.
func XpForLevel(n int) int64 {
	if n < 1 {
		return 0
	}
	return int64(100.0 * math.Pow(float64(n), 1.8))
}

// CumulativeXp returns the total XP needed to reach a given level.
func CumulativeXp(level int) int64 {
	var total int64
	for i := 1; i < level; i++ {
		total += XpForLevel(i)
	}
	return total
}

// CalculateLevel returns the level for a given total XP amount.
func CalculateLevel(totalXP int64) int {
	level := 1
	var accumulated int64
	for {
		needed := XpForLevel(level)
		if accumulated+needed > totalXP {
			return level
		}
		accumulated += needed
		level++
	}
}
