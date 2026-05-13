package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/decatrondev/nexe/services/messaging/internal/model"
	"github.com/lib/pq"
)

type MessageRepository struct {
	db *sql.DB
}

func NewMessageRepository(db *sql.DB) *MessageRepository {
	return &MessageRepository{db: db}
}

func (r *MessageRepository) Create(ctx context.Context, msg *model.Message) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("message create begin tx: %w", err)
	}
	defer tx.Rollback()

	embedsJSON, err := json.Marshal(msg.Embeds)
	if err != nil {
		return fmt.Errorf("message create marshal embeds: %w", err)
	}
	if msg.Embeds == nil {
		embedsJSON = []byte("[]")
	}

	// Bridge messages have no Nexe author — pass NULL for author_id
	var authorParam interface{} = msg.AuthorID
	if msg.AuthorID == "" {
		authorParam = nil
	}

	err = tx.QueryRowContext(ctx,
		`INSERT INTO messages (channel_id, author_id, content, type, reply_to_id, thread_id, embeds, mention_everyone, bridge_source, bridge_author, bridge_author_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING id, created_at`,
		msg.ChannelID, authorParam, msg.Content, msg.Type,
		msg.ReplyToID, msg.ThreadID, string(embedsJSON), msg.MentionEveryone,
		msg.BridgeSource, msg.BridgeAuthor, msg.BridgeAuthorID,
	).Scan(&msg.ID, &msg.CreatedAt)
	if err != nil {
		return fmt.Errorf("message create insert: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`UPDATE channels SET last_message_id = $1, last_message_at = $2 WHERE id = $3`,
		msg.ID, msg.CreatedAt, msg.ChannelID,
	)
	if err != nil {
		return fmt.Errorf("message create update channel: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("message create commit: %w", err)
	}

	return nil
}

func (r *MessageRepository) GetByID(ctx context.Context, id string) (*model.Message, error) {
	var msg model.Message
	err := r.db.QueryRowContext(ctx,
		`SELECT id, channel_id, COALESCE(author_id::text, ''), content, type, reply_to_id, thread_id,
		        edited_at, deleted, pinned, pinned_by, embeds, mention_everyone, created_at,
		        bridge_source, bridge_author, bridge_author_id
		 FROM messages WHERE id = $1`, id,
	).Scan(
		&msg.ID, &msg.ChannelID, &msg.AuthorID, &msg.Content, &msg.Type,
		&msg.ReplyToID, &msg.ThreadID, &msg.EditedAt, &msg.Deleted,
		&msg.Pinned, &msg.PinnedBy, scanJSON(&msg.Embeds), &msg.MentionEveryone, &msg.CreatedAt,
		&msg.BridgeSource, &msg.BridgeAuthor, &msg.BridgeAuthorID,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("message get by id: %w", err)
	}

	attachments, err := r.fetchAttachments(ctx, []string{msg.ID})
	if err != nil {
		return nil, err
	}
	msg.Attachments = attachments[msg.ID]

	reactions, err := r.fetchReactions(ctx, []string{msg.ID})
	if err != nil {
		return nil, err
	}
	msg.Reactions = reactions[msg.ID]

	return &msg, nil
}

func (r *MessageRepository) ListByChannel(ctx context.Context, channelID string, before *string, limit int) ([]model.Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var rows *sql.Rows
	var err error

	if before != nil {
		rows, err = r.db.QueryContext(ctx,
			`SELECT id, channel_id, COALESCE(author_id::text, ''), content, type, reply_to_id, thread_id,
			        edited_at, deleted, pinned, pinned_by, embeds, mention_everyone, created_at,
		        bridge_source, bridge_author, bridge_author_id
			 FROM messages
			 WHERE channel_id = $1 AND deleted = false AND thread_id IS NULL AND created_at < (SELECT created_at FROM messages WHERE id = $2)
			 ORDER BY created_at DESC
			 LIMIT $3`,
			channelID, *before, limit,
		)
	} else {
		rows, err = r.db.QueryContext(ctx,
			`SELECT id, channel_id, COALESCE(author_id::text, ''), content, type, reply_to_id, thread_id,
			        edited_at, deleted, pinned, pinned_by, embeds, mention_everyone, created_at,
		        bridge_source, bridge_author, bridge_author_id
			 FROM messages
			 WHERE channel_id = $1 AND deleted = false AND thread_id IS NULL
			 ORDER BY created_at DESC
			 LIMIT $2`,
			channelID, limit,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("message list by channel: %w", err)
	}
	defer rows.Close()

	var messages []model.Message
	var messageIDs []string
	for rows.Next() {
		var msg model.Message
		if err := rows.Scan(
			&msg.ID, &msg.ChannelID, &msg.AuthorID, &msg.Content, &msg.Type,
			&msg.ReplyToID, &msg.ThreadID, &msg.EditedAt, &msg.Deleted,
			&msg.Pinned, &msg.PinnedBy, scanJSON(&msg.Embeds), &msg.MentionEveryone, &msg.CreatedAt,
			&msg.BridgeSource, &msg.BridgeAuthor, &msg.BridgeAuthorID,
		); err != nil {
			return nil, fmt.Errorf("message list by channel scan: %w", err)
		}
		messages = append(messages, msg)
		messageIDs = append(messageIDs, msg.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("message list by channel rows: %w", err)
	}

	if len(messageIDs) == 0 {
		return messages, nil
	}

	attachments, err := r.fetchAttachments(ctx, messageIDs)
	if err != nil {
		return nil, err
	}

	reactions, err := r.fetchReactions(ctx, messageIDs)
	if err != nil {
		return nil, err
	}

	// Batch fetch thread info for messages that might have threads
	threadInfo, err := r.BatchGetThreadInfo(ctx, messageIDs)
	if err != nil {
		return nil, err
	}

	for i := range messages {
		messages[i].Attachments = attachments[messages[i].ID]
		messages[i].Reactions = reactions[messages[i].ID]
		if ti, ok := threadInfo[messages[i].ID]; ok {
			messages[i].Thread = &ti
		}
	}

	return messages, nil
}

func (r *MessageRepository) ListByThread(ctx context.Context, threadID string, before *string, limit int) ([]model.Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var rows *sql.Rows
	var err error

	if before != nil {
		rows, err = r.db.QueryContext(ctx,
			`SELECT id, channel_id, COALESCE(author_id::text, ''), content, type, reply_to_id, thread_id,
			        edited_at, deleted, pinned, pinned_by, embeds, mention_everyone, created_at,
			        bridge_source, bridge_author, bridge_author_id
			 FROM messages
			 WHERE thread_id = $1 AND deleted = false AND created_at < (SELECT created_at FROM messages WHERE id = $2)
			 ORDER BY created_at ASC
			 LIMIT $3`,
			threadID, *before, limit,
		)
	} else {
		rows, err = r.db.QueryContext(ctx,
			`SELECT id, channel_id, COALESCE(author_id::text, ''), content, type, reply_to_id, thread_id,
			        edited_at, deleted, pinned, pinned_by, embeds, mention_everyone, created_at,
			        bridge_source, bridge_author, bridge_author_id
			 FROM messages
			 WHERE thread_id = $1 AND deleted = false
			 ORDER BY created_at ASC
			 LIMIT $2`,
			threadID, limit,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("message list by thread: %w", err)
	}
	defer rows.Close()

	var messages []model.Message
	var messageIDs []string
	for rows.Next() {
		var msg model.Message
		if err := rows.Scan(
			&msg.ID, &msg.ChannelID, &msg.AuthorID, &msg.Content, &msg.Type,
			&msg.ReplyToID, &msg.ThreadID, &msg.EditedAt, &msg.Deleted,
			&msg.Pinned, &msg.PinnedBy, scanJSON(&msg.Embeds), &msg.MentionEveryone, &msg.CreatedAt,
			&msg.BridgeSource, &msg.BridgeAuthor, &msg.BridgeAuthorID,
		); err != nil {
			return nil, fmt.Errorf("message list by thread scan: %w", err)
		}
		messages = append(messages, msg)
		messageIDs = append(messageIDs, msg.ID)
	}

	if len(messageIDs) > 0 {
		attachments, _ := r.fetchAttachments(ctx, messageIDs)
		reactions, _ := r.fetchReactions(ctx, messageIDs)
		for i := range messages {
			messages[i].Attachments = attachments[messages[i].ID]
			messages[i].Reactions = reactions[messages[i].ID]
		}
	}

	return messages, nil
}

func (r *MessageRepository) BatchGetThreadInfo(ctx context.Context, messageIDs []string) (map[string]model.ThreadInfo, error) {
	result := make(map[string]model.ThreadInfo)
	if len(messageIDs) == 0 {
		return result, nil
	}

	rows, err := r.db.QueryContext(ctx,
		`SELECT thread_id, COUNT(*), MAX(created_at)
		 FROM messages
		 WHERE thread_id = ANY($1) AND deleted = false
		 GROUP BY thread_id`,
		pq.Array(messageIDs),
	)
	if err != nil {
		return nil, fmt.Errorf("batch get thread info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var threadID string
		var ti model.ThreadInfo
		if err := rows.Scan(&threadID, &ti.ReplyCount, &ti.LastReplyAt); err != nil {
			return nil, fmt.Errorf("batch get thread info scan: %w", err)
		}
		result[threadID] = ti
	}
	return result, rows.Err()
}

func (r *MessageRepository) Update(ctx context.Context, id, newContent string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("message update begin tx: %w", err)
	}
	defer tx.Rollback()

	var oldContent string
	err = tx.QueryRowContext(ctx,
		`SELECT content FROM messages WHERE id = $1`, id,
	).Scan(&oldContent)
	if err == sql.ErrNoRows {
		return fmt.Errorf("message not found")
	}
	if err != nil {
		return fmt.Errorf("message update get old: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO message_edits (message_id, old_content) VALUES ($1, $2)`,
		id, oldContent,
	)
	if err != nil {
		return fmt.Errorf("message update save edit: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2`,
		newContent, id,
	)
	if err != nil {
		return fmt.Errorf("message update content: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("message update commit: %w", err)
	}

	return nil
}

func (r *MessageRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE messages SET deleted = true, deleted_at = NOW() WHERE id = $1`, id,
	)
	if err != nil {
		return fmt.Errorf("message delete: %w", err)
	}
	return nil
}

func (r *MessageRepository) Pin(ctx context.Context, messageID, pinnedBy string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE messages SET pinned = true, pinned_by = $1, pinned_at = NOW() WHERE id = $2`,
		pinnedBy, messageID,
	)
	if err != nil {
		return fmt.Errorf("message pin: %w", err)
	}
	return nil
}

func (r *MessageRepository) Unpin(ctx context.Context, messageID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE messages SET pinned = false, pinned_by = NULL, pinned_at = NULL WHERE id = $1`,
		messageID,
	)
	if err != nil {
		return fmt.Errorf("message unpin: %w", err)
	}
	return nil
}

func (r *MessageRepository) ListPins(ctx context.Context, channelID string) ([]model.Message, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, channel_id, COALESCE(author_id::text, ''), content, type, reply_to_id, thread_id,
		        edited_at, deleted, pinned, pinned_by, embeds, mention_everyone, created_at,
		        bridge_source, bridge_author, bridge_author_id
		 FROM messages
		 WHERE channel_id = $1 AND pinned = true AND deleted = false
		 ORDER BY pinned_at DESC`,
		channelID,
	)
	if err != nil {
		return nil, fmt.Errorf("message list pins: %w", err)
	}
	defer rows.Close()

	var messages []model.Message
	var messageIDs []string
	for rows.Next() {
		var msg model.Message
		if err := rows.Scan(
			&msg.ID, &msg.ChannelID, &msg.AuthorID, &msg.Content, &msg.Type,
			&msg.ReplyToID, &msg.ThreadID, &msg.EditedAt, &msg.Deleted,
			&msg.Pinned, &msg.PinnedBy, scanJSON(&msg.Embeds), &msg.MentionEveryone, &msg.CreatedAt,
			&msg.BridgeSource, &msg.BridgeAuthor, &msg.BridgeAuthorID,
		); err != nil {
			return nil, fmt.Errorf("message list pins scan: %w", err)
		}
		messages = append(messages, msg)
		messageIDs = append(messageIDs, msg.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("message list pins rows: %w", err)
	}

	if len(messageIDs) == 0 {
		return messages, nil
	}

	attachments, err := r.fetchAttachments(ctx, messageIDs)
	if err != nil {
		return nil, err
	}

	for i := range messages {
		messages[i].Attachments = attachments[messages[i].ID]
	}

	return messages, nil
}

func (r *MessageRepository) Search(ctx context.Context, channelID, query string, authorID *string, limit int) ([]model.Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}

	var conditions []string
	var args []interface{}
	argIdx := 1

	conditions = append(conditions, fmt.Sprintf("channel_id = $%d", argIdx))
	args = append(args, channelID)
	argIdx++

	conditions = append(conditions, fmt.Sprintf("search_vector @@ plainto_tsquery('english', $%d)", argIdx))
	args = append(args, query)
	argIdx++

	conditions = append(conditions, "deleted = false")

	if authorID != nil {
		conditions = append(conditions, fmt.Sprintf("author_id = $%d", argIdx))
		args = append(args, *authorID)
		argIdx++
	}

	args = append(args, limit)

	sqlQuery := fmt.Sprintf(
		`SELECT id, channel_id, COALESCE(author_id::text, ''), content, type, reply_to_id, thread_id,
		        edited_at, deleted, pinned, pinned_by, embeds, mention_everyone, created_at,
		        bridge_source, bridge_author, bridge_author_id
		 FROM messages
		 WHERE %s
		 ORDER BY ts_rank(search_vector, plainto_tsquery('english', $2)) DESC
		 LIMIT $%d`,
		strings.Join(conditions, " AND "), argIdx,
	)

	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("message search: %w", err)
	}
	defer rows.Close()

	var messages []model.Message
	var messageIDs []string
	for rows.Next() {
		var msg model.Message
		if err := rows.Scan(
			&msg.ID, &msg.ChannelID, &msg.AuthorID, &msg.Content, &msg.Type,
			&msg.ReplyToID, &msg.ThreadID, &msg.EditedAt, &msg.Deleted,
			&msg.Pinned, &msg.PinnedBy, scanJSON(&msg.Embeds), &msg.MentionEveryone, &msg.CreatedAt,
			&msg.BridgeSource, &msg.BridgeAuthor, &msg.BridgeAuthorID,
		); err != nil {
			return nil, fmt.Errorf("message search scan: %w", err)
		}
		messages = append(messages, msg)
		messageIDs = append(messageIDs, msg.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("message search rows: %w", err)
	}

	if len(messageIDs) == 0 {
		return messages, nil
	}

	attachments, err := r.fetchAttachments(ctx, messageIDs)
	if err != nil {
		return nil, err
	}

	for i := range messages {
		messages[i].Attachments = attachments[messages[i].ID]
	}

	return messages, nil
}

func (r *MessageRepository) GetEditHistory(ctx context.Context, messageID string) ([]model.MessageEdit, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, message_id, old_content, edited_at
		 FROM message_edits
		 WHERE message_id = $1
		 ORDER BY edited_at DESC`,
		messageID,
	)
	if err != nil {
		return nil, fmt.Errorf("message get edit history: %w", err)
	}
	defer rows.Close()

	var edits []model.MessageEdit
	for rows.Next() {
		var edit model.MessageEdit
		if err := rows.Scan(&edit.ID, &edit.MessageID, &edit.OldContent, &edit.EditedAt); err != nil {
			return nil, fmt.Errorf("message get edit history scan: %w", err)
		}
		edits = append(edits, edit)
	}
	return edits, rows.Err()
}

// fetchAttachments batch-fetches attachments for the given message IDs.
func (r *MessageRepository) fetchAttachments(ctx context.Context, messageIDs []string) (map[string][]model.Attachment, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(messageIDs))
	args := make([]interface{}, len(messageIDs))
	for i, id := range messageIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(
		`SELECT id, message_id, filename, url, content_type, size_bytes, width, height
		 FROM attachments
		 WHERE message_id IN (%s)
		 ORDER BY created_at`,
		strings.Join(placeholders, ", "),
	)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("fetch attachments: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]model.Attachment)
	for rows.Next() {
		var a model.Attachment
		if err := rows.Scan(&a.ID, &a.MessageID, &a.Filename, &a.URL, &a.ContentType, &a.SizeBytes, &a.Width, &a.Height); err != nil {
			return nil, fmt.Errorf("fetch attachments scan: %w", err)
		}
		result[a.MessageID] = append(result[a.MessageID], a)
	}
	return result, rows.Err()
}

// fetchReactions batch-fetches and aggregates reactions for the given message IDs.
func (r *MessageRepository) fetchReactions(ctx context.Context, messageIDs []string) (map[string][]model.ReactionGroup, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(messageIDs))
	args := make([]interface{}, len(messageIDs))
	for i, id := range messageIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(
		`SELECT message_id, emoji, COUNT(*) as count,
		        ARRAY_AGG(user_id::text ORDER BY created_at) as users
		 FROM reactions
		 WHERE message_id IN (%s)
		 GROUP BY message_id, emoji
		 ORDER BY MIN(created_at)`,
		strings.Join(placeholders, ", "),
	)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("fetch reactions: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]model.ReactionGroup)
	for rows.Next() {
		var messageID string
		var rg model.ReactionGroup
		var users pqStringArray
		if err := rows.Scan(&messageID, &rg.Emoji, &rg.Count, &users); err != nil {
			return nil, fmt.Errorf("fetch reactions scan: %w", err)
		}
		rg.Users = []string(users)
		result[messageID] = append(result[messageID], rg)
	}
	return result, rows.Err()
}

// pqStringArray implements sql.Scanner for PostgreSQL text arrays.
type pqStringArray []string

func (a *pqStringArray) Scan(src interface{}) error {
	if src == nil {
		*a = nil
		return nil
	}
	switch v := src.(type) {
	case []byte:
		return a.parseArray(string(v))
	case string:
		return a.parseArray(v)
	default:
		return fmt.Errorf("pqStringArray: cannot scan type %T", src)
	}
}

// GetChannelGuildID looks up the guild_id for a given channel.
// The channels table lives in the same database (managed by the guilds service).
func (r *MessageRepository) GetChannelGuildID(ctx context.Context, channelID string) (string, error) {
	var guildID string
	err := r.db.QueryRowContext(ctx,
		`SELECT guild_id FROM channels WHERE id = $1`, channelID,
	).Scan(&guildID)
	if err != nil {
		return "", fmt.Errorf("get channel guild_id: %w", err)
	}
	return guildID, nil
}

func (a *pqStringArray) parseArray(s string) error {
	if len(s) < 2 || s[0] != '{' || s[len(s)-1] != '}' {
		*a = nil
		return nil
	}
	inner := s[1 : len(s)-1]
	if inner == "" {
		*a = nil
		return nil
	}
	var result []string
	start := 0
	for i := 0; i <= len(inner); i++ {
		if i == len(inner) || inner[i] == ',' {
			result = append(result, inner[start:i])
			start = i + 1
		}
	}
	*a = result
	return nil
}

// ---- Read States ----

type UnreadChannel struct {
	ChannelID       string `json:"channelId"`
	LastMessageID   string `json:"lastMessageId"`
	LastReadID      string `json:"lastReadId"`
	UnreadCount     int    `json:"unreadCount"`
	MentionCount    int    `json:"mentionCount"`
}

func (r *MessageRepository) AckChannel(ctx context.Context, userID, channelID, messageID string) error {
	if messageID == "" {
		// Get the latest message in the channel
		err := r.db.QueryRowContext(ctx,
			`SELECT id FROM messages WHERE channel_id = $1 AND deleted = false ORDER BY created_at DESC LIMIT 1`,
			channelID,
		).Scan(&messageID)
		if err != nil {
			return nil // no messages, nothing to ack
		}
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO read_states (user_id, channel_id, last_read_message_id, last_read_at)
		 VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (user_id, channel_id)
		 DO UPDATE SET last_read_message_id = $3, last_read_at = NOW()`,
		userID, channelID, messageID,
	)
	return err
}

func (r *MessageRepository) GetUnreadChannels(ctx context.Context, userID string) ([]UnreadChannel, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT c.id AS channel_id,
		        COALESCE(c.last_message_id::text, '') AS last_message_id,
		        COALESCE(rs.last_read_message_id::text, '') AS last_read_id,
		        COALESCE(
		          (SELECT COUNT(*) FROM messages m
		           WHERE m.channel_id = c.id AND m.deleted = false
		           AND m.created_at > COALESCE(
		             (SELECT created_at FROM messages WHERE id = rs.last_read_message_id),
		             '1970-01-01'::timestamptz
		           )), 0
		        )::int AS unread_count
		 FROM channels c
		 LEFT JOIN read_states rs ON rs.channel_id = c.id AND rs.user_id = $1
		 WHERE c.guild_id IN (SELECT guild_id FROM guild_members WHERE user_id = $1)
		   AND c.last_message_id IS NOT NULL
		   AND (rs.last_read_message_id IS NULL OR rs.last_read_message_id != c.last_message_id)`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var unreads []UnreadChannel
	for rows.Next() {
		var u UnreadChannel
		if err := rows.Scan(&u.ChannelID, &u.LastMessageID, &u.LastReadID, &u.UnreadCount); err != nil {
			return nil, err
		}
		if u.UnreadCount > 0 {
			unreads = append(unreads, u)
		}
	}
	if unreads == nil {
		unreads = []UnreadChannel{}
	}
	return unreads, nil
}
