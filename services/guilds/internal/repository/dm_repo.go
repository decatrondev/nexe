package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type DMChannel struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // "dm" or "group_dm"
	Name      *string   `json:"name,omitempty"`
	IconURL   *string   `json:"iconUrl,omitempty"`
	OwnerID   *string   `json:"ownerId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	// Populated at query time
	Participants []DMParticipant `json:"participants,omitempty"`
}

type DMParticipant struct {
	ChannelID string    `json:"channelId"`
	UserID    string    `json:"userId"`
	Closed    bool      `json:"closed"`
	IsRequest bool      `json:"isRequest"`
	JoinedAt  time.Time `json:"joinedAt"`
}

type DMMessage struct {
	ID              string          `json:"id"`
	ChannelID       string          `json:"channelId"`
	AuthorID        string          `json:"authorId"`
	Content         string          `json:"content"`
	Type            string          `json:"type"`
	ReplyToID       *string         `json:"replyToId,omitempty"`
	Embeds          json.RawMessage `json:"embeds"`
	Attachments     json.RawMessage `json:"attachments"`
	MentionEveryone bool            `json:"mentionEveryone"`
	EditedAt        *time.Time      `json:"editedAt,omitempty"`
	Deleted         bool            `json:"deleted"`
	Pinned          bool            `json:"pinned"`
	CreatedAt       time.Time       `json:"createdAt"`
}

type DMRepository struct {
	db *sql.DB
}

func NewDMRepository(db *sql.DB) *DMRepository {
	return &DMRepository{db: db}
}

// ---- DM Channels ----

// GetOrCreateDM finds an existing 1-on-1 DM between two users or creates one.
func (r *DMRepository) GetOrCreateDM(ctx context.Context, userA, userB string) (*DMChannel, error) {
	// Check if DM already exists between these two users
	var channelID string
	err := r.db.QueryRowContext(ctx, `
		SELECT p1.channel_id FROM dm_participants p1
		JOIN dm_participants p2 ON p1.channel_id = p2.channel_id
		JOIN dm_channels c ON c.id = p1.channel_id
		WHERE p1.user_id = $1 AND p2.user_id = $2 AND c.type = 'dm'
	`, userA, userB).Scan(&channelID)

	if err == nil {
		// DM exists, reopen if closed for the requester
		r.db.ExecContext(ctx, `UPDATE dm_participants SET closed = false WHERE channel_id = $1 AND user_id = $2`, channelID, userA)
		return r.GetByID(ctx, channelID)
	}

	// Create new DM channel
	ch := &DMChannel{Type: "dm"}
	err = r.db.QueryRowContext(ctx,
		`INSERT INTO dm_channels (type) VALUES ('dm') RETURNING id, created_at, updated_at`,
	).Scan(&ch.ID, &ch.CreatedAt, &ch.UpdatedAt)
	if err != nil {
		return nil, err
	}

	// Add both participants
	for _, uid := range []string{userA, userB} {
		_, err = r.db.ExecContext(ctx,
			`INSERT INTO dm_participants (channel_id, user_id) VALUES ($1, $2)`,
			ch.ID, uid,
		)
		if err != nil {
			return nil, err
		}
	}

	return r.GetByID(ctx, ch.ID)
}

// CreateGroupDM creates a new group DM.
func (r *DMRepository) CreateGroupDM(ctx context.Context, ownerID string, name string, userIDs []string) (*DMChannel, error) {
	ch := &DMChannel{Type: "group_dm", Name: &name, OwnerID: &ownerID}
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO dm_channels (type, name, owner_id) VALUES ('group_dm', $1, $2) RETURNING id, created_at, updated_at`,
		name, ownerID,
	).Scan(&ch.ID, &ch.CreatedAt, &ch.UpdatedAt)
	if err != nil {
		return nil, err
	}

	// Add all participants including owner
	allUsers := append([]string{ownerID}, userIDs...)
	for _, uid := range allUsers {
		_, err = r.db.ExecContext(ctx,
			`INSERT INTO dm_participants (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			ch.ID, uid,
		)
		if err != nil {
			return nil, err
		}
	}

	return r.GetByID(ctx, ch.ID)
}

func (r *DMRepository) GetByID(ctx context.Context, channelID string) (*DMChannel, error) {
	ch := &DMChannel{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id, type, name, icon_url, owner_id, created_at, updated_at FROM dm_channels WHERE id = $1`,
		channelID,
	).Scan(&ch.ID, &ch.Type, &ch.Name, &ch.IconURL, &ch.OwnerID, &ch.CreatedAt, &ch.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// Load participants
	rows, err := r.db.QueryContext(ctx,
		`SELECT channel_id, user_id, closed, is_request, joined_at FROM dm_participants WHERE channel_id = $1`,
		channelID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p DMParticipant
		if err := rows.Scan(&p.ChannelID, &p.UserID, &p.Closed, &p.IsRequest, &p.JoinedAt); err != nil {
			return nil, err
		}
		ch.Participants = append(ch.Participants, p)
	}
	return ch, nil
}

// ListForUser returns all DM channels for a user that are not closed, ordered by most recent message.
func (r *DMRepository) ListForUser(ctx context.Context, userID string) ([]DMChannel, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT c.id, c.type, c.name, c.icon_url, c.owner_id, c.created_at, c.updated_at
		FROM dm_channels c
		JOIN dm_participants p ON p.channel_id = c.id
		WHERE p.user_id = $1 AND p.closed = false
		ORDER BY c.updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var channels []DMChannel
	for rows.Next() {
		var ch DMChannel
		if err := rows.Scan(&ch.ID, &ch.Type, &ch.Name, &ch.IconURL, &ch.OwnerID, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			return nil, err
		}
		channels = append(channels, ch)
	}

	// Load participants for each channel
	for i := range channels {
		pRows, err := r.db.QueryContext(ctx,
			`SELECT channel_id, user_id, closed, is_request, joined_at FROM dm_participants WHERE channel_id = $1`,
			channels[i].ID,
		)
		if err != nil {
			continue
		}
		for pRows.Next() {
			var p DMParticipant
			if err := pRows.Scan(&p.ChannelID, &p.UserID, &p.Closed, &p.IsRequest, &p.JoinedAt); err != nil {
				continue
			}
			channels[i].Participants = append(channels[i].Participants, p)
		}
		pRows.Close()
	}

	return channels, nil
}

// IsParticipant checks if a user is a participant of a DM channel.
func (r *DMRepository) IsParticipant(ctx context.Context, channelID, userID string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM dm_participants WHERE channel_id = $1 AND user_id = $2)`,
		channelID, userID,
	).Scan(&exists)
	return exists, err
}

// CloseDM hides a DM from the user's list (doesn't delete messages).
func (r *DMRepository) CloseDM(ctx context.Context, channelID, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE dm_participants SET closed = true WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID,
	)
	return err
}

// ReopenDM re-shows a DM in the user's list.
func (r *DMRepository) ReopenDM(ctx context.Context, channelID, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE dm_participants SET closed = false WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID,
	)
	return err
}

// TouchChannel updates the updated_at timestamp (for sorting by most recent activity).
func (r *DMRepository) TouchChannel(ctx context.Context, channelID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE dm_channels SET updated_at = NOW() WHERE id = $1`,
		channelID,
	)
	return err
}

