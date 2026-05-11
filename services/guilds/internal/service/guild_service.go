package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
	"github.com/decatrondev/nexe/services/guilds/internal/repository"
	"github.com/redis/go-redis/v9"
)

type GuildService struct {
	guilds     *repository.GuildRepository
	channels   *repository.ChannelRepository
	categories *repository.CategoryRepository
	roles      *repository.RoleRepository
	members    *repository.MemberRepository
	invites    *repository.InviteRepository
	moderation *repository.ModerationRepository
	automod    *repository.AutomodRepository
	events     *EventPublisher
	rdb        *redis.Client
}

func NewGuildService(
	guilds *repository.GuildRepository,
	channels *repository.ChannelRepository,
	categories *repository.CategoryRepository,
	roles *repository.RoleRepository,
	members *repository.MemberRepository,
	invites *repository.InviteRepository,
	moderation *repository.ModerationRepository,
	automod *repository.AutomodRepository,
	events *EventPublisher,
	rdb *redis.Client,
) *GuildService {
	return &GuildService{
		guilds:     guilds,
		channels:   channels,
		categories: categories,
		roles:      roles,
		members:    members,
		invites:    invites,
		moderation: moderation,
		automod:    automod,
		events:     events,
		rdb:        rdb,
	}
}

// ---------------------------------------------------------------------------
// Permission helper
// ---------------------------------------------------------------------------

func (s *GuildService) checkPermission(ctx context.Context, guildID, userID string, perm int64) error {
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return fmt.Errorf("check permission: %w", err)
	}
	if guild == nil {
		return fmt.Errorf("guild not found")
	}
	if guild.OwnerID == userID {
		return nil // owner always has all permissions
	}

	member, err := s.members.GetByGuildAndUser(ctx, guildID, userID)
	if err != nil {
		return fmt.Errorf("check permission: %w", err)
	}
	if member == nil {
		return fmt.Errorf("not a member of this guild")
	}

	perms, err := s.members.GetMemberPermissions(ctx, member.ID, guildID)
	if err != nil {
		return fmt.Errorf("check permission: %w", err)
	}
	if model.HasPermission(perms, model.PermAdministrator) {
		return nil
	}
	if !model.HasPermission(perms, perm) {
		return fmt.Errorf("missing permission")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Guild CRUD
// ---------------------------------------------------------------------------

func (s *GuildService) CreateGuild(ctx context.Context, name, description string, ownerID string, isStreamer bool) (*model.Guild, error) {
	// Validate name length
	if len(name) < 2 || len(name) > 100 {
		return nil, fmt.Errorf("server name must be between 2 and 100 characters")
	}

	// Enforce tier limit: max servers owned
	count, err := s.guilds.CountByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("create guild: %w", err)
	}
	if count >= model.FreeTierLimits.MaxServersOwned {
		return nil, fmt.Errorf("server limit reached: you can own up to %d servers", model.FreeTierLimits.MaxServersOwned)
	}

	guild := &model.Guild{
		Name:            name,
		Description:     description,
		OwnerID:         ownerID,
		IsStreamerServer: isStreamer,
	}

	if err := s.guilds.Create(ctx, guild); err != nil {
		return nil, fmt.Errorf("create guild: %w", err)
	}

	// Add owner as first member
	_, err = s.members.Add(ctx, guild.ID, ownerID)
	if err != nil {
		return nil, fmt.Errorf("create guild add owner: %w", err)
	}

	slog.Info("guild created", "guild_id", guild.ID, "owner_id", ownerID)
	return guild, nil
}

func (s *GuildService) GetGuild(ctx context.Context, id string) (*model.Guild, error) {
	guild, err := s.guilds.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get guild: %w", err)
	}
	if guild == nil {
		return nil, fmt.Errorf("guild not found")
	}
	return guild, nil
}

func (s *GuildService) UpdateGuild(ctx context.Context, guild *model.Guild, requesterID string) error {
	if err := s.checkPermission(ctx, guild.ID, requesterID, model.PermManageGuild); err != nil {
		return err
	}
	if err := s.guilds.Update(ctx, guild); err != nil {
		return fmt.Errorf("update guild: %w", err)
	}
	return nil
}

