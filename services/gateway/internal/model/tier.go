package model

type TierLimits struct {
	Tier                string `json:"tier"`
	MaxOwnedGuilds      int    `json:"maxOwnedGuilds"`
	MaxEmojisPerGuild   int    `json:"maxEmojisPerGuild"`
	MaxStickersPerGuild int    `json:"maxStickersPerGuild"`
	MaxUploadBytes      int64  `json:"maxUploadBytes"`
	VoiceBitrate        int    `json:"voiceBitrate"`
	ScreenShareQuality  string `json:"screenShareQuality"`
	AnimatedAvatar      bool   `json:"animatedAvatar"`
	AnimatedBanner      bool   `json:"animatedBanner"`
	VideoBanner         bool   `json:"videoBanner"`
	ChatBridgeChannels  int    `json:"chatBridgeChannels"`
	AnalyticsDays       int    `json:"analyticsDays"`
	ServerBoosts        int    `json:"serverBoosts"`
	PrioritySupport     bool   `json:"prioritySupport"`
	MaxMessageLength    int    `json:"maxMessageLength"`
	MaxBioLength        int    `json:"maxBioLength"`
	MaxSocialLinks      int    `json:"maxSocialLinks"`
	MaxBadgesVisible    int    `json:"maxBadgesVisible"`
	MaxClipsShowcase    int    `json:"maxClipsShowcase"`
	ProfileEffects      bool   `json:"profileEffects"`
	ProfileMusic        bool   `json:"profileMusic"`
	CustomCSS           bool   `json:"customCss"`
	DragDropLayout      bool   `json:"dragDropLayout"`
	CustomBackground    bool   `json:"customBackground"`
	FeaturedServers     int    `json:"featuredServers"`
	VanitySlug          bool   `json:"vanitySlug"`
	VisitorCounter      bool   `json:"visitorCounter"`
	UploadStorageBytes  int64  `json:"uploadStorageBytes"`
}
