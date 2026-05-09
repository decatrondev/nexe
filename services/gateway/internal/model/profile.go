package model

import "time"

type Profile struct {
	UserID         string       `json:"userId"`
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

// XP thresholds per level
var LevelThresholds = []int64{
	0, 0, 100, 250, 500, 800,       // 0-5
	1200, 1700, 2300, 3000, 3800,    // 6-10
	4700, 5700, 6800, 8000, 9300,    // 11-15
	10700, 12200, 13800, 15500, 17300, // 16-20
	19200, 21200, 23300, 25500, 27800, // 21-25
	30200, 32700, 35300, 38000, 40800, // 26-30
}

func CalculateLevel(totalXP int64) int {
	for i := len(LevelThresholds) - 1; i >= 0; i-- {
		if totalXP >= LevelThresholds[i] {
			return i
		}
	}
	return 1
}
