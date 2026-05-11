package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/decatrondev/nexe/services/guilds/internal/repository"
	"github.com/decatrondev/nexe/services/guilds/internal/service"
)

type GuildHandler struct {
	svc       *service.GuildService
	automod   *repository.AutomodRepository
	overrides *repository.OverrideRepository
}

func NewGuildHandler(svc *service.GuildService, automod *repository.AutomodRepository, overrides *repository.OverrideRepository) *GuildHandler {
	return &GuildHandler{svc: svc, automod: automod, overrides: overrides}
}

func (h *GuildHandler) RegisterRoutes(mux *http.ServeMux) {
	// Guilds
	mux.HandleFunc("POST /guilds", h.CreateGuild)
	mux.HandleFunc("GET /guilds/me", h.ListMyGuilds)
	mux.HandleFunc("GET /guilds/{id}", h.GetGuild)
	mux.HandleFunc("PATCH /guilds/{id}", h.UpdateGuild)
	mux.HandleFunc("DELETE /guilds/{id}", h.DeleteGuild)

	// Channels
	mux.HandleFunc("POST /guilds/{id}/channels", h.CreateChannel)
	mux.HandleFunc("GET /guilds/{id}/channels", h.ListChannels)
	mux.HandleFunc("PATCH /channels/{id}", h.UpdateChannel)
	mux.HandleFunc("DELETE /channels/{id}", h.DeleteChannel)

	// Categories
	mux.HandleFunc("POST /guilds/{id}/categories", h.CreateCategory)
	mux.HandleFunc("GET /guilds/{id}/categories", h.ListCategories)

	// Roles
	mux.HandleFunc("POST /guilds/{id}/roles", h.CreateRole)
	mux.HandleFunc("GET /guilds/{id}/roles", h.ListRoles)
	mux.HandleFunc("PATCH /roles/{id}", h.UpdateRole)
	mux.HandleFunc("DELETE /roles/{id}", h.DeleteRole)
	mux.HandleFunc("PUT /guilds/{id}/members/{uid}/roles/{rid}", h.AssignRole)
	mux.HandleFunc("DELETE /guilds/{id}/members/{uid}/roles/{rid}", h.RemoveRole)

	// Members
	mux.HandleFunc("POST /guilds/{id}/join", h.JoinGuild)
	mux.HandleFunc("DELETE /guilds/{id}/members/@me", h.LeaveGuild)
	mux.HandleFunc("GET /guilds/{id}/members", h.ListMembers)
	mux.HandleFunc("DELETE /guilds/{id}/members/{uid}", h.KickMember)

	// Invites
	mux.HandleFunc("POST /guilds/{id}/invites", h.CreateInvite)
	mux.HandleFunc("POST /invites/{code}/use", h.UseInvite)
	mux.HandleFunc("GET /guilds/{id}/invites", h.ListInvites)

	// Twitch Integration
	mux.HandleFunc("POST /guilds/{id}/twitch/enable", h.EnableTwitchIntegration)
	mux.HandleFunc("POST /guilds/{id}/twitch/disable", h.DisableTwitchIntegration)
	mux.HandleFunc("PUT /guilds/{id}/members/{uid}/auto-roles/{rid}", h.AssignAutoRole)
	mux.HandleFunc("DELETE /guilds/{id}/members/{uid}/auto-roles/{rid}", h.RemoveAutoRole)

	// Channel overrides
	mux.HandleFunc("GET /channels/{id}/overrides", h.ListChannelOverrides)
	mux.HandleFunc("PUT /channels/{id}/overrides", h.UpsertChannelOverride)
	mux.HandleFunc("DELETE /overrides/{id}", h.DeleteChannelOverride)

	// Automod
	mux.HandleFunc("GET /guilds/{id}/automod", h.ListAutomodRules)
	mux.HandleFunc("POST /guilds/{id}/automod", h.CreateAutomodRule)
	mux.HandleFunc("PATCH /automod/{id}", h.UpdateAutomodRule)
	mux.HandleFunc("DELETE /automod/{id}", h.DeleteAutomodRule)
	mux.HandleFunc("POST /guilds/{id}/automod/check", h.CheckAutomod)

	// Bridge
	mux.HandleFunc("POST /guilds/{id}/bridge", h.SetBridgeChannel)
	mux.HandleFunc("DELETE /guilds/{id}/bridge", h.ClearBridgeChannel)

	// Moderation
	mux.HandleFunc("POST /guilds/{id}/bans", h.BanMember)
	mux.HandleFunc("DELETE /guilds/{id}/bans/{uid}", h.UnbanMember)
	mux.HandleFunc("GET /guilds/{id}/bans", h.ListBans)
	mux.HandleFunc("POST /guilds/{id}/members/{uid}/timeout", h.TimeoutMember)
	mux.HandleFunc("POST /guilds/{id}/members/{uid}/warn", h.WarnMember)
	mux.HandleFunc("GET /guilds/{id}/audit-log", h.ListModLogs)
}

