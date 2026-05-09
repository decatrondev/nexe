package model

const (
	// General
	PermAdministrator     int64 = 1 << 0
	PermManageGuild       int64 = 1 << 1
	PermManageChannels    int64 = 1 << 2
	PermManageRoles       int64 = 1 << 3
	PermManageEmojis      int64 = 1 << 4
	PermViewAuditLog      int64 = 1 << 5
	PermManageWebhooks    int64 = 1 << 6
	PermManageGuildEvents int64 = 1 << 7

	// Members
	PermKickMembers    int64 = 1 << 8
	PermBanMembers     int64 = 1 << 9
	PermTimeoutMembers int64 = 1 << 10
	PermMuteMembers    int64 = 1 << 11
	PermDeafenMembers  int64 = 1 << 12
	PermMoveMembers    int64 = 1 << 13
	PermChangeNickname int64 = 1 << 14
	PermManageNicknames int64 = 1 << 15

	// Text
	PermSendMessages       int64 = 1 << 16
	PermSendTTS            int64 = 1 << 17
	PermManageMessages     int64 = 1 << 18
	PermEmbedLinks         int64 = 1 << 19
	PermAttachFiles        int64 = 1 << 20
	PermReadMessageHistory int64 = 1 << 21
	PermMentionEveryone    int64 = 1 << 22
	PermUseExternalEmojis  int64 = 1 << 23
	PermAddReactions       int64 = 1 << 24
	PermCreateThreads      int64 = 1 << 25
	PermManageThreads      int64 = 1 << 26

	// Voice
	PermConnect         int64 = 1 << 27
	PermSpeak           int64 = 1 << 28
	PermVideo           int64 = 1 << 29
	PermShareScreen     int64 = 1 << 30
	PermPrioritySpeaker int64 = 1 << 31

	// Invitations
	PermCreateInvite  int64 = 1 << 32
	PermManageInvites int64 = 1 << 33

	// Streamer
	PermViewAnalytics   int64 = 1 << 34
	PermManageAutoRoles int64 = 1 << 35
	PermManageChatBridge int64 = 1 << 36
)

// HasPermission checks if userPerms includes the given permission using bitwise AND.
func HasPermission(userPerms, perm int64) bool {
	return userPerms&perm == perm
}
