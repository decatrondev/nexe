package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"github.com/decatrondev/nexe/services/guilds/internal/model"
	"github.com/decatrondev/nexe/services/guilds/internal/repository"
)

type GuildService struct {
	guilds     *repository.GuildRepository
	channels   *repository.ChannelRepository
	categories *repository.CategoryRepository
	roles      *repository.RoleRepository
	members    *repository.MemberRepository
	invites    *repository.InviteRepository
	moderation *repository.ModerationRepository
}

func NewGuildService(
	guilds *repository.GuildRepository,
	channels *repository.ChannelRepository,
	categories *repository.CategoryRepository,
	roles *repository.RoleRepository,
	members *repository.MemberRepository,
	invites *repository.InviteRepository,
	moderation *repository.ModerationRepository,
) *GuildService {
	return &GuildService{
		guilds:     guilds,
		channels:   channels,
		categories: categories,
		roles:      roles,
		members:    members,
		invites:    invites,
		moderation: moderation,
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
	_, err := s.members.Add(ctx, guild.ID, ownerID)
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
	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageChannels); err != nil {
		return nil, err
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

func (s *GuildService) UpdateChannel(ctx context.Context, channel *model.Channel, requesterID string) error {
	if err := s.checkPermission(ctx, channel.GuildID, requesterID, model.PermManageChannels); err != nil {
		return err
	}
	if err := s.channels.Update(ctx, channel); err != nil {
		return fmt.Errorf("update channel: %w", err)
	}
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
	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageRoles); err != nil {
		return nil, err
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
	return role, nil
}

func (s *GuildService) ListRoles(ctx context.Context, guildID string) ([]model.Role, error) {
	roles, err := s.roles.ListByGuild(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("list roles: %w", err)
	}
	return roles, nil
}

func (s *GuildService) UpdateRole(ctx context.Context, role *model.Role, requesterID string) error {
	if err := s.checkPermission(ctx, role.GuildID, requesterID, model.PermManageRoles); err != nil {
		return err
	}
	if err := s.roles.Update(ctx, role); err != nil {
		return fmt.Errorf("update role: %w", err)
	}
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
	return nil
}

func (s *GuildService) AssignRole(ctx context.Context, guildID, userID, roleID, requesterID string) error {
	if err := s.checkPermission(ctx, guildID, requesterID, model.PermManageRoles); err != nil {
		return err
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

	// Check if banned
	ban, err := s.moderation.GetBan(ctx, guildID, userID)
	if err != nil {
		return nil, fmt.Errorf("join guild check ban: %w", err)
	}
	if ban != nil {
		return nil, fmt.Errorf("user is banned from this guild")
	}

	member, err := s.members.Add(ctx, guildID, userID)
	if err != nil {
		return nil, fmt.Errorf("join guild: %w", err)
	}
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

	// Remove member from guild
	_ = s.members.Remove(ctx, guildID, targetID)

	if err := s.moderation.Ban(ctx, guildID, targetID, modID, reason); err != nil {
		return fmt.Errorf("ban member: %w", err)
	}

	// Log action
	s.logModAction(ctx, guildID, modID, targetID, "ban", reason, nil)
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
	return nil
}

func (s *GuildService) KickMember(ctx context.Context, guildID, targetID, modID, reason string) error {
	if err := s.checkPermission(ctx, guildID, modID, model.PermKickMembers); err != nil {
		return err
	}
	if err := s.members.Remove(ctx, guildID, targetID); err != nil {
		return fmt.Errorf("kick member: %w", err)
	}

	s.logModAction(ctx, guildID, modID, targetID, "kick", reason, nil)
	return nil
}

func (s *GuildService) TimeoutMember(ctx context.Context, guildID, targetID, modID string, duration time.Duration, reason string) error {
	if err := s.checkPermission(ctx, guildID, modID, model.PermTimeoutMembers); err != nil {
		return err
	}
	if err := s.moderation.Timeout(ctx, guildID, targetID, duration); err != nil {
		return fmt.Errorf("timeout member: %w", err)
	}

	durSecs := int(duration.Seconds())
	s.logModAction(ctx, guildID, modID, targetID, "timeout", reason, &durSecs)
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
