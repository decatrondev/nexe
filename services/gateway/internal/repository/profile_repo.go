package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/decatrondev/nexe/services/gateway/internal/model"
)

type ProfileRepository struct {
	db *sql.DB
}

func NewProfileRepository(db *sql.DB) *ProfileRepository {
	return &ProfileRepository{db: db}
}

func (r *ProfileRepository) GetByUserID(ctx context.Context, userID string) (*model.Profile, error) {
	p := &model.Profile{}
	var layout, socialLinks, featuredClips, streamSchedule, visibility []byte

	err := r.db.QueryRowContext(ctx, `
		SELECT user_id, display_name, bio, avatar_url, banner_url,
		       accent_color, background_url, layout, social_links,
		       featured_clips, stream_schedule, visibility,
		       level, total_xp, created_at, updated_at
		FROM profiles WHERE user_id = $1`, userID,
	).Scan(&p.UserID, &p.DisplayName, &p.Bio, &p.AvatarUrl, &p.BannerUrl,
		&p.AccentColor, &p.BackgroundUrl, &layout, &socialLinks,
		&featuredClips, &streamSchedule, &visibility,
		&p.Level, &p.TotalXP, &p.CreatedAt, &p.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get profile: %w", err)
	}

	json.Unmarshal(layout, &p.Layout)
	json.Unmarshal(socialLinks, &p.SocialLinks)
	json.Unmarshal(featuredClips, &p.FeaturedClips)
	json.Unmarshal(streamSchedule, &p.StreamSchedule)
	json.Unmarshal(visibility, &p.Visibility)

	return p, nil
}

func (r *ProfileRepository) Update(ctx context.Context, userID string, fields map[string]interface{}) error {
	setClauses := ""
	args := []interface{}{userID}
	i := 2

	for key, val := range fields {
		if setClauses != "" {
			setClauses += ", "
		}
		switch key {
		case "layout", "socialLinks", "featuredClips", "streamSchedule", "visibility":
			jsonBytes, _ := json.Marshal(val)
			setClauses += fmt.Sprintf("%s = $%d", toSnakeCase(key), i)
			args = append(args, string(jsonBytes))
		default:
			setClauses += fmt.Sprintf("%s = $%d", toSnakeCase(key), i)
			args = append(args, val)
		}
		i++
	}

	if setClauses == "" {
		return nil
	}

	setClauses += ", updated_at = NOW()"

	query := fmt.Sprintf("UPDATE profiles SET %s WHERE user_id = $1", setClauses)
	_, err := r.db.ExecContext(ctx, query, args...)
	return err
}

func (r *ProfileRepository) AddXP(ctx context.Context, userID string, xp int64) (int64, int, error) {
	var totalXP int64
	err := r.db.QueryRowContext(ctx, `
		UPDATE profiles SET total_xp = total_xp + $2, updated_at = NOW()
		WHERE user_id = $1
		RETURNING total_xp`, userID, xp).Scan(&totalXP)
	if err != nil {
		return 0, 0, fmt.Errorf("add xp: %w", err)
	}

	newLevel := model.CalculateLevel(totalXP)

	// Update level if changed
	r.db.ExecContext(ctx, `UPDATE profiles SET level = $2 WHERE user_id = $1 AND level != $2`, userID, newLevel)

	return totalXP, newLevel, nil
}

func (r *ProfileRepository) GetBadges(ctx context.Context, userID string) ([]model.UserBadge, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT b.id, b.name, b.description, b.icon_url, b.type, b.guild_id,
		       b.tier_required, b.created_at,
		       ub.displayed, ub.display_order, ub.earned_at
		FROM user_badges ub
		JOIN badges b ON b.id = ub.badge_id
		WHERE ub.user_id = $1
		ORDER BY ub.display_order`, userID)
	if err != nil {
		return nil, fmt.Errorf("get badges: %w", err)
	}
	defer rows.Close()

	var badges []model.UserBadge
	for rows.Next() {
		var ub model.UserBadge
		if err := rows.Scan(&ub.ID, &ub.Name, &ub.Description, &ub.IconUrl,
			&ub.Type, &ub.GuildID, &ub.TierRequired, &ub.CreatedAt,
			&ub.Displayed, &ub.DisplayOrder, &ub.EarnedAt); err != nil {
			return nil, fmt.Errorf("scan badge: %w", err)
		}
		badges = append(badges, ub)
	}
	return badges, nil
}

func (r *ProfileRepository) AwardBadge(ctx context.Context, userID, badgeID string) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, userID, badgeID)
	return err
}

func (r *ProfileRepository) UpdateBadgeDisplay(ctx context.Context, userID, badgeID string, displayed bool, order int) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE user_badges SET displayed = $3, display_order = $4
		WHERE user_id = $1 AND badge_id = $2`, userID, badgeID, displayed, order)
	return err
}

func (r *ProfileRepository) GetActivity(ctx context.Context, userID string, limit int) ([]model.ProfileActivity, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, user_id, type, data, public, created_at
		FROM profile_activity
		WHERE user_id = $1 AND public = true
		ORDER BY created_at DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("get activity: %w", err)
	}
	defer rows.Close()

	var activities []model.ProfileActivity
	for rows.Next() {
		a := model.ProfileActivity{}
		var data []byte
		if err := rows.Scan(&a.ID, &a.UserID, &a.Type, &data, &a.Public, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan activity: %w", err)
		}
		json.Unmarshal(data, &a.Data)
		activities = append(activities, a)
	}
	return activities, nil
}

func (r *ProfileRepository) LogActivity(ctx context.Context, userID, actType string, data interface{}) error {
	dataJSON, _ := json.Marshal(data)
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO profile_activity (user_id, type, data) VALUES ($1, $2, $3)`,
		userID, actType, string(dataJSON))
	return err
}

func toSnakeCase(s string) string {
	switch s {
	case "displayName":
		return "display_name"
	case "avatarUrl":
		return "avatar_url"
	case "bannerUrl":
		return "banner_url"
	case "accentColor":
		return "accent_color"
	case "backgroundUrl":
		return "background_url"
	case "socialLinks":
		return "social_links"
	case "featuredClips":
		return "featured_clips"
	case "streamSchedule":
		return "stream_schedule"
	default:
		return s
	}
}
