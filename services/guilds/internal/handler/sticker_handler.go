package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

type StickerHandler struct {
	db  *sql.DB
	rdb *redis.Client
}

func NewStickerHandler(db *sql.DB, rdb *redis.Client) *StickerHandler {
	return &StickerHandler{db: db, rdb: rdb}
}

func (h *StickerHandler) RegisterRoutes(mux *http.ServeMux) {
	// Packs
	mux.HandleFunc("GET /guilds/{id}/sticker-packs", h.ListPacks)
	mux.HandleFunc("POST /guilds/{id}/sticker-packs", h.CreatePack)
	mux.HandleFunc("DELETE /sticker-packs/{id}", h.DeletePack)

	// Stickers
	mux.HandleFunc("GET /guilds/{id}/stickers", h.ListStickers)
	mux.HandleFunc("GET /sticker-packs/{id}/stickers", h.ListPackStickers)
	mux.HandleFunc("POST /sticker-packs/{id}/stickers", h.AddSticker)
	mux.HandleFunc("DELETE /stickers/{id}", h.DeleteSticker)
}

type StickerPack struct {
	ID          string    `json:"id"`
	GuildID     string    `json:"guildId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedBy   string    `json:"createdBy"`
	Count       int       `json:"count"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Sticker struct {
	ID         string    `json:"id"`
	PackID     string    `json:"packId"`
	GuildID    string    `json:"guildId"`
	Name       string    `json:"name"`
	URL        string    `json:"url"`
	Tags       []string  `json:"tags"`
	UploadedBy string    `json:"uploadedBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (h *StickerHandler) ListPacks(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT sp.id, sp.guild_id, sp.name, sp.description, sp.created_by, sp.created_at,
		       COALESCE((SELECT COUNT(*) FROM stickers WHERE pack_id = sp.id), 0)
		FROM sticker_packs sp WHERE sp.guild_id = $1 ORDER BY sp.created_at`, guildID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	defer rows.Close()

	packs := []StickerPack{}
	for rows.Next() {
		var p StickerPack
		rows.Scan(&p.ID, &p.GuildID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt, &p.Count)
		packs = append(packs, p)
	}
	writeJSON(w, http.StatusOK, packs)
}

func (h *StickerHandler) CreatePack(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	guildID := r.PathValue("id")

	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name required")
		return
	}

	// Limit: 5 packs per guild (free tier)
	var count int
	h.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM sticker_packs WHERE guild_id = $1`, guildID).Scan(&count)
	if count >= 5 {
		writeError(w, http.StatusBadRequest, "LIMIT_REACHED", "max 5 sticker packs per server (free tier)")
		return
	}

	var p StickerPack
	err := h.db.QueryRowContext(r.Context(), `
		INSERT INTO sticker_packs (guild_id, name, description, created_by)
		VALUES ($1, $2, $3, $4) RETURNING id, guild_id, name, description, created_by, created_at`,
		guildID, body.Name, body.Description, userID,
	).Scan(&p.ID, &p.GuildID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (h *StickerHandler) DeletePack(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUser(w, r)
	if !ok {
		return
	}
	packID := r.PathValue("id")
	h.db.ExecContext(r.Context(), `DELETE FROM sticker_packs WHERE id = $1`, packID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *StickerHandler) ListStickers(w http.ResponseWriter, r *http.Request) {
	guildID := r.PathValue("id")

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, pack_id, guild_id, name, url, tags, uploaded_by, created_at
		FROM stickers WHERE guild_id = $1 ORDER BY created_at`, guildID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	defer rows.Close()

	stickers := []Sticker{}
	for rows.Next() {
		var s Sticker
		rows.Scan(&s.ID, &s.PackID, &s.GuildID, &s.Name, &s.URL, pq.Array(&s.Tags), &s.UploadedBy, &s.CreatedAt)
		stickers = append(stickers, s)
	}
	writeJSON(w, http.StatusOK, stickers)
}

func (h *StickerHandler) ListPackStickers(w http.ResponseWriter, r *http.Request) {
	packID := r.PathValue("id")

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, pack_id, guild_id, name, url, tags, uploaded_by, created_at
		FROM stickers WHERE pack_id = $1 ORDER BY created_at`, packID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	defer rows.Close()

	stickers := []Sticker{}
	for rows.Next() {
		var s Sticker
		rows.Scan(&s.ID, &s.PackID, &s.GuildID, &s.Name, &s.URL, pq.Array(&s.Tags), &s.UploadedBy, &s.CreatedAt)
		stickers = append(stickers, s)
	}
	writeJSON(w, http.StatusOK, stickers)
}

func (h *StickerHandler) AddSticker(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	packID := r.PathValue("id")

	// Get guild_id from pack
	var guildID string
	err := h.db.QueryRowContext(r.Context(), `SELECT guild_id FROM sticker_packs WHERE id = $1`, packID).Scan(&guildID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "pack not found")
		return
	}

	// Limit: 30 stickers per pack
	var count int
	h.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM stickers WHERE pack_id = $1`, packID).Scan(&count)
	if count >= 30 {
		writeError(w, http.StatusBadRequest, "LIMIT_REACHED", "max 30 stickers per pack")
		return
	}

	var body struct {
		Name string   `json:"name"`
		URL  string   `json:"url"`
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" || body.URL == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name and url required")
		return
	}

	var s Sticker
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO stickers (pack_id, guild_id, name, url, tags, uploaded_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, pack_id, guild_id, name, url, tags, uploaded_by, created_at`,
		packID, guildID, body.Name, body.URL, pq.Array(body.Tags), userID,
	).Scan(&s.ID, &s.PackID, &s.GuildID, &s.Name, &s.URL, pq.Array(&s.Tags), &s.UploadedBy, &s.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, s)
}

func (h *StickerHandler) DeleteSticker(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUser(w, r)
	if !ok {
		return
	}
	stickerID := r.PathValue("id")
	h.db.ExecContext(r.Context(), `DELETE FROM stickers WHERE id = $1`, stickerID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