func (s *GuildService) DeleteGuild(ctx context.Context, guildID, requesterID string) error {
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return fmt.Errorf("delete guild: %w", err)
	}
	if guild == nil {
		return fmt.Errorf("guild not found")
	}
	if guild.OwnerID != requesterID {
		return fmt.Errorf("only the owner can delete a guild")
	}
	if err := s.guilds.Delete(ctx, guildID); err != nil {
		return fmt.Errorf("delete guild: %w", err)
	}
	slog.Info("guild deleted", "guild_id", guildID, "by", requesterID)
	return nil
}

func (s *GuildService) ListUserGuilds(ctx context.Context, userID string) ([]model.Guild, error) {
	guilds, err := s.guilds.ListByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list user guilds: %w", err)
	}
	return guilds, nil
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

func (s *GuildService) CreateChannel(ctx context.Context, guildID, name, channelType string, categoryID *string, requesterID string) (*model.Channel, error) {
	// Validate name length
	if len(name) < 1 || len(name) > 100 {
		return nil, fmt.Errorf("channel name must be between 1 and 100 characters")
	}

	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageChannels); err != nil {
		return nil, err
	}

	// Enforce tier limit: max channels per guild
	count, err := s.channels.CountByGuild(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("create channel: %w", err)
	}
	if count >= model.FreeTierLimits.MaxChannelsPerGuild {
		return nil, fmt.Errorf("channel limit reached: maximum %d channels per server", model.FreeTierLimits.MaxChannelsPerGuild)
	}

	ch := &model.Channel{
		GuildID:    guildID,
		Name:       name,
		Type:       channelType,
		CategoryID: categoryID,
	}
	if err := s.channels.Create(ctx, ch); err != nil {
		return nil, fmt.Errorf("create channel: %w", err)
	}
	return ch, nil
}

func (s *GuildService) ListChannels(ctx context.Context, guildID string) ([]model.Channel, error) {
	channels, err := s.channels.ListByGuild(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}
	return channels, nil
}

func (s *GuildService) GetChannel(ctx context.Context, channelID string) (*model.Channel, error) {
	ch, err := s.channels.GetByID(ctx, channelID)
	if err != nil {
		return nil, fmt.Errorf("get channel: %w", err)
	}
	return ch, nil
}

func (s *GuildService) UpdateChannel(ctx context.Context, channel *model.Channel, requesterID string) error {
	if err := s.checkPermission(ctx, channel.GuildID, requesterID, model.PermManageChannels); err != nil {
		return err
	}
	if err := s.channels.Update(ctx, channel); err != nil {
		return fmt.Errorf("update channel: %w", err)
	}

	go s.events.Publish(context.Background(), channel.GuildID, "CHANNEL_UPDATE", channel)

	return nil
}