// GetParticipantIDs returns all participant user IDs for a DM channel.
func (r *DMRepository) GetParticipantIDs(ctx context.Context, channelID string) ([]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT user_id FROM dm_participants WHERE channel_id = $1`,
		channelID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// AreFriendsOrShareGuild checks if two users are friends or share at least one guild.
func (r *DMRepository) AreFriendsOrShareGuild(ctx context.Context, userA, userB string) (bool, error) {
	var exists bool
	// Check friendship
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM relationships WHERE user_id = $1 AND target_id = $2 AND type = 'friend'
		)`, userA, userB).Scan(&exists)
	if err != nil {
		return false, err
	}
	if exists {
		return true, nil
	}
	// Check shared guild
	err = r.db.QueryRowContext(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM guild_members m1
			JOIN guild_members m2 ON m1.guild_id = m2.guild_id
			WHERE m1.user_id = $1 AND m2.user_id = $2
		)`, userA, userB).Scan(&exists)
	return exists, err
}

// SetIsRequest marks a DM as a request for a user.
func (r *DMRepository) SetIsRequest(ctx context.Context, channelID, userID string, isRequest bool) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE dm_participants SET is_request = $3 WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID, isRequest,
	)
	return err
}

// ListRequestsForUser returns DM channels marked as requests for this user.
func (r *DMRepository) ListRequestsForUser(ctx context.Context, userID string) ([]DMChannel, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT c.id, c.type, c.name, c.icon_url, c.owner_id, c.created_at, c.updated_at
		FROM dm_channels c
		JOIN dm_participants p ON p.channel_id = c.id
		WHERE p.user_id = $1 AND p.is_request = true AND p.closed = false
		ORDER BY c.updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var channels []DMChannel
	for rows.Next() {
		var ch DMChannel
		if err := rows.Scan(&ch.ID, &ch.Type, &ch.Name, &ch.IconURL, &ch.OwnerID, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			return nil, err
		}
		channels = append(channels, ch)
	}
	// Load participants
	for i := range channels {
		pRows, _ := r.db.QueryContext(ctx,
			`SELECT channel_id, user_id, closed, is_request, joined_at FROM dm_participants WHERE channel_id = $1`, channels[i].ID)
		if pRows != nil {
			for pRows.Next() {
				var p DMParticipant
				if err := pRows.Scan(&p.ChannelID, &p.UserID, &p.Closed, &p.IsRequest, &p.JoinedAt); err == nil {
					channels[i].Participants = append(channels[i].Participants, p)
				}
			}
			pRows.Close()
		}
	}
	return channels, nil
}

// AddParticipant adds a user to a group DM.
func (r *DMRepository) AddParticipant(ctx context.Context, channelID, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO dm_participants (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		channelID, userID,
	)
	return err
}

// RemoveParticipant removes a user from a group DM.
func (r *DMRepository) RemoveParticipant(ctx context.Context, channelID, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM dm_participants WHERE channel_id = $1 AND user_id = $2`,
		channelID, userID,
	)
	return err
}

