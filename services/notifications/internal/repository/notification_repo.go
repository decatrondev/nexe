package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/notifications/internal/model"
	"github.com/google/uuid"
)

type NotificationRepository struct {
	db *sql.DB
}

func NewNotificationRepository(db *sql.DB) *NotificationRepository {
	return &NotificationRepository{db: db}
}

func (r *NotificationRepository) Create(ctx context.Context, n *model.Notification) error {
	n.ID = uuid.New().String()
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO notifications (id, user_id, type, guild_id, channel_id, message_id, author_id, content, read, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NOW())`,
		n.ID, n.UserID, n.Type, n.GuildID, n.ChannelID, n.MessageID, n.AuthorID, n.Content,
	)
	return err
}

func (r *NotificationRepository) GetByUser(ctx context.Context, userID string, limit int, unreadOnly bool) ([]model.Notification, error) {
	query := `SELECT id, user_id, type, guild_id, channel_id, COALESCE(message_id::text, ''), COALESCE(author_id::text, ''), content, read, created_at
			   FROM notifications WHERE user_id = $1`
	if unreadOnly {
		query += ` AND read = false`
	}
	query += ` ORDER BY created_at DESC LIMIT $2`

	rows, err := r.db.QueryContext(ctx, query, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notifications []model.Notification
	for rows.Next() {
		var n model.Notification
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.GuildID, &n.ChannelID, &n.MessageID, &n.AuthorID, &n.Content, &n.Read, &n.CreatedAt); err != nil {
			return nil, err
		}
		notifications = append(notifications, n)
	}
	return notifications, nil
}

func (r *NotificationRepository) CountUnread(ctx context.Context, userID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false`, userID).Scan(&count)
	return count, err
}

func (r *NotificationRepository) MarkRead(ctx context.Context, userID, notifID string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`, notifID, userID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("notification not found")
	}
	return nil
}

func (r *NotificationRepository) MarkAllRead(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`, userID)
	return err
}

func (r *NotificationRepository) Delete(ctx context.Context, userID, notifID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM notifications WHERE id = $1 AND user_id = $2`, notifID, userID)
	return err
}

func (r *NotificationRepository) DeleteOlderThan(ctx context.Context, days int) (int64, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '1 day' * $1`, days)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DigestUser represents a user who has pending unread notifications for email digest.
type DigestUser struct {
	UserID   string
	Email    string
	Username string
	Count    int
}

// GetDigestUsers returns users who have unread notifications from the last N hours.
func (r *NotificationRepository) GetDigestUsers(ctx context.Context, hoursAgo int) ([]DigestUser, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT n.user_id, u.email, u.username, COUNT(*) as count
		 FROM notifications n
		 JOIN users u ON u.id = n.user_id
		 WHERE n.read = false
		   AND n.created_at > NOW() - INTERVAL '1 hour' * $1
		   AND u.email_verified = true
		   AND u.disabled = false
		 GROUP BY n.user_id, u.email, u.username
		 HAVING COUNT(*) >= 3
		 ORDER BY count DESC
		 LIMIT 500`,
		hoursAgo,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []DigestUser
	for rows.Next() {
		var u DigestUser
		if err := rows.Scan(&u.UserID, &u.Email, &u.Username, &u.Count); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}
