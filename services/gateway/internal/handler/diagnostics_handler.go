package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	restartDiagKey   = "nexe:diag:restart"
	restartDiagKeep  = 50
	restartDiagTTL   = 30 * 24 * time.Hour
	restartDiagBody  = 64 << 10
	restartDiagField = 32 << 10
)

// DiagnosticsHandler receives short reports from the desktop app about what happened after an
// in-app update restart, so failures on machines we cannot reach can be read server side.
type DiagnosticsHandler struct {
	rdb *redis.Client
}

func NewDiagnosticsHandler(rdb *redis.Client) *DiagnosticsHandler {
	return &DiagnosticsHandler{rdb: rdb}
}

type restartReport struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	Log     string `json:"log"`
}

type storedRestartReport struct {
	restartReport
	ReceivedAt time.Time `json:"received_at"`
}

// RestartReport handles POST /diagnostics/restart (public, rate limited, size limited).
// Reports are kept in a capped Redis list: LRANGE nexe:diag:restart 0 -1.
func (h *DiagnosticsHandler) RestartReport(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, restartDiagBody)

	var in restartReport
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid report")
		return
	}
	if len(in.Version) > 32 || len(in.Commit) > 80 || len(in.Log) > restartDiagField {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "report too large")
		return
	}

	data, err := json.Marshal(storedRestartReport{restartReport: in, ReceivedAt: time.Now().UTC()})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not store report")
		return
	}

	ctx := r.Context()
	pipe := h.rdb.Pipeline()
	pipe.LPush(ctx, restartDiagKey, data)
	pipe.LTrim(ctx, restartDiagKey, 0, restartDiagKeep-1)
	pipe.Expire(ctx, restartDiagKey, restartDiagTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		slog.Error("store restart report", "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not store report")
		return
	}

	slog.Info("desktop restart report", "version", in.Version, "commit", in.Commit, "bytes", len(in.Log))
	w.WriteHeader(http.StatusNoContent)
}
