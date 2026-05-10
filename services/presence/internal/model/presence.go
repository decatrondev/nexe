package model

import "time"

type UserPresence struct {
	UserID          string     `json:"userId"`
	Status          string     `json:"status"`
	CustomText      string     `json:"customText,omitempty"`
	CustomEmoji     string     `json:"customEmoji,omitempty"`
	StreamingLive   bool       `json:"streamingLive,omitempty"`
	StreamTitle     string     `json:"streamTitle,omitempty"`
	StreamGame      string     `json:"streamGame,omitempty"`
	StreamViewers   int        `json:"streamViewers,omitempty"`
	StreamStartedAt *time.Time `json:"streamStartedAt,omitempty"`
	LastSeen        time.Time  `json:"lastSeen"`
}

type StatusUpdate struct {
	Status      string `json:"status"`
	CustomText  string `json:"customText,omitempty"`
	CustomEmoji string `json:"customEmoji,omitempty"`
}

type StreamStatus struct {
	Live      bool   `json:"live"`
	Title     string `json:"title,omitempty"`
	Game      string `json:"game,omitempty"`
	Viewers   int    `json:"viewers,omitempty"`
	StartedAt string `json:"startedAt,omitempty"`
}

var ValidStatuses = map[string]bool{
	"online":    true,
	"idle":      true,
	"dnd":       true,
	"offline":   true,
	"invisible": true,
}