func (s *GuildService) DeleteChannel(ctx context.Context, channelID, requesterID string) error {
	ch, err := s.channels.GetByID(ctx, channelID)
	if err != nil {
		return fmt.Errorf("delete channel: %w", err)
	}
	if ch == nil {
		return fmt.Errorf("channel not found")
	}
	if err := s.checkPermission(ctx, ch.GuildID, requesterID, model.PermManageChannels); err != nil {
		return err
	}
	if err := s.channels.Delete(ctx, channelID); err != nil {
		return fmt.Errorf("delete channel: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

func (s *GuildService) CreateCategory(ctx context.Context, guildID, name, requesterID string) (*model.Category, error) {
	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageChannels); err != nil {
		return nil, err
	}
	cat := &model.Category{
		GuildID: guildID,
		Name:    name,
	}
	if err := s.categories.Create(ctx, cat); err != nil {
		return nil, fmt.Errorf("create category: %w", err)
	}
	return cat, nil
}

func (s *GuildService) ListCategories(ctx context.Context, guildID string) ([]model.Category, error) {
	cats, err := s.categories.ListByGuild(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	return cats, nil
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

func (s *GuildService) CreateRole(ctx context.Context, guildID, name string, permissions int64, color string, requesterID string) (*model.Role, error) {
	// Validate name length
	if len(name) < 1 || len(name) > 50 {
		return nil, fmt.Errorf("role name must be between 1 and 50 characters")
	}

	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageRoles); err != nil {
		return nil, err
	}

	// Enforce tier limit: max roles per guild
	count, err := s.roles.CountByGuild(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("create role: %w", err)
	}
	if count >= model.FreeTierLimits.MaxRolesPerGuild {
		return nil, fmt.Errorf("role limit reached: maximum %d roles per server", model.FreeTierLimits.MaxRolesPerGuild)
	}

	// Only the owner can create roles with Administrator permission
	if model.HasPermission(permissions, model.PermAdministrator) {
		guild, err := s.guilds.GetByID(ctx, guildID)
		if err != nil {
			return nil, fmt.Errorf("create role: %w", err)
		}
		if guild == nil || guild.OwnerID != requesterID {
			return nil, fmt.Errorf("only the owner can create roles with Administrator permission")
		}
	}

	role := &model.Role{
		GuildID:     guildID,
		Name:        name,
		Permissions: permissions,
	}
	if color != "" {
		role.Color = &color
	}
	if err := s.roles.Create(ctx, role); err != nil {
		return nil, fmt.Errorf("create role: %w", err)
	}

	go s.events.Publish(context.Background(), guildID, EventGuildRoleCreate, map[string]interface{}{
		"guildId": guildID,
		"role":    role,
	})

	return role, nil
}

func (s *GuildService) ListRoles(ctx context.Context, guildID string) ([]model.Role, error) {
	roles, err := s.roles.ListByGuild(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("list roles: %w", err)
	}
	return roles, nil
}

func (s *GuildService) GetRole(ctx context.Context, roleID string) (*model.Role, error) {
	role, err := s.roles.GetByID(ctx, roleID)
	if err != nil {
		return nil, fmt.Errorf("get role: %w", err)
	}
	return role, nil
}

func (s *GuildService) UpdateRole(ctx context.Context, role *model.Role, requesterID string) error {
	if err := s.checkPermission(ctx, role.GuildID, requesterID, model.PermManageRoles); err != nil {
		return err
	}

	// Only the owner can set Administrator permission on a role
	if model.HasPermission(role.Permissions, model.PermAdministrator) {
		guild, err := s.guilds.GetByID(ctx, role.GuildID)
		if err != nil {
			return fmt.Errorf("update role: %w", err)
		}
		if guild == nil || guild.OwnerID != requesterID {
			return fmt.Errorf("only the owner can grant Administrator permission")
		}
	}

	if err := s.roles.Update(ctx, role); err != nil {
		return fmt.Errorf("update role: %w", err)
	}

	go s.events.Publish(context.Background(), role.GuildID, EventGuildRoleUpdate, map[string]interface{}{
		"guildId": role.GuildID,
		"role":    role,
	})

	return nil
}

func (s *GuildService) DeleteRole(ctx context.Context, roleID, requesterID string) error {
	role, err := s.roles.GetByID(ctx, roleID)
	if err != nil {
		return fmt.Errorf("delete role: %w", err)
	}
	if role == nil {
		return fmt.Errorf("role not found")
	}
	if err := s.checkPermission(ctx, role.GuildID, requesterID, model.PermManageRoles); err != nil {
		return err
	}
	if err := s.roles.Delete(ctx, roleID); err != nil {
		return fmt.Errorf("delete role: %w", err)
	}

	go s.events.Publish(context.Background(), role.GuildID, EventGuildRoleDelete, map[string]string{
		"roleId":  roleID,
		"guildId": role.GuildID,
	})

	return nil
}

func (s *GuildService) AssignRole(ctx context.Context, guildID, userID, roleID, requesterID string) error {
	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageRoles); err != nil {
		return err
	}

	// Only the owner can assign roles with Administrator permission
	role, err := s.roles.GetByID(ctx, roleID)
	if err != nil {
		return fmt.Errorf("assign role: %w", err)
	}
	if role != nil && model.HasPermission(role.Permissions, model.PermAdministrator) {
		guild, err := s.guilds.GetByID(ctx, guildID)
		if err != nil {
			return fmt.Errorf("assign role: %w", err)
		}
		if guild == nil || guild.OwnerID != requesterID {
			return fmt.Errorf("only the owner can assign roles with Administrator permission")
		}
	}

	member, err := s.members.GetByGuildAndUser(ctx, guildID, userID)
	if err != nil {
		return fmt.Errorf("assign role: %w", err)
	}
	if member == nil {
		return fmt.Errorf("member not found")
	}
	if err := s.members.AssignRole(ctx, member.ID, roleID, requesterID); err != nil {
		return fmt.Errorf("assign role: %w", err)
	}

	// Publish member update with current role IDs
	go func() {
		roles, err := s.members.GetMemberRoles(context.Background(), member.ID)
		if err != nil {
			slog.Error("failed to get member roles for event", "error", err)
			return
		}
		roleIDs := make([]string, len(roles))
		for i, r := range roles {
			roleIDs[i] = r.ID
		}
		s.events.Publish(context.Background(), guildID, EventGuildMemberUpdate, map[string]interface{}{
			"userId":  userID,
			"guildId": guildID,
			"roleIds": roleIDs,
		})
	}()

	return nil
}

func (s *GuildService) RemoveRole(ctx context.Context, guildID, userID, roleID, requesterID string) error {
	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageRoles); err != nil {
		return err
	}
	member, err := s.members.GetByGuildAndUser(ctx, guildID, userID)
	if err != nil {
		return fmt.Errorf("remove role: %w", err)
	}
	if member == nil {
		return fmt.Errorf("member not found")
	}
	if err := s.members.RemoveRole(ctx, member.ID, roleID); err != nil {
		return fmt.Errorf("remove role: %w", err)
	}

	// Publish member update with current role IDs
	go func() {
		roles, err := s.members.GetMemberRoles(context.Background(), member.ID)
		if err != nil {
			slog.Error("failed to get member roles for event", "error", err)
			return
		}
		roleIDs := make([]string, len(roles))
		for i, r := range roles {
			roleIDs[i] = r.ID
		}
		s.events.Publish(context.Background(), guildID, EventGuildMemberUpdate, map[string]interface{}{
			"userId":  userID,
			"guildId": guildID,
			"roleIds": roleIDs,
		})
	}()

	return nil
}

// ---------------------------------------------------------------------------
// Twitch Integration
// ---------------------------------------------------------------------------

// twitchAutoRoleDef defines a Twitch auto-role to be created.
type twitchAutoRoleDef struct {
	Name     string
	Source   string
	Color    string
	Position int
}

var twitchAutoRoles = []twitchAutoRoleDef{
	{"Lead Moderator", "twitch_lead_mod", "#00AD03", 7},
	{"Twitch Mod", "twitch_mod", "#2ECC71", 6},
	{"Twitch VIP", "twitch_vip", "#E91916", 5},
	{"Twitch Sub T3", "twitch_sub_t3", "#6610F2", 4},
	{"Twitch Sub T2", "twitch_sub_t2", "#7B2FFF", 3},
	{"Twitch Sub T1", "twitch_sub_t1", "#9146FF", 2},
	{"Twitch Follower", "twitch_follower", "#BF94FF", 1},
}

// defaultPermsForSource returns the default permissions bitmask for a given auto-role source.
func defaultPermsForSource(source string) int64 {
	switch source {
	case "twitch_lead_mod":
		return model.PermAdministrator
	case "twitch_mod":
		return model.PermKickMembers | model.PermBanMembers | model.PermTimeoutMembers | model.PermManageMessages
	default:
		// VIP, subs, follower — same as @everyone (send messages)
		return model.PermSendMessages
	}
}

func (s *GuildService) EnableTwitchIntegration(ctx context.Context, guildID, ownerID, streamerTwitchID string) ([]model.Role, error) {
	// 1. Verify owner
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("enable twitch: %w", err)
	}
	if guild == nil {
		return nil, fmt.Errorf("guild not found")
	}
	if guild.OwnerID != ownerID {
		return nil, fmt.Errorf("only the owner can enable Twitch integration")
	}

	// 2. Update guild with streamer Twitch ID
	if err := s.guilds.SetStreamerTwitchID(ctx, guildID, streamerTwitchID); err != nil {
		return nil, fmt.Errorf("enable twitch: %w", err)
	}

	// 3. Create auto-roles (skip any that already exist)
	var created []model.Role
	for _, ar := range twitchAutoRoles {
		existing, err := s.roles.GetAutoRoleBySource(ctx, guildID, ar.Source)
		if err != nil {
			return nil, fmt.Errorf("enable twitch check role: %w", err)
		}
		if existing != nil {
			created = append(created, *existing)
			continue
		}

		color := ar.Color
		source := ar.Source
		role := &model.Role{
			GuildID:     guildID,
			Name:        ar.Name,
			Color:       &color,
			Position:    ar.Position,
			Permissions: defaultPermsForSource(ar.Source),
			IsAuto:      true,
			AutoSource:  &source,
			Hoisted:     true,
		}
		if err := s.roles.Create(ctx, role); err != nil {
			return nil, fmt.Errorf("enable twitch create role %s: %w", ar.Name, err)
		}
		created = append(created, *role)

		go s.events.Publish(context.Background(), guildID, EventGuildRoleCreate, map[string]interface{}{
			"guildId": guildID,
			"role":    role,
		})
	}

	slog.Info("twitch integration enabled", "guild_id", guildID, "twitch_id", streamerTwitchID, "roles_created", len(created))
	return created, nil
}