func getUserID(r *http.Request) string {
	return r.Header.Get("X-User-ID")
}

func requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid := getUserID(r)
	if uid == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user ID")
		return "", false
	}
	return uid, true
}

func classifyError(w http.ResponseWriter, err error) {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "not found"):
		writeError(w, http.StatusNotFound, "NOT_FOUND", msg)
	case strings.Contains(msg, "permission"),
		strings.Contains(msg, "not a member"),
		strings.Contains(msg, "owner"),
		strings.Contains(msg, "banned"):
		writeError(w, http.StatusForbidden, "FORBIDDEN", msg)
	default:
		writeError(w, http.StatusInternalServerError, "INTERNAL", msg)
	}
}

// ---------------------------------------------------------------------------
// Guild handlers
// ---------------------------------------------------------------------------

func (h *GuildHandler) CreateGuild(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		IsStreamer  bool   `json:"isStreamer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name is required")
		return
	}

	guild, err := h.svc.CreateGuild(r.Context(), body.Name, body.Description, userID, body.IsStreamer)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, guild)
}

func (h *GuildHandler) GetGuild(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	guild, err := h.svc.GetGuild(r.Context(), id)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, guild)
}

func (h *GuildHandler) UpdateGuild(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	id := r.PathValue("id")
	guild, err := h.svc.GetGuild(r.Context(), id)
	if err != nil {
		classifyError(w, err)
		return
	}

	var body struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		IconUrl     *string `json:"iconUrl"`
		BannerUrl   *string `json:"bannerUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if body.Name != nil {
		guild.Name = *body.Name
	}
	if body.Description != nil {
		guild.Description = *body.Description
	}
	if body.IconUrl != nil {
		guild.IconUrl = *body.IconUrl
	}
	if body.BannerUrl != nil {
		guild.BannerUrl = *body.BannerUrl
	}

	if err := h.svc.UpdateGuild(r.Context(), guild, userID); err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, guild)
}

