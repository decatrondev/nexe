package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

type AutomodRule struct {
	ID                    string          `json:"id"`
	GuildID               string          `json:"guildId"`
	Type                  string          `json:"type"` // blocked_words, anti_spam, anti_caps, anti_links
	Enabled               bool            `json:"enabled"`
	Config                json.RawMessage `json:"config"`
	Action                string          `json:"action"` // block, warn, timeout
	ActionDurationSeconds *int            `json:"actionDurationSeconds,omitempty"`
	CreatedAt             string          `json:"createdAt"`
	UpdatedAt             string          `json:"updatedAt"`
}

type AutomodRepository struct {
	db *sql.DB
}

func NewAutomodRepository(db *sql.DB) *AutomodRepository {
	return &AutomodRepository{db: db}
}

func (r *AutomodRepository) Create(ctx context.Context, rule *AutomodRule) error {
	rule.ID = uuid.New().String()
	return r.db.QueryRowContext(ctx,
		`INSERT INTO automod_rules (id, guild_id, type, enabled, config, action, action_duration_seconds)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING created_at, updated_at`,
		rule.ID, rule.GuildID, rule.Type, rule.Enabled, rule.Config, rule.Action, rule.ActionDurationSeconds,
	).Scan(&rule.CreatedAt, &rule.UpdatedAt)
}

func (r *AutomodRepository) ListByGuild(ctx context.Context, guildID string) ([]AutomodRule, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, guild_id, type, enabled, config, action, action_duration_seconds, created_at, updated_at
		 FROM automod_rules WHERE guild_id = $1 ORDER BY created_at`, guildID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []AutomodRule
	for rows.Next() {
		var rule AutomodRule
		if err := rows.Scan(&rule.ID, &rule.GuildID, &rule.Type, &rule.Enabled, &rule.Config,
			&rule.Action, &rule.ActionDurationSeconds, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

func (r *AutomodRepository) Update(ctx context.Context, id string, enabled *bool, config *json.RawMessage, action *string) error {
	if enabled != nil {
		r.db.ExecContext(ctx, `UPDATE automod_rules SET enabled = $1, updated_at = NOW() WHERE id = $2`, *enabled, id)
	}
	if config != nil {
		r.db.ExecContext(ctx, `UPDATE automod_rules SET config = $1, updated_at = NOW() WHERE id = $2`, *config, id)
	}
	if action != nil {
		r.db.ExecContext(ctx, `UPDATE automod_rules SET action = $1, updated_at = NOW() WHERE id = $2`, *action, id)
	}
	return nil
}

func (r *AutomodRepository) GetByID(ctx context.Context, id string) (*AutomodRule, error) {
	var rule AutomodRule
	err := r.db.QueryRowContext(ctx,
		`SELECT id, guild_id, type, enabled, config, action, action_duration_seconds, created_at, updated_at
		 FROM automod_rules WHERE id = $1`, id).
		Scan(&rule.ID, &rule.GuildID, &rule.Type, &rule.Enabled, &rule.Config,
			&rule.Action, &rule.ActionDurationSeconds, &rule.CreatedAt, &rule.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

func (r *AutomodRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM automod_rules WHERE id = $1`, id)
	return err
}

// CheckMessage checks a message against all enabled rules for a guild.
// Returns the rule that was violated, or nil if the message is OK.
func (r *AutomodRepository) CheckMessage(ctx context.Context, guildID, content, userID string) (*AutomodRule, string, error) {
	rules, err := r.ListByGuild(ctx, guildID)
	if err != nil {
		return nil, "", err
	}

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}

		switch rule.Type {
		case "blocked_words":
			var cfg struct {
				Words []string `json:"words"`
			}
			json.Unmarshal(rule.Config, &cfg)
			contentLower := fmt.Sprintf(" %s ", lower(content))
			for _, word := range cfg.Words {
				if containsWord(contentLower, lower(word)) {
					return &rule, fmt.Sprintf("blocked word: %s", word), nil
				}
			}

		case "anti_links":
			var cfg struct {
				AllowedDomains []string `json:"allowedDomains"`
			}
			json.Unmarshal(rule.Config, &cfg)
			if containsLink(content) && !isAllowedLink(content, cfg.AllowedDomains) {
				return &rule, "links are not allowed", nil
			}

		case "anti_caps":
			var cfg struct {
				MaxPercent int `json:"maxPercent"`
				MinLength  int `json:"minLength"`
			}
			json.Unmarshal(rule.Config, &cfg)
			if cfg.MaxPercent == 0 {
				cfg.MaxPercent = 70
			}
			if cfg.MinLength == 0 {
				cfg.MinLength = 10
			}
			if len(content) >= cfg.MinLength && capsPercent(content) > cfg.MaxPercent {
				return &rule, "too many capital letters", nil
			}
		}
	}

	return nil, "", nil
}

func lower(s string) string {
	b := make([]byte, len(s))
	for i := range s {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		} else {
			b[i] = c
		}
	}
	return string(b)
}

func containsWord(text, word string) bool {
	return len(word) > 0 && len(text) > 0 && (fmt.Sprintf(" %s ", text) != text) &&
		(len(text) >= len(word)) && (indexOf(text, word) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func containsLink(s string) bool {
	return indexOf(lower(s), "http://") >= 0 || indexOf(lower(s), "https://") >= 0
}

func isAllowedLink(s string, allowed []string) bool {
	sl := lower(s)
	for _, d := range allowed {
		if indexOf(sl, lower(d)) >= 0 {
			return true
		}
	}
	return false
}

func capsPercent(s string) int {
	if len(s) == 0 {
		return 0
	}
	caps := 0
	letters := 0
	for _, c := range s {
		if c >= 'A' && c <= 'z' {
			letters++
			if c >= 'A' && c <= 'Z' {
				caps++
			}
		}
	}
	if letters == 0 {
		return 0
	}
	return caps * 100 / letters
}