func (s *GuildService) DisableTwitchIntegration(ctx context.Context, guildID, ownerID string) error {
	// 1. Verify owner
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return fmt.Errorf("disable twitch: %w", err)
	}
	if guild == nil {
		return fmt.Errorf("guild not found")
	}
	if guild.OwnerID != ownerID {
		return fmt.Errorf("only the owner can disable Twitch integration")
	}

	// 2. Get auto-roles before deleting (for events)
	autoRoles, err := s.roles.ListAutoRolesByGuild(ctx, guildID)
	if err != nil {
		return fmt.Errorf("disable twitch list roles: %w", err)
	}

	// 3. Delete all auto-roles
	if err := s.roles.DeleteAutoRolesByGuild(ctx, guildID); err != nil {
		return fmt.Errorf("disable twitch delete roles: %w", err)
	}

	// 4. Clear streamer Twitch ID
	if err := s.guilds.ClearStreamerTwitchID(ctx, guildID); err != nil {
		return fmt.Errorf("disable twitch: %w", err)
	}

	// Publish role delete events
	for _, role := range autoRoles {
		go s.events.Publish(context.Background(), guildID, EventGuildRoleDelete, map[string]string{
			"roleId":  role.ID,
			"guildId": guildID,
		})
	}

	slog.Info("twitch integration disabled", "guild_id", guildID, "roles_removed", len(autoRoles))
	return nil
}