func (h *GuildHandler) DeleteGuild(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if err := h.svc.DeleteGuild(r.Context(), id, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) ListMyGuilds(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guilds, err := h.svc.ListUserGuilds(r.Context(), userID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if guilds == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, guilds)
}

// ---------------------------------------------------------------------------
// Channel handlers
// ---------------------------------------------------------------------------

func (h *GuildHandler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		Name       string  `json:"name"`
		Type       string  `json:"type"`
		CategoryID *string `json:"categoryId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name is required")
		return
	}
	if body.Type == "" {
		body.Type = "text"
	}

	ch, err := h.svc.CreateChannel(r.Context(), guildID, body.Name, body.Type, body.CategoryID, userID)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ch)
}

func (h *GuildHandler) ListChannels(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	channels, err := h.svc.ListChannels(r.Context(), guildID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if channels == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, channels)
}

func (h *GuildHandler) UpdateChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")

	var body struct {
		GuildID         string  `json:"guildId"`
		Name            *string `json:"name"`
		Topic           *string `json:"topic"`
		Type            *string `json:"type"`
		CategoryID      *string `json:"categoryId"`
		Position        *int    `json:"position"`
		SlowmodeSeconds *int    `json:"slowmodeSeconds"`
		IsSubOnly       *bool   `json:"isSubOnly"`
		IsLiveChannel   *bool   `json:"isLiveChannel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	// Fetch current channel to merge partial updates
	ch, err := h.svc.GetChannel(r.Context(), channelID)
	if err != nil || ch == nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "channel not found")
		return
	}

	if body.GuildID != "" {
		ch.GuildID = body.GuildID
	}
	if body.Name != nil {
		ch.Name = *body.Name
	}
	if body.Topic != nil {
		ch.Topic = *body.Topic
	}
	if body.Type != nil {
		ch.Type = *body.Type
	}
	if body.CategoryID != nil {
		ch.CategoryID = body.CategoryID
	}
	if body.Position != nil {
		ch.Position = *body.Position
	}
	if body.SlowmodeSeconds != nil {
		ch.SlowmodeSeconds = *body.SlowmodeSeconds
	}
	if body.IsSubOnly != nil {
		ch.IsSubOnly = *body.IsSubOnly
	}
	if body.IsLiveChannel != nil {
		ch.IsLiveChannel = *body.IsLiveChannel
	}

	if err := h.svc.UpdateChannel(r.Context(), ch, userID); err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ch)
}

func (h *GuildHandler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	channelID := r.PathValue("id")
	if err := h.svc.DeleteChannel(r.Context(), channelID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Category handlers
// ---------------------------------------------------------------------------

func (h *GuildHandler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name is required")
		return
	}

	cat, err := h.svc.CreateCategory(r.Context(), guildID, body.Name, userID)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, cat)
}

func (h *GuildHandler) ListCategories(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	cats, err := h.svc.ListCategories(r.Context(), guildID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if cats == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, cats)
}

// ---------------------------------------------------------------------------
// Role handlers
// ---------------------------------------------------------------------------

func (h *GuildHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		Name        string `json:"name"`
		Permissions int64  `json:"permissions"`
		Color       string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name is required")
		return
	}

	role, err := h.svc.CreateRole(r.Context(), guildID, body.Name, body.Permissions, body.Color, userID)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, role)
}

