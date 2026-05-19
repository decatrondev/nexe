package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
	"github.com/decatrondev/nexe/services/gateway/internal/service"
)

type GDPRHandler struct {
	db           *sql.DB
	users        *repository.UserRepository
	guildsURL    string
	messagingURL string
}

func NewGDPRHandler(db *sql.DB, users *repository.UserRepository, guildsURL, messagingURL string) *GDPRHandler {
	return &GDPRHandler{db: db, users: users, guildsURL: guildsURL, messagingURL: messagingURL}
}

// ScheduleAccountDeletion marks an account for deletion after 14 days.
func (h *GDPRHandler) ScheduleAccountDeletion(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing claims")
		return
	}
	userID := claims.Subject

	// Check if user owns any guilds — must transfer ownership first
	ownedGuilds, err := h.getUserOwnedGuilds(r.Context(), userID)
	if err == nil && len(ownedGuilds) > 0 {
		names := make([]string, len(ownedGuilds))
		for i, g := range ownedGuilds {
			names[i] = g["name"]
		}
		writeError(w, http.StatusConflict, "OWNS_GUILDS",
			fmt.Sprintf("Transfer or delete these servers before deleting your account: %s", strings.Join(names, ", ")))
		return
	}

	deleteAfter := time.Now().Add(14 * 24 * time.Hour)

	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO scheduled_deletions (user_id, reason, delete_after)
		VALUES ($1, 'user_request', $2)
		ON CONFLICT (user_id) DO UPDATE SET
			cancelled = false,
			scheduled_at = NOW(),
			delete_after = $2`,
		userID, deleteAfter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	// Disable the account immediately (can't login)
	h.db.ExecContext(r.Context(), `UPDATE users SET disabled = true, updated_at = NOW() WHERE id = $1`, userID)

	// Kill all sessions
	h.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE user_id = $1`, userID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "scheduled",
		"deleteAfter": deleteAfter.Format(time.RFC3339),
		"message":     "Your account is scheduled for deletion. You have 14 days to restore it by logging in.",
	})
}

// RestoreAccount cancels a scheduled deletion — user must re-login.
func (h *GDPRHandler) RestoreAccount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "email and password required")
		return
	}

	// Find user by email (even disabled ones)
	var userID string
	var passwordHash string
	err := h.db.QueryRowContext(r.Context(),
		`SELECT id, password_hash FROM users WHERE email = $1 AND disabled = true`, body.Email,
	).Scan(&userID, &passwordHash)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "no pending deletion for this email")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	// Verify password
	if !service.CheckPasswordHash(body.Password, passwordHash) {
		writeError(w, http.StatusUnauthorized, "INVALID_PASSWORD", "incorrect password")
		return
	}

	// Cancel deletion
	_, err = h.db.ExecContext(r.Context(),
		`UPDATE scheduled_deletions SET cancelled = true WHERE user_id = $1`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	// Re-enable account
	h.db.ExecContext(r.Context(), `UPDATE users SET disabled = false, updated_at = NOW() WHERE id = $1`, userID)

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "restored",
		"message": "Your account has been restored. You can log in normally.",
	})
}

// GetDeletionStatus returns the deletion status for the current user.
func (h *GDPRHandler) GetDeletionStatus(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "")
		return
	}

	var deleteAfter time.Time
	var cancelled bool
	err := h.db.QueryRowContext(r.Context(),
		`SELECT delete_after, cancelled FROM scheduled_deletions WHERE user_id = $1`, claims.Subject,
	).Scan(&deleteAfter, &cancelled)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusOK, map[string]interface{}{"scheduled": false})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"scheduled":   !cancelled,
		"deleteAfter": deleteAfter.Format(time.RFC3339),
		"cancelled":   cancelled,
	})
}

