package model

// TierLimits defines resource limits for a subscription tier.
type TierLimits struct {
	MaxServersOwned     int
	MaxServersJoined    int
	MaxChannelsPerGuild int
	MaxRolesPerGuild    int
}

// FreeTierLimits defines resource limits for free-tier users.
var FreeTierLimits = TierLimits{
	MaxServersOwned:     5,
	MaxServersJoined:    100,
	MaxChannelsPerGuild: 50,
	MaxRolesPerGuild:    25,
}