func (h *GuildHandler) ListRoles(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	roles, err := h.svc.ListRoles(r.Context(), guildID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if roles == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

func (h *GuildHandler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	roleID := r.PathValue("id")

	var body struct {
		GuildID     string  `json:"guildId"`
		Name        *string `json:"name"`
		Color       *string `json:"color"`
		Position    *int    `json:"position"`
		Permissions *int64  `json:"permissions"`
		Mentionable *bool   `json:"mentionable"`
		Hoisted     *bool   `json:"hoisted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	// Fetch current role to merge partial updates
	role, err := h.svc.GetRole(r.Context(), roleID)
	if err != nil || role == nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "role not found")
		return
	}

	if body.GuildID != "" {
		role.GuildID = body.GuildID
	}
	if body.Name != nil {
		role.Name = *body.Name
	}
	if body.Color != nil {
		role.Color = body.Color
	}
	if body.Position != nil {
		role.Position = *body.Position
	}
	if body.Permissions != nil {
		role.Permissions = *body.Permissions
	}
	if body.Mentionable != nil {
		role.Mentionable = *body.Mentionable
	}
	if body.Hoisted != nil {
		role.Hoisted = *body.Hoisted
	}

	if err := h.svc.UpdateRole(r.Context(), role, userID); err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, role)
}

func (h *GuildHandler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	roleID := r.PathValue("id")
	if err := h.svc.DeleteRole(r.Context(), roleID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) AssignRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	targetUID := r.PathValue("uid")
	roleID := r.PathValue("rid")

	if err := h.svc.AssignRole(r.Context(), guildID, targetUID, roleID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) RemoveRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	targetUID := r.PathValue("uid")
	roleID := r.PathValue("rid")

	if err := h.svc.RemoveRole(r.Context(), guildID, targetUID, roleID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Member handlers
// ---------------------------------------------------------------------------

func (h *GuildHandler) JoinGuild(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	member, err := h.svc.JoinGuild(r.Context(), guildID, userID)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, member)
}

func (h *GuildHandler) LeaveGuild(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	if err := h.svc.LeaveGuild(r.Context(), guildID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	limit := 50
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil {
			offset = v
		}
	}

	members, err := h.svc.ListMembers(r.Context(), guildID, limit, offset)
	if err != nil {
		classifyError(w, err)
		return
	}
	if members == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (h *GuildHandler) KickMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	targetUID := r.PathValue("uid")

	var body struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if err := h.svc.KickMember(r.Context(), guildID, targetUID, userID, body.Reason); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Invite handlers
// ---------------------------------------------------------------------------

func (h *GuildHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		ChannelID string `json:"channelId"`
		MaxUses   *int   `json:"maxUses"`
		MaxAge    *int   `json:"maxAge"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	inv, err := h.svc.CreateInvite(r.Context(), guildID, body.ChannelID, userID, body.MaxUses, body.MaxAge)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

func (h *GuildHandler) UseInvite(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	code := r.PathValue("code")
	guild, err := h.svc.UseInvite(r.Context(), code, userID)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "expired") || strings.Contains(msg, "maximum") {
			writeError(w, http.StatusGone, "EXPIRED", msg)
			return
		}
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, guild)
}

func (h *GuildHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	invites, err := h.svc.ListInvites(r.Context(), guildID, userID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if invites == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, invites)
}

// ---------------------------------------------------------------------------
// Twitch Integration handlers
// ---------------------------------------------------------------------------

func (h *GuildHandler) EnableTwitchIntegration(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		TwitchID string `json:"twitchId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if strings.TrimSpace(body.TwitchID) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "twitchId is required")
		return
	}

	roles, err := h.svc.EnableTwitchIntegration(r.Context(), guildID, userID, body.TwitchID)
	if err != nil {
		classifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"roles": roles,
	})
}

func (h *GuildHandler) AssignAutoRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	targetUID := r.PathValue("uid")
	roleID := r.PathValue("rid")

	// Only allow self-assignment or system calls
	if userID != targetUID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "auto-roles can only be self-assigned via sync")
		return
	}

	if err := h.svc.AssignAutoRole(r.Context(), guildID, targetUID, roleID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) RemoveAutoRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	targetUID := r.PathValue("uid")
	roleID := r.PathValue("rid")

	if userID != targetUID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "auto-roles can only be self-removed via sync")
		return
	}

	if err := h.svc.RemoveAutoRole(r.Context(), guildID, targetUID, roleID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) DisableTwitchIntegration(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	if err := h.svc.DisableTwitchIntegration(r.Context(), guildID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Moderation handlers
// ---------------------------------------------------------------------------

func (h *GuildHandler) BanMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		TargetID string `json:"targetId"`
		Reason   string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if body.TargetID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "targetId is required")
		return
	}

	if err := h.svc.BanMember(r.Context(), guildID, body.TargetID, userID, body.Reason); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) UnbanMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	targetUID := r.PathValue("uid")

	if err := h.svc.UnbanMember(r.Context(), guildID, targetUID, userID); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) ListBans(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	bans, err := h.svc.ListBans(r.Context(), guildID)
	if err != nil {
		classifyError(w, err)
		return
	}
	if bans == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, bans)
}

func (h *GuildHandler) TimeoutMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	targetUID := r.PathValue("uid")

	var body struct {
		Duration int    `json:"duration"`
		Reason   string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if body.Duration <= 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "duration must be positive (seconds)")
		return
	}

	dur := time.Duration(body.Duration) * time.Second
	if err := h.svc.TimeoutMember(r.Context(), guildID, targetUID, userID, dur, body.Reason); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) WarnMember(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")
	targetUID := r.PathValue("uid")

	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if strings.TrimSpace(body.Reason) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "reason is required")
		return
	}

	if err := h.svc.WarnMember(r.Context(), guildID, targetUID, userID, body.Reason); err != nil {
		classifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) ListModLogs(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}
	logs, err := h.svc.ListModLogs(r.Context(), guildID, limit)
	if err != nil {
		classifyError(w, err)
		return
	}
	if logs == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (h *GuildHandler) SetBridgeChannel(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	userID := r.Header.Get("X-User-ID")

	var body struct {
		ChannelID string `json:"channelId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ChannelID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "channelId is required")
		return
	}

	if err := h.svc.SetBridgeChannel(r.Context(), guildID, body.ChannelID, userID); err != nil {
		writeError(w, http.StatusBadRequest, "bridge_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "bridgeChannelId": body.ChannelID})
}

func (h *GuildHandler) ClearBridgeChannel(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	userID := r.Header.Get("X-User-ID")

	if err := h.svc.ClearBridgeChannel(r.Context(), guildID, userID); err != nil {
		writeError(w, http.StatusBadRequest, "bridge_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ---- Channel Overrides ----

func (h *GuildHandler) ListChannelOverrides(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("id")
	overrides, err := h.overrides.ListByChannel(r.Context(), channelID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "override_error", err.Error())
		return
	}
	if overrides == nil {
		overrides = []repository.ChannelOverride{}
	}
	writeJSON(w, http.StatusOK, overrides)
}

func (h *GuildHandler) UpsertChannelOverride(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("id")
	var o repository.ChannelOverride
	if err := json.NewDecoder(r.Body).Decode(&o); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}
	o.ChannelID = channelID
	if o.TargetType != "role" && o.TargetType != "user" {
		writeError(w, http.StatusBadRequest, "invalid_type", "targetType must be 'role' or 'user'")
		return
	}
	if err := h.overrides.Upsert(r.Context(), &o); err != nil {
		writeError(w, http.StatusInternalServerError, "override_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (h *GuildHandler) DeleteChannelOverride(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.overrides.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "override_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- Automod ----

func (h *GuildHandler) ListAutomodRules(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	rules, err := h.automod.ListByGuild(r.Context(), guildID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "automod_error", err.Error())
		return
	}
	if rules == nil {
		rules = []repository.AutomodRule{}
	}
	writeJSON(w, http.StatusOK, rules)
}

func (h *GuildHandler) CreateAutomodRule(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	var rule repository.AutomodRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}
	rule.GuildID = guildID
	if rule.Action == "" {
		rule.Action = "block"
	}
	if err := h.automod.Create(r.Context(), &rule); err != nil {
		writeError(w, http.StatusInternalServerError, "automod_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, rule)
}

func (h *GuildHandler) UpdateAutomodRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Enabled *bool            `json:"enabled"`
		Config  *json.RawMessage `json:"config"`
		Action  *string          `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}
	if err := h.automod.Update(r.Context(), id, body.Enabled, body.Config, body.Action); err != nil {
		writeError(w, http.StatusInternalServerError, "automod_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) DeleteAutomodRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.automod.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "automod_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuildHandler) CheckAutomod(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")
	var body struct {
		Content string `json:"content"`
		UserID  string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}
	rule, reason, err := h.automod.CheckMessage(r.Context(), guildID, body.Content, body.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "automod_error", err.Error())
		return
	}
	if rule != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"blocked": true,
			"reason":  reason,
			"rule":    rule,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"blocked": false})
}