// AssignAutoRole assigns an auto-role to a member without requiring ManageRoles permission.
// Used by the gateway's Twitch sync endpoint.
func (s *GuildService) AssignAutoRole(ctx context.Context, guildID, userID, roleID string) error {
	role, err := s.roles.GetByID(ctx, roleID)
	if err != nil {
		return fmt.Errorf("assign auto role: %w", err)
	}
	if role == nil || !role.IsAuto {
		return fmt.Errorf("role not found or not an auto-role")
	}
	if role.GuildID != guildID {
		return fmt.Errorf("role does not belong to this guild")
	}

	member, err := s.members.GetByGuildAndUser(ctx, guildID, userID)
	if err != nil {
		return fmt.Errorf("assign auto role: %w", err)
	}
	if member == nil {
		return fmt.Errorf("not a member of this guild")
	}
	if err := s.members.AssignRole(ctx, member.ID, roleID, userID); err != nil {
		return fmt.Errorf("assign auto role: %w", err)
	}

	go func() {
		roles, err := s.members.GetMemberRoles(context.Background(), member.ID)
		if err != nil {
			return
		}
		roleIDs := make([]string, len(roles))
		for i, r := range roles {
			roleIDs[i] = r.ID
		}
		s.events.Publish(context.Background(), guildID, EventGuildMemberUpdate, map[string]interface{}{
			"userId":  userID,
			"guildId": guildID,
			"roleIds": roleIDs,
		})
	}()

	return nil
}

