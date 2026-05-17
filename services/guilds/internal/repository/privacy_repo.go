package repository

import (
	"context"
	"database/sql"
	"time"
)

type PrivacySettings struct {
	UserID       string    `json:"userId"`
	WhoCanDM     string    `json:"whoCanDm"`     // "everyone", "server_members", "friends"
	WhoCanFriend string    `json:"whoCanFriend"` // "everyone", "friends_of_friends", "nobody"
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type PrivacyRepository struct {
	db *sql.DB
}

func NewPrivacyRepository(db *sql.DB) *PrivacyRepository {
	return &PrivacyRepository{db: db}
}

// GetOrDefault returns privacy settings for a user, or defaults if none exist.
func (r *PrivacyRepository) GetOrDefault(ctx context.Context, userID string) (*PrivacySettings, error) {
	var s PrivacySettings
	err := r.db.QueryRowContext(ctx,
		`SELECT user_id, who_can_dm, who_can_friend, created_at, updated_at
		 FROM user_privacy_settings WHERE user_id = $1`, userID,
	).Scan(&s.UserID, &s.WhoCanDM, &s.WhoCanFriend, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return &PrivacySettings{
			UserID:       userID,
			WhoCanDM:     "everyone",
			WhoCanFriend: "everyone",
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// Upsert creates or updates privacy settings.
func (r *PrivacyRepository) Upsert(ctx context.Context, s *PrivacySettings) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO user_privacy_settings (user_id, who_can_dm, who_can_friend)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id)
		DO UPDATE SET who_can_dm = $2, who_can_friend = $3, updated_at = NOW()`,
		s.UserID, s.WhoCanDM, s.WhoCanFriend,
	)
	return err
}

// CanSendDM checks if senderID is allowed to DM targetID based on privacy settings.
// Returns true if allowed, false if blocked by privacy.
func (r *PrivacyRepository) CanSendDM(ctx context.Context, senderID, targetID string) (bool, error) {
	settings, err := r.GetOrDefault(ctx, targetID)
	if err != nil {
		return true, err // fail open
	}

	switch settings.WhoCanDM {
	case "everyone":
		return true, nil
	case "friends":
		var isFriend bool
		r.db.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM relationships WHERE user_id = $1 AND target_id = $2 AND type = 'friend')`,
			targetID, senderID,
		).Scan(&isFriend)
		return isFriend, nil
	case "server_members":
		// Friends OR share a guild
		var related bool
		r.db.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM relationships WHERE user_id = $1 AND target_id = $2 AND type = 'friend'
				UNION ALL
				SELECT 1 FROM guild_members m1 JOIN guild_members m2 ON m1.guild_id = m2.guild_id
				WHERE m1.user_id = $1 AND m2.user_id = $2
				LIMIT 1
			)`, targetID, senderID).Scan(&related)
		return related, nil
	}
	return true, nil
}

// CanSendFriendRequest checks if senderID can send a friend request to targetID.
func (r *PrivacyRepository) CanSendFriendRequest(ctx context.Context, senderID, targetID string) (bool, error) {
	settings, err := r.GetOrDefault(ctx, targetID)
	if err != nil {
		return true, err
	}

	switch settings.WhoCanFriend {
	case "everyone":
		return true, nil
	case "nobody":
		return false, nil
	case "friends_of_friends":
		// Check if they share a mutual friend
		var hasMutual bool
		r.db.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM relationships r1
				JOIN relationships r2 ON r1.target_id = r2.target_id
				WHERE r1.user_id = $1 AND r1.type = 'friend'
				  AND r2.user_id = $2 AND r2.type = 'friend'
			)`, senderID, targetID).Scan(&hasMutual)
		return hasMutual, nil
	}
	return true, nil
}

// GetServerDMAllowed checks if a user allows DMs from a specific server.
func (r *PrivacyRepository) GetServerDMAllowed(ctx context.Context, guildID, userID string) (bool, error) {
	var allowed bool
	err := r.db.QueryRowContext(ctx,
		`SELECT COALESCE(allow_dms, true) FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
		guildID, userID,
	).Scan(&allowed)
	if err == sql.ErrNoRows {
		return true, nil
	}
	return allowed, err
}

// SetServerDMAllowed sets the per-server DM toggle.
func (r *PrivacyRepository) SetServerDMAllowed(ctx context.Context, guildID, userID string, allowed bool) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE guild_members SET allow_dms = $3 WHERE guild_id = $1 AND user_id = $2`,
		guildID, userID, allowed,
	)
	return err
}
