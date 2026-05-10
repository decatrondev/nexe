package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/decatrondev/nexe/services/voice/internal/model"
	"github.com/decatrondev/nexe/services/voice/internal/service"
)

type VoiceHandler struct {
	svc *service.VoiceService
}

func NewVoiceHandler(svc *service.VoiceService) *VoiceHandler {
	return &VoiceHandler{svc: svc}
}

func (h *VoiceHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /voice/join", h.Join)
	mux.HandleFunc("POST /voice/leave", h.Leave)
	mux.HandleFunc("PATCH /voice/state", h.UpdateState)
	mux.HandleFunc("GET /voice/state/@me", h.GetMyState)
	mux.HandleFunc("GET /voice/channel/{channelId}/participants", h.GetParticipants)
	mux.HandleFunc("GET /voice/guild/{guildId}/states", h.GetGuildStates)
}

// Join handles joining a voice channel.
func (h *VoiceHandler) Join(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	username := r.Header.Get("X-Username")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	var req model.JoinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if req.ChannelID == "" || req.GuildID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "channelId and guildId are required")
		return
	}

	resp, err := h.svc.JoinChannel(r.Context(), userID, username, req.GuildID, req.ChannelID)
	if err != nil {
		slog.Error("failed to join voice channel", "error", err, "user", userID, "channel", req.ChannelID)
		writeError(w, http.StatusBadRequest, "join_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// Leave handles leaving the current voice channel.
func (h *VoiceHandler) Leave(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	if err := h.svc.LeaveChannel(r.Context(), userID); err != nil {
		slog.Error("failed to leave voice channel", "error", err, "user", userID)
		writeError(w, http.StatusInternalServerError, "leave_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// UpdateState handles updating mute/deafen state.
func (h *VoiceHandler) UpdateState(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	var body struct {
		SelfMute *bool `json:"selfMute"`
		SelfDeaf *bool `json:"selfDeaf"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	state, err := h.svc.UpdateVoiceState(r.Context(), userID, body.SelfMute, body.SelfDeaf)
	if err != nil {
		writeError(w, http.StatusBadRequest, "update_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, state)
}

// GetMyState returns the current user's voice state.
func (h *VoiceHandler) GetMyState(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "missing user ID")
		return
	}

	state, err := h.svc.GetUserVoiceState(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}

	writeJSON(w, http.StatusOK, state)
}

// GetParticipants returns all participants in a voice channel.
func (h *VoiceHandler) GetParticipants(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("channelId")
	guildID := r.URL.Query().Get("guildId")

	participants, err := h.svc.GetChannelParticipants(r.Context(), channelID, guildID)
	if err != nil {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}

	if participants == nil {
		participants = []model.VoiceState{}
	}
	writeJSON(w, http.StatusOK, participants)
}

// GetGuildStates returns all voice states for a guild.
func (h *VoiceHandler) GetGuildStates(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("guildId")

	states, err := h.svc.GetGuildVoiceStates(r.Context(), guildID)
	if err != nil {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}

	if states == nil {
		states = []model.VoiceState{}
	}
	writeJSON(w, http.StatusOK, states)
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code, "message": message})
}
