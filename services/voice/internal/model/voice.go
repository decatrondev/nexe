package model

// VoiceState represents a user's current voice connection state.
type VoiceState struct {
	UserID     string `json:"userId"`
	GuildID    string `json:"guildId"`
	ChannelID  string `json:"channelId"`
	Muted      bool   `json:"muted"`
	Deafened   bool   `json:"deafened"`
	SelfMute   bool   `json:"selfMute"`
	SelfDeaf   bool   `json:"selfDeaf"`
	Speaking   bool   `json:"speaking"`
	Streaming  bool   `json:"streaming"`
	StreamType string `json:"streamType,omitempty"` // "camera", "screen", ""
}

// JoinRequest is the payload to join a voice channel.
type JoinRequest struct {
	ChannelID string `json:"channelId"`
	GuildID   string `json:"guildId"`
}

// JoinResponse returns the LiveKit token to connect.
type JoinResponse struct {
	Token     string       `json:"token"`
	URL       string       `json:"url"`
	Participants []VoiceState `json:"participants"`
}
