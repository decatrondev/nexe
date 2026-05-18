package grpcserver

import (
	"context"
	"database/sql"
	"log/slog"

	pb "github.com/decatrondev/nexe/proto/guildspb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// GuildsGRPCServer implements the GuildsInternal gRPC service.
type GuildsGRPCServer struct {
	pb.UnimplementedGuildsInternalServer
	db *sql.DB
}

func New(db *sql.DB) *GuildsGRPCServer {
	return &GuildsGRPCServer{db: db}
}

func (s *GuildsGRPCServer) CheckChannelAccess(ctx context.Context, req *pb.ChannelAccessRequest) (*pb.ChannelAccessResponse, error) {
	var resp pb.ChannelAccessResponse

	// Get guild ID and verify membership
	err := s.db.QueryRowContext(ctx, `
		SELECT c.guild_id,
			EXISTS(SELECT 1 FROM guild_members WHERE guild_id = c.guild_id AND user_id = $2)
		FROM channels c WHERE c.id = $1`, req.ChannelId, req.UserId).Scan(&resp.GuildId, &resp.IsMember)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, status.Error(codes.NotFound, "channel not found")
		}
		return nil, status.Error(codes.Internal, err.Error())
	}

	if !resp.IsMember {
		return &resp, nil
	}

	// Get permissions from roles
	var isOwner bool
	s.db.QueryRowContext(ctx, `SELECT owner_id = $2 FROM guilds WHERE id = $1`, resp.GuildId, req.UserId).Scan(&isOwner)
	if isOwner {
		resp.Administrator = true
		resp.ManageMessages = true
		resp.ManageChannels = true
		resp.ManageGuild = true
		return &resp, nil
	}

	// Check role permissions (bitmask)
	var permBits int64
	rows, err := s.db.QueryContext(ctx, `
		SELECT COALESCE(BIT_OR(r.permissions), 0)
		FROM guild_member_roles gmr
		JOIN roles r ON r.id = gmr.role_id
		WHERE gmr.guild_id = $1 AND gmr.user_id = $2`, resp.GuildId, req.UserId)
	if err == nil {
		defer rows.Close()
		if rows.Next() {
			rows.Scan(&permBits)
		}
	}

	// Also add @everyone role permissions
	var everyonePerms int64
	s.db.QueryRowContext(ctx, `SELECT permissions FROM roles WHERE guild_id = $1 AND is_default = true`, resp.GuildId).Scan(&everyonePerms)
	permBits |= everyonePerms

	const (
		PermAdministrator   = 1 << 0
		PermManageGuild     = 1 << 1
		PermManageChannels  = 1 << 2
		PermManageMessages  = 1 << 6
	)

	if permBits&PermAdministrator != 0 {
		resp.Administrator = true
		resp.ManageMessages = true
		resp.ManageChannels = true
		resp.ManageGuild = true
	} else {
		resp.ManageMessages = permBits&PermManageMessages != 0
		resp.ManageChannels = permBits&PermManageChannels != 0
		resp.ManageGuild = permBits&PermManageGuild != 0
	}

	return &resp, nil
}

func (s *GuildsGRPCServer) CheckAutomod(ctx context.Context, req *pb.AutomodRequest) (*pb.AutomodResponse, error) {
	// Check blocked words
	var blocked bool
	var reason string
	rows, err := s.db.QueryContext(ctx, `
		SELECT pattern FROM automod_rules
		WHERE guild_id = $1 AND enabled = true AND type = 'blocked_words'`, req.GuildId)
	if err != nil {
		return &pb.AutomodResponse{Blocked: false}, nil
	}
	defer rows.Close()

	for rows.Next() {
		var pattern string
		rows.Scan(&pattern)
		if containsWord(req.Content, pattern) {
			blocked = true
			reason = "blocked word detected"
			break
		}
	}

	return &pb.AutomodResponse{Blocked: blocked, Reason: reason}, nil
}

func (s *GuildsGRPCServer) ValidateEmotes(ctx context.Context, req *pb.EmoteValidateRequest) (*pb.EmoteValidateResponse, error) {
	// For now, pass through — emote validation is complex and tier-dependent
	return &pb.EmoteValidateResponse{Content: req.Content, Modified: false, Blocked: false}, nil
}

func (s *GuildsGRPCServer) GetGuildMembers(ctx context.Context, req *pb.GuildMembersRequest) (*pb.GuildMembersResponse, error) {
	limit := req.Limit
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT user_id FROM guild_members WHERE guild_id = $1 LIMIT $2`, req.GuildId, limit)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	return &pb.GuildMembersResponse{UserIds: ids}, nil
}

func (s *GuildsGRPCServer) GetGuildChannels(ctx context.Context, req *pb.GuildChannelsRequest) (*pb.GuildChannelsResponse, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, type FROM channels WHERE guild_id = $1 ORDER BY position`, req.GuildId)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	defer rows.Close()

	var channels []*pb.GuildChannel
	for rows.Next() {
		ch := &pb.GuildChannel{}
		rows.Scan(&ch.Id, &ch.Name, &ch.Type)
		channels = append(channels, ch)
	}
	return &pb.GuildChannelsResponse{Channels: channels}, nil
}

func (s *GuildsGRPCServer) GetUserGuilds(ctx context.Context, req *pb.UserGuildsRequest) (*pb.UserGuildsResponse, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT g.id, g.name, COALESCE(g.icon_url, ''), g.owner_id
		FROM guilds g
		JOIN guild_members gm ON gm.guild_id = g.id
		WHERE gm.user_id = $1`, req.UserId)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	defer rows.Close()

	var guilds []*pb.UserGuild
	for rows.Next() {
		g := &pb.UserGuild{}
		rows.Scan(&g.Id, &g.Name, &g.IconUrl, &g.OwnerId)
		guilds = append(guilds, g)
	}
	return &pb.UserGuildsResponse{Guilds: guilds}, nil
}

func (s *GuildsGRPCServer) AssignAutoRole(ctx context.Context, req *pb.AutoRoleRequest) (*pb.AutoRoleResponse, error) {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO guild_member_roles (guild_id, user_id, role_id)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, req.GuildId, req.UserId, req.RoleId)
	if err != nil {
		slog.Error("assign auto-role failed", "error", err)
		return &pb.AutoRoleResponse{Success: false}, nil
	}
	return &pb.AutoRoleResponse{Success: true}, nil
}

func (s *GuildsGRPCServer) RemoveAutoRole(ctx context.Context, req *pb.AutoRoleRequest) (*pb.AutoRoleResponse, error) {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM guild_member_roles WHERE guild_id = $1 AND user_id = $2 AND role_id = $3`,
		req.GuildId, req.UserId, req.RoleId)
	if err != nil {
		return &pb.AutoRoleResponse{Success: false}, nil
	}
	return &pb.AutoRoleResponse{Success: true}, nil
}

// containsWord checks if content contains a blocked word (case-insensitive).
func containsWord(content, pattern string) bool {
	// Simple substring match — the HTTP automod handler has more complex logic
	lower := func(s string) string {
		b := make([]byte, len(s))
		for i := range s {
			c := s[i]
			if c >= 'A' && c <= 'Z' {
				c += 32
			}
			b[i] = c
		}
		return string(b)
	}
	return len(pattern) > 0 && len(content) > 0 &&
		contains(lower(content), lower(pattern))
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
