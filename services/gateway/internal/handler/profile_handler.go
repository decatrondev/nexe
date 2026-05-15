package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
)

type ProfileHandler struct {
	profiles *repository.ProfileRepository
}

func NewProfileHandler(profiles *repository.ProfileRepository) *ProfileHandler {
	return &ProfileHandler{profiles: profiles}
}

func (h *ProfileHandler) GetProfile(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	if userID == "@me" {
		claims := middleware.GetClaims(r)
		if claims == nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
			return
		}
		userID = claims.Subject
	}

	profile, err := h.profiles.GetByUserID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "profile_error", err.Error())
		return
	}
	if profile == nil {
		writeError(w, http.StatusNotFound, "not_found", "profile not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": profile})
}

func (h *ProfileHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	// Only allow these fields
	allowed := map[string]bool{
		"displayName": true, "bio": true, "avatarUrl": true, "bannerUrl": true,
		"accentColor": true, "backgroundUrl": true, "layout": true,
		"socialLinks": true, "featuredClips": true, "streamSchedule": true,
		"visibility": true,
	}

	fields := make(map[string]interface{})
	for k, v := range body {
		if allowed[k] {
			fields[k] = v
		}
	}

	if len(fields) == 0 {
		writeError(w, http.StatusBadRequest, "no_fields", "no valid fields to update")
		return
	}

	if err := h.profiles.Update(r.Context(), claims.Subject, fields); err != nil {
		writeError(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}

	// Log activity
	go h.profiles.LogActivity(context.Background(), claims.Subject, "profile_update", map[string]interface{}{
		"fields": func() []string { keys := make([]string, 0, len(fields)); for k := range fields { keys = append(keys, k) }; return keys }(),
	})

	profile, _ := h.profiles.GetByUserID(r.Context(), claims.Subject)
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": profile})
}

func (h *ProfileHandler) GetBadges(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	if userID == "@me" {
		claims := middleware.GetClaims(r)
		if claims == nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
			return
		}
		userID = claims.Subject
	}

	badges, err := h.profiles.GetBadges(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "badges_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": badges})
}

func (h *ProfileHandler) GetActivity(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	if userID == "@me" {
		claims := middleware.GetClaims(r)
		if claims == nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
			return
		}
		userID = claims.Subject
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}

	activity, err := h.profiles.GetActivity(r.Context(), userID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "activity_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": activity})
}

func (h *ProfileHandler) LogActivityEndpoint(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string                 `json:"userId"`
		Type   string                 `json:"type"`
		Data   map[string]interface{} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" || body.Type == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "userId and type required")
		return
	}
	if body.Data == nil {
		body.Data = map[string]interface{}{}
	}
	if err := h.profiles.LogActivity(r.Context(), body.UserID, body.Type, body.Data); err != nil {
		writeError(w, http.StatusInternalServerError, "activity_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ProfileHandler) AddXP(w http.ResponseWriter, r *http.Request) {
	// Internal endpoint — called by other services
	var body struct {
		UserID string `json:"userId"`
		XP     int64  `json:"xp"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserID == "" || body.XP <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_body", "userId and xp > 0 required")
		return
	}

	totalXP, level, err := h.profiles.AddXP(r.Context(), body.UserID, body.XP)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "xp_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"totalXp": totalXP,
			"level":   level,
		},
	})
}
