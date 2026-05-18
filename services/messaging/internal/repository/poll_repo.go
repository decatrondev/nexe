package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/decatrondev/nexe/services/messaging/internal/model"
)

type PollRepository struct {
	db *sql.DB
}

func NewPollRepository(db *sql.DB) *PollRepository {
	return &PollRepository{db: db}
}

func (r *PollRepository) Create(ctx context.Context, poll *model.Poll) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("poll create tx: %w", err)
	}
	defer tx.Rollback()

	err = tx.QueryRowContext(ctx,
		`INSERT INTO polls (channel_id, message_id, question, allow_multiple, anonymous, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
		poll.ChannelID, poll.MessageID, poll.Question, poll.AllowMultiple, poll.Anonymous, poll.ExpiresAt,
	).Scan(&poll.ID, &poll.CreatedAt)
	if err != nil {
		return fmt.Errorf("poll insert: %w", err)
	}

	for i, opt := range poll.Options {
		err = tx.QueryRowContext(ctx,
			`INSERT INTO poll_options (poll_id, text, position) VALUES ($1, $2, $3) RETURNING id`,
			poll.ID, opt.Text, i,
		).Scan(&poll.Options[i].ID)
		if err != nil {
			return fmt.Errorf("poll option insert: %w", err)
		}
		poll.Options[i].Position = i
	}

	return tx.Commit()
}

func (r *PollRepository) GetByMessage(ctx context.Context, messageID string) (*model.Poll, error) {
	var p model.Poll
	err := r.db.QueryRowContext(ctx,
		`SELECT id, channel_id, message_id, question, allow_multiple, anonymous, expires_at, closed, created_at
		 FROM polls WHERE message_id = $1`, messageID,
	).Scan(&p.ID, &p.ChannelID, &p.MessageID, &p.Question, &p.AllowMultiple, &p.Anonymous, &p.ExpiresAt, &p.Closed, &p.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("poll get: %w", err)
	}

	options, err := r.getOptions(ctx, p.ID, p.Anonymous)
	if err != nil {
		return nil, err
	}
	p.Options = options

	for _, opt := range p.Options {
		p.TotalVotes += opt.Votes
	}

	return &p, nil
}

func (r *PollRepository) BatchGetByMessages(ctx context.Context, messageIDs []string) (map[string]*model.Poll, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}

	// Build query with IN clause
	placeholders := ""
	args := make([]interface{}, len(messageIDs))
	for i, id := range messageIDs {
		if i > 0 {
			placeholders += ","
		}
		placeholders += fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	rows, err := r.db.QueryContext(ctx,
		`SELECT id, channel_id, message_id, question, allow_multiple, anonymous, expires_at, closed, created_at
		 FROM polls WHERE message_id IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("batch polls: %w", err)
	}
	defer rows.Close()

	result := make(map[string]*model.Poll)
	for rows.Next() {
		var p model.Poll
		if err := rows.Scan(&p.ID, &p.ChannelID, &p.MessageID, &p.Question, &p.AllowMultiple, &p.Anonymous, &p.ExpiresAt, &p.Closed, &p.CreatedAt); err != nil {
			return nil, err
		}
		result[p.MessageID] = &p
	}

	// Load options for each poll
	for msgID, poll := range result {
		options, err := r.getOptions(ctx, poll.ID, poll.Anonymous)
		if err != nil {
			return nil, err
		}
		poll.Options = options
		for _, opt := range poll.Options {
			poll.TotalVotes += opt.Votes
		}
		result[msgID] = poll
	}

	return result, nil
}

func (r *PollRepository) getOptions(ctx context.Context, pollID string, anonymous bool) ([]model.PollOption, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT po.id, po.text, po.position,
		        COUNT(pv.user_id) AS votes,
		        COALESCE(ARRAY_AGG(pv.user_id) FILTER (WHERE pv.user_id IS NOT NULL), '{}') AS voters
		 FROM poll_options po
		 LEFT JOIN poll_votes pv ON pv.option_id = po.id
		 WHERE po.poll_id = $1
		 GROUP BY po.id, po.text, po.position
		 ORDER BY po.position`, pollID)
	if err != nil {
		return nil, fmt.Errorf("poll options: %w", err)
	}
	defer rows.Close()

	var options []model.PollOption
	for rows.Next() {
		var opt model.PollOption
		var voters pqStringArray
		if err := rows.Scan(&opt.ID, &opt.Text, &opt.Position, &opt.Votes, &voters); err != nil {
			return nil, err
		}
		if !anonymous {
			opt.Voters = voters
		}
		options = append(options, opt)
	}
	return options, nil
}

func (r *PollRepository) Vote(ctx context.Context, optionID, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO poll_votes (option_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		optionID, userID)
	if err != nil {
		return fmt.Errorf("poll vote: %w", err)
	}
	return nil
}

func (r *PollRepository) Unvote(ctx context.Context, optionID, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM poll_votes WHERE option_id = $1 AND user_id = $2`,
		optionID, userID)
	if err != nil {
		return fmt.Errorf("poll unvote: %w", err)
	}
	return nil
}

func (r *PollRepository) RemoveAllVotes(ctx context.Context, pollID, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM poll_votes WHERE user_id = $1 AND option_id IN (SELECT id FROM poll_options WHERE poll_id = $2)`,
		userID, pollID)
	if err != nil {
		return fmt.Errorf("poll remove all votes: %w", err)
	}
	return nil
}

func (r *PollRepository) Close(ctx context.Context, pollID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE polls SET closed = true WHERE id = $1`, pollID)
	if err != nil {
		return fmt.Errorf("poll close: %w", err)
	}
	return nil
}

func (r *PollRepository) GetPollOwner(ctx context.Context, pollID string) (string, string, error) {
	var channelID, messageID string
	err := r.db.QueryRowContext(ctx,
		`SELECT p.channel_id, m.author_id FROM polls p JOIN messages m ON m.id = p.message_id WHERE p.id = $1`, pollID,
	).Scan(&channelID, &messageID)
	if err != nil {
		return "", "", fmt.Errorf("poll owner: %w", err)
	}
	return channelID, messageID, nil
}

func (r *PollRepository) GetOptionPollID(ctx context.Context, optionID string) (string, error) {
	var pollID string
	err := r.db.QueryRowContext(ctx,
		`SELECT poll_id FROM poll_options WHERE id = $1`, optionID).Scan(&pollID)
	if err != nil {
		return "", fmt.Errorf("option poll id: %w", err)
	}
	return pollID, nil
}