// RemoveAutoRole removes an auto-role from a member without requiring ManageRoles permission.
func (s *GuildService) RemoveAutoRole(ctx context.Context, guildID, userID, roleID string) error {
	role, err := s.roles.GetByID(ctx, roleID)
	if err != nil {
		return fmt.Errorf("remove auto role: %w", err)
	}
	if role == nil || !role.IsAuto {
		return fmt.Errorf("role not found or not an auto-role")
	}
	if role.GuildID != guildID {
		return fmt.Errorf("role does not belong to this guild")
	}

	member, err := s.members.GetByGuildAndUser(ctx, guildID, userID)
	if err != nil {
		return fmt.Errorf("remove auto role: %w", err)
	}
	if member == nil {
		return fmt.Errorf("not a member of this guild")
	}
	if err := s.members.RemoveRole(ctx, member.ID, roleID); err != nil {
		return fmt.Errorf("remove auto role: %w", err)
	}

	go func() {
		roles, err := s.members.GetMemberRoles(context.Background(), member.ID)
		if err != nil {
			return
		}
		roleIDs := make([]string, len(roles))
		for i, r := range roles {
			roleIDs[i] = r.ID
		}
		s.events.Publish(context.Background(), guildID, EventGuildMemberUpdate, map[string]interface{}{
			"userId":  userID,
			"guildId": guildID,
			"roleIds": roleIDs,
		})
	}()

	return nil
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

func (s *GuildService) JoinGuild(ctx context.Context, guildID, userID string) (*model.GuildMember, error) {
	// Check if already a member
	existing, err := s.members.GetByGuildAndUser(ctx, guildID, userID)
	if err != nil {
		return nil, fmt.Errorf("join guild: %w", err)
	}
	if existing != nil {
		return existing, nil
	}

	// Enforce tier limit: max servers joined
	count, err := s.guilds.CountMemberships(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("join guild: %w", err)
	}
	if count >= model.FreeTierLimits.MaxServersJoined {
		return nil, fmt.Errorf("server limit reached: you can join up to %d servers", model.FreeTierLimits.MaxServersJoined)
	}

	// Check if banned
	ban, err := s.moderation.GetBan(ctx, guildID, userID)
	if err != nil {
		return nil, fmt.Errorf("join guild check ban: %w", err)
	}
	if ban != nil {
		return nil, fmt.Errorf("user is banned from this guild")
	}

	// Anti-raid check
	if reason := s.checkAntiRaid(ctx, guildID, userID); reason != "" {
		return nil, fmt.Errorf("join blocked: %s", reason)
	}

	member, err := s.members.Add(ctx, guildID, userID)
	if err != nil {
		return nil, fmt.Errorf("join guild: %w", err)
	}

	// Publish member join event
	go s.events.Publish(context.Background(), guildID, "GUILD_MEMBER_ADD", map[string]string{
		"userId":  userID,
		"guildId": guildID,
	})

	return member, nil
}

func (s *GuildService) LeaveGuild(ctx context.Context, guildID, userID string) error {
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return fmt.Errorf("leave guild: %w", err)
	}
	if guild == nil {
		return fmt.Errorf("guild not found")
	}
	if guild.OwnerID == userID {
		return fmt.Errorf("owner cannot leave their own guild")
	}
	if err := s.members.Remove(ctx, guildID, userID); err != nil {
		return fmt.Errorf("leave guild: %w", err)
	}
	return nil
}