// ExportUserData generates a JSON export of all user data.
func (h *GDPRHandler) ExportUserData(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "")
		return
	}
	userID := claims.Subject

	export := map[string]interface{}{}

	// 1. User account
	user, err := h.users.GetByID(r.Context(), userID)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}
	export["account"] = map[string]interface{}{
		"id":            user.ID,
		"username":      user.Username,
		"email":         user.Email,
		"emailVerified": user.EmailVerified,
		"twitchId":      user.TwitchID,
		"twitchLogin":   user.TwitchLogin,
		"status":        user.Status,
		"tier":          user.Tier,
		"createdAt":     user.CreatedAt,
	}

	// 2. Profile
	var profile map[string]interface{}
	row := h.db.QueryRowContext(r.Context(), `
		SELECT display_name, bio, avatar_url, banner_url, accent_color, social_links, level, total_xp, visibility
		FROM profiles WHERE user_id = $1`, userID)
	var displayName, bio, avatarUrl, bannerUrl, accentColor, visibility sql.NullString
	var socialLinks sql.NullString
	var level, totalXp sql.NullInt64
	if err := row.Scan(&displayName, &bio, &avatarUrl, &bannerUrl, &accentColor, &socialLinks, &level, &totalXp, &visibility); err == nil {
		profile = map[string]interface{}{
			"displayName": displayName.String,
			"bio":         bio.String,
			"avatarUrl":   avatarUrl.String,
			"bannerUrl":   bannerUrl.String,
			"accentColor": accentColor.String,
			"socialLinks": socialLinks.String,
			"level":       level.Int64,
			"totalXp":     totalXp.Int64,
			"visibility":  visibility.String,
		}
	}
	export["profile"] = profile

	// 3. Sessions (sanitized)
	sessions := []map[string]interface{}{}
	sRows, _ := h.db.QueryContext(r.Context(),
		`SELECT device_name, ip_address, last_used_at, created_at FROM sessions WHERE user_id = $1`, userID)
	if sRows != nil {
		defer sRows.Close()
		for sRows.Next() {
			var dn, ip sql.NullString
			var lastUsed, created time.Time
			sRows.Scan(&dn, &ip, &lastUsed, &created)
			sessions = append(sessions, map[string]interface{}{
				"deviceName": dn.String,
				"ipAddress":  ip.String,
				"lastUsedAt": lastUsed,
				"createdAt":  created,
			})
		}
	}
	export["sessions"] = sessions

	// 4. Guilds (memberships) — from guilds service
	guilds := h.fetchFromService(r.Context(), h.guildsURL+"/guilds/me", userID)
	export["guilds"] = guilds

	// 5. Relationships (friends) — from guilds service
	relationships := h.fetchFromService(r.Context(), h.guildsURL+"/relationships", userID)
	export["relationships"] = relationships

	// 6. DM channels — from guilds service
	dmChannels := h.fetchFromService(r.Context(), h.guildsURL+"/dm-channels", userID)
	export["dmChannels"] = dmChannels

	export["exportedAt"] = time.Now().Format(time.RFC3339)
	export["version"] = "1.0"

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=nexe-data-export-%s.json", userID[:8]))
	w.WriteHeader(http.StatusOK)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(export)
}

// fetchFromService calls an internal service with the user's ID header.
func (h *GDPRHandler) fetchFromService(ctx context.Context, url, userID string) interface{} {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("X-User-ID", userID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result interface{}
	json.Unmarshal(body, &result)
	return result
}

// getUserOwnedGuilds checks if the user owns any guilds.
func (h *GDPRHandler) getUserOwnedGuilds(ctx context.Context, userID string) ([]map[string]string, error) {
	url := h.guildsURL + "/guilds/me"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-User-ID", userID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var guilds []struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		OwnerID string `json:"ownerId"`
	}
	json.NewDecoder(resp.Body).Decode(&guilds)

	var owned []map[string]string
	for _, g := range guilds {
		if g.OwnerID == userID {
			owned = append(owned, map[string]string{"id": g.ID, "name": g.Name})
		}
	}
	return owned, nil
}

// ProcessScheduledDeletions runs as a background worker — checks every hour.
func (h *GDPRHandler) ProcessScheduledDeletions() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		h.processExpiredDeletions()
	}
}

func (h *GDPRHandler) processExpiredDeletions() {
	ctx := context.Background()

	rows, err := h.db.QueryContext(ctx, `
		SELECT user_id FROM scheduled_deletions
		WHERE cancelled = false AND delete_after <= NOW()`)
	if err != nil {
		slog.Error("gdpr: failed to query scheduled deletions", "error", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			continue
		}

		slog.Info("gdpr: processing account deletion", "userId", userID)

		// 1. Anonymize messages in messaging service
		h.anonymizeMessages(ctx, userID)

		// 2. Anonymize in guilds service (DMs, memberships, relationships)
		h.anonymizeGuildsData(ctx, userID)

		// 3. Delete user from gateway DB (cascades profiles, sessions, tiers, badges, etc.)
		if err := h.users.Delete(ctx, userID); err != nil {
			slog.Error("gdpr: failed to delete user", "userId", userID, "error", err)
			continue
		}

		// 4. Remove scheduled deletion record
		h.db.ExecContext(ctx, `DELETE FROM scheduled_deletions WHERE user_id = $1`, userID)

		slog.Info("gdpr: account deleted", "userId", userID)
	}
}

func (h *GDPRHandler) anonymizeMessages(ctx context.Context, userID string) {
	// Anonymize guild messages — set author to "deleted-user", keep content
	url := h.messagingURL + "/internal/anonymize/" + userID
	req, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Warn("gdpr: failed to anonymize messages", "userId", userID, "error", err)
		return
	}
	resp.Body.Close()
}

func (h *GDPRHandler) anonymizeGuildsData(ctx context.Context, userID string) {
	// Remove from all guilds, anonymize DMs, remove relationships
	url := h.guildsURL + "/internal/anonymize/" + userID
	req, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Warn("gdpr: failed to anonymize guilds data", "userId", userID, "error", err)
		return
	}
	resp.Body.Close()
}
