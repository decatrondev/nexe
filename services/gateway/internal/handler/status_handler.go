package handler

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

type StatusHandler struct {
	db       *sql.DB
	services map[string]string // name → health URL
}

func NewStatusHandler(db *sql.DB, guildsURL, messagingURL, presenceURL, voiceURL, notificationsURL string) *StatusHandler {
	return &StatusHandler{
		db: db,
		services: map[string]string{
			"gateway":       "http://localhost:8090/health",
			"guilds":        guildsURL + "/health",
			"messaging":     messagingURL + "/health",
			"presence":      presenceURL + "/health",
			"voice":         voiceURL + "/health",
			"notifications": notificationsURL + "/health",
		},
	}
}

type ServiceStatus struct {
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	LatencyMs int     `json:"latencyMs"`
	Uptime24h float64 `json:"uptime24h"`
	Uptime7d  float64 `json:"uptime7d"`
	Uptime30d float64 `json:"uptime30d"`
}

type Incident struct {
	ID               string     `json:"id"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	Status           string     `json:"status"`
	Severity         string     `json:"severity"`
	AffectedServices []string   `json:"affectedServices"`
	CreatedAt        time.Time  `json:"createdAt"`
	ResolvedAt       *time.Time `json:"resolvedAt,omitempty"`
}

type StatusPageData struct {
	Services   []ServiceStatus `json:"services"`
	Incidents  []Incident      `json:"incidents"`
	OverallUp  bool            `json:"overallUp"`
	CheckedAt  time.Time       `json:"checkedAt"`
}

// GetStatus returns the current status of all services.
func (h *StatusHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Current status per service (latest check)
	var services []ServiceStatus
	for name := range h.services {
		ss := ServiceStatus{Name: name}

		// Latest check
		h.db.QueryRowContext(ctx,
			`SELECT status, latency_ms FROM status_checks WHERE service = $1 ORDER BY checked_at DESC LIMIT 1`, name,
		).Scan(&ss.Status, &ss.LatencyMs)
		if ss.Status == "" {
			ss.Status = "unknown"
		}

		// Uptime calculations
		ss.Uptime24h = h.calcUptime(ctx, name, 24*time.Hour)
		ss.Uptime7d = h.calcUptime(ctx, name, 7*24*time.Hour)
		ss.Uptime30d = h.calcUptime(ctx, name, 30*24*time.Hour)

		services = append(services, ss)
	}

	// Sort: gateway first, then alphabetical
	sortServices(services)

	// Recent incidents (last 30 days, max 10)
	incidents := h.getRecentIncidents(ctx)

	// Overall status
	allUp := true
	for _, s := range services {
		if s.Status != "up" {
			allUp = false
			break
		}
	}

	writeJSON(w, http.StatusOK, StatusPageData{
		Services:  services,
		Incidents: incidents,
		OverallUp: allUp,
		CheckedAt: time.Now(),
	})
}

// GetHistory returns latency history for a service.
func (h *StatusHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	service := r.URL.Query().Get("service")
	if service == "" {
		service = "gateway"
	}
	hours := 24
	if h := r.URL.Query().Get("hours"); h != "" {
		if v, err := fmt.Sscanf(h, "%d", &hours); v == 1 && err == nil && hours > 0 && hours <= 2160 {
			// valid
		} else {
			hours = 24
		}
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT status, latency_ms, checked_at FROM status_checks
		WHERE service = $1 AND checked_at > NOW() - make_interval(hours := $2)
		ORDER BY checked_at ASC`, service, hours)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	defer rows.Close()

	type Point struct {
		Status    string    `json:"status"`
		LatencyMs int       `json:"latencyMs"`
		Time      time.Time `json:"time"`
	}
	var points []Point
	for rows.Next() {
		var p Point
		rows.Scan(&p.Status, &p.LatencyMs, &p.Time)
		points = append(points, p)
	}
	writeJSON(w, http.StatusOK, points)
}

func (h *StatusHandler) calcUptime(ctx context.Context, service string, duration time.Duration) float64 {
	var total, up int
	h.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'up')
		FROM status_checks WHERE service = $1 AND checked_at > NOW() - $2::interval`,
		service, fmt.Sprintf("%d seconds", int(duration.Seconds())),
	).Scan(&total, &up)
	if total == 0 {
		return 100.0
	}
	return float64(up) / float64(total) * 100.0
}

func (h *StatusHandler) getRecentIncidents(ctx context.Context) []Incident {
	rows, err := h.db.QueryContext(ctx, `
		SELECT id, title, description, status, severity, affected_services, created_at, resolved_at
		FROM status_incidents WHERE created_at > NOW() - INTERVAL '30 days'
		ORDER BY created_at DESC LIMIT 10`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var incidents []Incident
	for rows.Next() {
		var inc Incident
		var affected []byte
		rows.Scan(&inc.ID, &inc.Title, &inc.Description, &inc.Status, &inc.Severity, &affected, &inc.CreatedAt, &inc.ResolvedAt)
		incidents = append(incidents, inc)
	}
	return incidents
}

func sortServices(s []ServiceStatus) {
	order := map[string]int{"gateway": 0, "guilds": 1, "messaging": 2, "presence": 3, "voice": 4, "notifications": 5}
	for i := 0; i < len(s); i++ {
		for j := i + 1; j < len(s); j++ {
			if order[s[i].Name] > order[s[j].Name] {
				s[i], s[j] = s[j], s[i]
			}
		}
	}
}

// StartHealthChecker runs every 60 seconds and pings all services.
func (h *StatusHandler) StartHealthChecker() {
	// Run immediately on start
	h.runChecks()

	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		h.runChecks()
	}
}

func (h *StatusHandler) runChecks() {
	client := &http.Client{Timeout: 5 * time.Second}
	ctx := context.Background()

	for name, url := range h.services {
		start := time.Now()
		status := "up"
		latency := 0

		resp, err := client.Get(url)
		latency = int(time.Since(start).Milliseconds())

		if err != nil {
			status = "down"
			latency = 5000
		} else {
			resp.Body.Close()
			if resp.StatusCode != 200 {
				status = "degraded"
			}
		}

		_, err = h.db.ExecContext(ctx,
			`INSERT INTO status_checks (service, status, latency_ms) VALUES ($1, $2, $3)`,
			name, status, latency)
		if err != nil {
			slog.Warn("status check insert failed", "service", name, "error", err)
		}
	}

	// Cleanup old records (keep 30 days)
	h.db.ExecContext(ctx, `SELECT cleanup_old_status_checks()`)
}