func (s *GuildService) ListMembers(ctx context.Context, guildID string, limit, offset int) ([]model.GuildMember, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	members, err := s.members.ListByGuild(ctx, guildID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	return members, nil
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

func generateCode() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *GuildService) CreateInvite(ctx context.Context, guildID, channelID, inviterID string, maxUses, maxAge *int) (*model.Invite, error) {
	if err := s.checkPermission(ctx, guildID, inviterID, model.PermCreateInvite); err != nil {
		return nil, err
	}

	inv := &model.Invite{
		Code:      generateCode(),
		GuildID:   guildID,
		ChannelID: channelID,
		InviterID: inviterID,
		MaxUses:   maxUses,
	}
	if maxAge != nil && *maxAge > 0 {
		exp := time.Now().Add(time.Duration(*maxAge) * time.Second)
		inv.ExpiresAt = &exp
	}

	if err := s.invites.Create(ctx, inv); err != nil {
		return nil, fmt.Errorf("create invite: %w", err)
	}
	return inv, nil
}

func (s *GuildService) UseInvite(ctx context.Context, code, userID string) (*model.Guild, error) {
	inv, err := s.invites.GetByCode(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("use invite: %w", err)
	}
	if inv == nil {
		return nil, fmt.Errorf("invite not found")
	}

	// Check expiration
	if inv.ExpiresAt != nil && time.Now().After(*inv.ExpiresAt) {
		return nil, fmt.Errorf("invite has expired")
	}

	// Check max uses
	if inv.MaxUses != nil && inv.Uses != nil && *inv.Uses >= *inv.MaxUses {
		return nil, fmt.Errorf("invite has reached maximum uses")
	}

	// Join the guild
	_, err = s.JoinGuild(ctx, inv.GuildID, userID)
	if err != nil {
		return nil, err
	}

	// Increment uses
	if err := s.invites.IncrementUses(ctx, code); err != nil {
		slog.Warn("failed to increment invite uses", "code", code, "error", err)
	}

	guild, err := s.guilds.GetByID(ctx, inv.GuildID)
	if err != nil {
		return nil, fmt.Errorf("use invite get guild: %w", err)
	}
	return guild, nil
}

func (s *GuildService) ListInvites(ctx context.Context, guildID, requesterID string) ([]model.Invite, error) {
	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageInvites); err != nil {
		return nil, err
	}
	invites, err := s.invites.ListByGuild(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	return invites, nil
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

func (s *GuildService) BanMember(ctx context.Context, guildID, targetID, modID, reason string) error {
	if err := s.checkPermission(ctx, guildID, modID, model.PermBanMembers); err != nil {
		return err
	}

	// Protect guild owner from being banned
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return fmt.Errorf("ban member: %w", err)
	}
	if guild != nil && guild.OwnerID == targetID {
		return fmt.Errorf("cannot ban the server owner")
	}

	// Remove member from guild
	_ = s.members.Remove(ctx, guildID, targetID)

	if err := s.moderation.Ban(ctx, guildID, targetID, modID, reason); err != nil {
		return fmt.Errorf("ban member: %w", err)
	}

	// Log action
	s.logModAction(ctx, guildID, modID, targetID, "ban", reason, nil)

	// Publish event for real-time broadcast (fire-and-forget)
	go s.events.Publish(context.Background(), guildID, EventGuildMemberRemove, map[string]interface{}{
		"userId":  targetID,
		"guildId": guildID,
		"banned":  true,
	})

	return nil
}

func (s *GuildService) UnbanMember(ctx context.Context, guildID, targetID, modID string) error {
	if err := s.checkPermission(ctx, guildID, modID, model.PermBanMembers); err != nil {
		return err
	}
	if err := s.moderation.Unban(ctx, guildID, targetID); err != nil {
		return fmt.Errorf("unban member: %w", err)
	}

	s.logModAction(ctx, guildID, modID, targetID, "unban", "", nil)

	// Publish event for real-time broadcast (fire-and-forget)
	go s.events.Publish(context.Background(), guildID, EventGuildBanRemove, map[string]string{
		"userId":  targetID,
		"guildId": guildID,
	})

	return nil
}

func (s *GuildService) KickMember(ctx context.Context, guildID, targetID, modID, reason string) error {
	if err := s.checkPermission(ctx, guildID, modID, model.PermKickMembers); err != nil {
		return err
	}

	// Protect guild owner from being kicked
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return fmt.Errorf("kick member: %w", err)
	}
	if guild != nil && guild.OwnerID == targetID {
		return fmt.Errorf("cannot kick the server owner")
	}

	if err := s.members.Remove(ctx, guildID, targetID); err != nil {
		return fmt.Errorf("kick member: %w", err)
	}

	s.logModAction(ctx, guildID, modID, targetID, "kick", reason, nil)

	// Publish event for real-time broadcast (fire-and-forget)
	go s.events.Publish(context.Background(), guildID, EventGuildMemberRemove, map[string]string{
		"userId":  targetID,
		"guildId": guildID,
	})

	return nil
}

func (s *GuildService) TimeoutMember(ctx context.Context, guildID, targetID, modID string, duration time.Duration, reason string) error {
	if err := s.checkPermission(ctx, guildID, modID, model.PermTimeoutMembers); err != nil {
		return err
	}

	// Protect guild owner from being timed out
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return fmt.Errorf("timeout member: %w", err)
	}
	if guild != nil && guild.OwnerID == targetID {
		return fmt.Errorf("cannot timeout the server owner")
	}

	if err := s.moderation.Timeout(ctx, guildID, targetID, duration); err != nil {
		return fmt.Errorf("timeout member: %w", err)
	}

	durSecs := int(duration.Seconds())
	s.logModAction(ctx, guildID, modID, targetID, "timeout", reason, &durSecs)
	return nil
}