// UpdateChannel updates name/icon of a group DM.
func (r *DMRepository) UpdateChannel(ctx context.Context, channelID string, name *string, iconURL *string) error {
	if name != nil {
		_, err := r.db.ExecContext(ctx,
			`UPDATE dm_channels SET name = $1, updated_at = NOW() WHERE id = $2`, *name, channelID)
		if err != nil {
			return err
		}
	}
	if iconURL != nil {
		_, err := r.db.ExecContext(ctx,
			`UPDATE dm_channels SET icon_url = $1, updated_at = NOW() WHERE id = $2`, *iconURL, channelID)
		if err != nil {
			return err
		}
	}
	return nil
}

// ParticipantCount returns the number of participants in a DM channel.
func (r *DMRepository) ParticipantCount(ctx context.Context, channelID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM dm_participants WHERE channel_id = $1`, channelID,
	).Scan(&count)
	return count, err
}

// ---- DM Messages ----

func (r *DMRepository) CreateMessage(ctx context.Context, msg *DMMessage) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO dm_messages (channel_id, author_id, content, type, reply_to_id, embeds, attachments, mention_everyone)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at`,
		msg.ChannelID, msg.AuthorID, msg.Content, msg.Type,
		msg.ReplyToID, msg.Embeds, msg.Attachments, msg.MentionEveryone,
	).Scan(&msg.ID, &msg.CreatedAt)
}

func (r *DMRepository) GetMessages(ctx context.Context, channelID string, limit int, before string) ([]DMMessage, error) {
	var rows *sql.Rows
	var err error

	if before != "" {
		rows, err = r.db.QueryContext(ctx, `
			SELECT id, channel_id, author_id, content, type, reply_to_id,
			       embeds, attachments, mention_everyone, edited_at, deleted, pinned, created_at
			FROM dm_messages
			WHERE channel_id = $1 AND deleted = false AND created_at < (SELECT created_at FROM dm_messages WHERE id = $2)
			ORDER BY created_at DESC LIMIT $3`, channelID, before, limit)
	} else {
		rows, err = r.db.QueryContext(ctx, `
			SELECT id, channel_id, author_id, content, type, reply_to_id,
			       embeds, attachments, mention_everyone, edited_at, deleted, pinned, created_at
			FROM dm_messages
			WHERE channel_id = $1 AND deleted = false
			ORDER BY created_at DESC LIMIT $2`, channelID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []DMMessage
	for rows.Next() {
		var m DMMessage
		if err := rows.Scan(
			&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.Type, &m.ReplyToID,
			&m.Embeds, &m.Attachments, &m.MentionEveryone, &m.EditedAt, &m.Deleted, &m.Pinned, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		messages = append(messages, m)
	}

	// Reverse to chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	return messages, nil
}

func (r *DMRepository) GetMessageByID(ctx context.Context, id string) (*DMMessage, error) {
	var m DMMessage
	err := r.db.QueryRowContext(ctx, `
		SELECT id, channel_id, author_id, content, type, reply_to_id,
		       embeds, attachments, mention_everyone, edited_at, deleted, pinned, created_at
		FROM dm_messages WHERE id = $1`, id,
	).Scan(&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.Type, &m.ReplyToID,
		&m.Embeds, &m.Attachments, &m.MentionEveryone, &m.EditedAt, &m.Deleted, &m.Pinned, &m.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *DMRepository) EditMessage(ctx context.Context, id, content string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE dm_messages SET content = $2, edited_at = NOW() WHERE id = $1`,
		id, content,
	)
	return err
}

func (r *DMRepository) DeleteMessage(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE dm_messages SET deleted = true WHERE id = $1`, id,
	)
	return err
}
