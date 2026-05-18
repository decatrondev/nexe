package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/decatrondev/nexe/services/messaging/internal/model"
	"github.com/decatrondev/nexe/services/messaging/internal/repository"
	"github.com/decatrondev/nexe/services/messaging/internal/service"
)

type PollHandler struct {
	polls *repository.PollRepository
	svc   *service.MessageService
}

func NewPollHandler(polls *repository.PollRepository, svc *service.MessageService) *PollHandler {
	return &PollHandler{polls: polls, svc: svc}
}

func (h *PollHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /channels/{channelId}/polls", h.CreatePoll)
	mux.HandleFunc("GET /polls/{id}", h.GetPoll)
	mux.HandleFunc("PUT /polls/{id}/vote/{optionId}", h.Vote)
	mux.HandleFunc("DELETE /polls/{id}/vote/{optionId}", h.Unvote)
	mux.HandleFunc("POST /polls/{id}/close", h.ClosePoll)
}

func (h *PollHandler) CreatePoll(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	channelID := r.PathValue("channelId")

	var body struct {
		Question      string   `json:"question"`
		Options       []string `json:"options"`
		AllowMultiple bool     `json:"allowMultiple"`
		Anonymous     bool     `json:"anonymous"`
		ExpiresIn     *int     `json:"expiresIn"` // seconds
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}

	if body.Question == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "question is required")
		return
	}
	if len(body.Options) < 2 || len(body.Options) > 10 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "2-10 options required")
		return
	}

	// Create the message first (type = "poll")
	msg, err := h.svc.SendMessage(r.Context(), channelID, userID, "📊 "+body.Question, nil)
	if err != nil {
		classifyError(w, err)
		return
	}

	var expiresAt *time.Time
	if body.ExpiresIn != nil && *body.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(*body.ExpiresIn) * time.Second)
		expiresAt = &t
	}

	poll := &model.Poll{
		ChannelID:     channelID,
		MessageID:     msg.ID,
		Question:      body.Question,
		AllowMultiple: body.AllowMultiple,
		Anonymous:     body.Anonymous,
		ExpiresAt:     expiresAt,
	}

	for _, opt := range body.Options {
		poll.Options = append(poll.Options, model.PollOption{Text: opt})
	}

	if err := h.polls.Create(r.Context(), poll); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	// Publish event
	h.svc.PublishChannelEvent(r.Context(), channelID, "POLL_CREATE", map[string]interface{}{
		"poll":      poll,
		"messageId": msg.ID,
	})

	writeJSON(w, http.StatusCreated, poll)
}

func (h *PollHandler) GetPoll(w http.ResponseWriter, r *http.Request) {
	pollID := r.PathValue("id")

	// Get poll via message
	poll, err := h.polls.GetByMessage(r.Context(), pollID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	if poll == nil {
		// Try by poll ID directly
		writeError(w, http.StatusNotFound, "NOT_FOUND", "poll not found")
		return
	}

	writeJSON(w, http.StatusOK, poll)
}

func (h *PollHandler) Vote(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	pollID := r.PathValue("id")
	optionID := r.PathValue("optionId")

	// Verify option belongs to poll
	actualPollID, err := h.polls.GetOptionPollID(r.Context(), optionID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "option not found")
		return
	}
	if actualPollID != pollID {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "option does not belong to this poll")
		return
	}

	// Remove existing votes (single-choice polls replace vote, multi-choice toggle)
	if err := h.polls.RemoveAllVotes(r.Context(), pollID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	if err := h.polls.Vote(r.Context(), optionID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	// Get channel for event
	channelID, _, err := h.polls.GetPollOwner(r.Context(), pollID)
	if err == nil {
		h.svc.PublishChannelEvent(r.Context(), channelID, "POLL_VOTE", map[string]interface{}{
			"pollId":   pollID,
			"optionId": optionID,
			"userId":   userID,
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "voted"})
}

func (h *PollHandler) Unvote(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	optionID := r.PathValue("optionId")

	if err := h.polls.Unvote(r.Context(), optionID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "unvoted"})
}

func (h *PollHandler) ClosePoll(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	pollID := r.PathValue("id")

	// Only the message author can close the poll
	channelID, authorID, err := h.polls.GetPollOwner(r.Context(), pollID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "poll not found")
		return
	}
	if authorID != userID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only the poll creator can close it")
		return
	}

	if err := h.polls.Close(r.Context(), pollID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	h.svc.PublishChannelEvent(r.Context(), channelID, "POLL_CLOSE", map[string]interface{}{
		"pollId": pollID,
	})

	writeJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}