func (s *GuildService) WarnMember(ctx context.Context, guildID, targetID, modID, reason string) error {
	// Require at least kick or ban permission to warn
	if err := s.checkPermission(ctx, guildID, modID, model.PermKickMembers); err != nil {
		return err
	}

	// Protect guild owner from being warned
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil {
		return fmt.Errorf("warn member: %w", err)
	}
	if guild != nil && guild.OwnerID == targetID {
		return fmt.Errorf("cannot warn the server owner")
	}

	// Verify target is a member
	member, err := s.members.GetByGuildAndUser(ctx, guildID, targetID)
	if err != nil {
		return fmt.Errorf("warn member: %w", err)
	}
	if member == nil {
		return fmt.Errorf("member not found")
	}

	s.logModAction(ctx, guildID, modID, targetID, "warn", reason, nil)
	slog.Info("member warned", "guild_id", guildID, "target_id", targetID, "mod_id", modID)
	return nil
}

func (s *GuildService) ListBans(ctx context.Context, guildID string) ([]model.Ban, error) {
	bans, err := s.moderation.ListBans(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("list bans: %w", err)
	}
	return bans, nil
}

func (s *GuildService) ListModLogs(ctx context.Context, guildID string, limit int) ([]model.ModerationLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	logs, err := s.moderation.ListLogs(ctx, guildID, limit)
	if err != nil {
		return nil, fmt.Errorf("list mod logs: %w", err)
	}
	return logs, nil
}

func (s *GuildService) logModAction(ctx context.Context, guildID, modID, targetID, action, reason string, durationSeconds *int) {
	logEntry := &model.ModerationLog{
		GuildID:     guildID,
		ModeratorID: modID,
		TargetID:    targetID,
		Action:      action,
	}
	if reason != "" {
		logEntry.Reason = &reason
	}
	if durationSeconds != nil {
		logEntry.DurationSeconds = durationSeconds
	}
	if err := s.moderation.LogAction(ctx, logEntry); err != nil {
		slog.Error("failed to log moderation action", "error", err, "action", action, "guild_id", guildID)
	}
}

func (s *GuildService) SetBridgeChannel(ctx context.Context, guildID, channelID, userID string) error {
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil || guild == nil {
		return fmt.Errorf("guild not found")
	}
	if guild.OwnerID != userID {
		return fmt.Errorf("only the owner can configure the bridge")
	}
	if guild.StreamerTwitchID == nil || *guild.StreamerTwitchID == "" {
		return fmt.Errorf("twitch integration must be enabled first")
	}
	return s.guilds.SetBridgeChannel(ctx, guildID, channelID)
}

func (s *GuildService) ClearBridgeChannel(ctx context.Context, guildID, userID string) error {
	guild, err := s.guilds.GetByID(ctx, guildID)
	if err != nil || guild == nil {
		return fmt.Errorf("guild not found")
	}
	if guild.OwnerID != userID {
		return fmt.Errorf("only the owner can configure the bridge")
	}
	return s.guilds.ClearBridgeChannel(ctx, guildID)
}

// checkAntiRaid checks anti_raid automod rules for a guild join.
// Returns a reason string if blocked, empty string if allowed.
func (s *GuildService) checkAntiRaid(ctx context.Context, guildID, userID string) string {
	if s.rdb == nil || s.automod == nil {
		return ""
	}

	rules, err := s.automod.ListByGuild(ctx, guildID)
	if err != nil {
		return ""
	}

	for _, rule := range rules {
		if !rule.Enabled || rule.Type != "anti_raid" {
			continue
		}

		var cfg struct {
			MaxJoinsPerMinute int `json:"maxJoinsPerMinute"` // default: 10
			MinAccountAgeDays int `json:"minAccountAgeDays"` // default: 0 (disabled)
		}
		json.Unmarshal(rule.Config, &cfg)
		if cfg.MaxJoinsPerMinute == 0 {
			cfg.MaxJoinsPerMinute = 10
		}

		// Join rate limit: count joins in the last minute
		rateKey := fmt.Sprintf("nexe:raid:%s:joins", guildID)
		count, _ := s.rdb.Incr(ctx, rateKey).Result()
		if count == 1 {
			s.rdb.Expire(ctx, rateKey, 60*time.Second)
		}
		if int(count) > cfg.MaxJoinsPerMinute {
			slog.Warn("anti-raid triggered", "guild", guildID, "user", userID, "joins", count)
			return fmt.Sprintf("too many joins (%d in 60s) — server is in raid protection", count)
		}

		// Account age check (requires user creation date — use Redis cache from gateway)
		// For now, we skip this since it needs cross-service data.
		// TODO: Add account age check via gateway API call
	}

	return ""
}
