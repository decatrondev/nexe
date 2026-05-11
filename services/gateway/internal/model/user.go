package model

import "time"

type User struct {
	ID                   string     `json:"id"`
	Username             string     `json:"username"`
	Email                string     `json:"email"`
	EmailVerified        bool       `json:"emailVerified"`
	PasswordHash         *string    `json:"-"`
	TwitchID             *string    `json:"twitchId,omitempty"`
	TwitchLogin          *string    `json:"twitchLogin,omitempty"`
	TwitchDisplayName    *string    `json:"twitchDisplayName,omitempty"`
	TwitchAccessToken    *string    `json:"-"`
	TwitchRefreshToken   *string    `json:"-"`
	Status               string     `json:"status"`
	CustomStatusText     *string    `json:"customStatusText,omitempty"`
	CustomStatusEmoji    *string    `json:"customStatusEmoji,omitempty"`
	Tier                 string     `json:"tier"`
	Flags                int64      `json:"flags"`
	Disabled             bool       `json:"disabled"`
	TOTPSecret           *string    `json:"-"`
	TOTPEnabled          bool       `json:"totpEnabled"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

type RecoveryCode struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Code      string    `json:"code"`
	Used      bool      `json:"used"`
	CreatedAt time.Time `json:"createdAt"`
}

type Session struct {
	ID               string    `json:"id"`
	UserID           string    `json:"userId"`
	RefreshTokenHash string    `json:"-"`
	DeviceName       *string   `json:"deviceName,omitempty"`
	IPAddress        *string   `json:"ipAddress,omitempty"`
	UserAgent        *string   `json:"userAgent,omitempty"`
	LastUsedAt       time.Time `json:"lastUsedAt"`
	ExpiresAt        time.Time `json:"expiresAt"`
	CreatedAt        time.Time `json:"createdAt"`
}

type EmailVerification struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Code      string    `json:"-"`
	Attempts  int       `json:"attempts"`
	ExpiresAt time.Time `json:"expiresAt"`
	Used      bool      `json:"used"`
}
