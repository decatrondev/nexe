package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type UpdateHandler struct {
	rdb         *redis.Client
	githubOwner string
	githubRepo  string
}

func NewUpdateHandler(rdb *redis.Client, owner, repo string) *UpdateHandler {
	return &UpdateHandler{rdb: rdb, githubOwner: owner, githubRepo: repo}
}

type updateCheckResponse struct {
	UpdateAvailable bool   `json:"update_available"`
	Version         string `json:"version"`
	CurrentVersion  string `json:"current_version"`
	DownloadURL     string `json:"download_url,omitempty"`
	Size            int64  `json:"size,omitempty"`
	Notes           string `json:"notes,omitempty"`
}

type githubRelease struct {
	TagName string        `json:"tag_name"`
	Body    string        `json:"body"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// Check handles GET /update/check?version=0.0.20&platform=windows-x86_64
func (h *UpdateHandler) Check(w http.ResponseWriter, r *http.Request) {
	currentVersion := r.URL.Query().Get("version")
	platform := r.URL.Query().Get("platform")

	if currentVersion == "" || platform == "" {
		writeError(w, http.StatusBadRequest, "missing_params", "version and platform are required")
		return
	}

	release, err := h.getLatestRelease(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, "github_error", "failed to check for updates")
		return
	}

	latestVersion := strings.TrimPrefix(release.TagName, "v")

	if !isNewer(latestVersion, currentVersion) {
		writeJSON(w, http.StatusOK, updateCheckResponse{
			UpdateAvailable: false,
			Version:         latestVersion,
			CurrentVersion:  currentVersion,
		})
		return
	}

	// Find the zip asset matching the platform
	// Expected naming: nexe-v0.0.21-windows-x86_64.zip
	var asset *githubAsset
	for i, a := range release.Assets {
		if strings.HasSuffix(a.Name, ".zip") && strings.Contains(a.Name, platform) {
			asset = &release.Assets[i]
			break
		}
	}

	if asset == nil {
		writeJSON(w, http.StatusOK, updateCheckResponse{
			UpdateAvailable: false,
			Version:         latestVersion,
			CurrentVersion:  currentVersion,
		})
		return
	}

	writeJSON(w, http.StatusOK, updateCheckResponse{
		UpdateAvailable: true,
		Version:         latestVersion,
		CurrentVersion:  currentVersion,
		DownloadURL:     asset.BrowserDownloadURL,
		Size:            asset.Size,
		Notes:           release.Body,
	})
}

const redisCacheKey = "nexe:update:latest_release"
const cacheTTL = 5 * time.Minute

func (h *UpdateHandler) getLatestRelease(ctx context.Context) (*githubRelease, error) {
	// Try Redis cache first
	cached, err := h.rdb.Get(ctx, redisCacheKey).Result()
	if err == nil && cached != "" {
		var release githubRelease
		if json.Unmarshal([]byte(cached), &release) == nil {
			return &release, nil
		}
	}

	// Fetch from GitHub API
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", h.githubOwner, h.githubRepo)

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Nexe-UpdateCheck/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("github returned %d: %s", resp.StatusCode, string(body))
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("decode github release: %w", err)
	}

	// Cache in Redis
	if data, err := json.Marshal(release); err == nil {
		h.rdb.Set(ctx, redisCacheKey, string(data), cacheTTL)
	}

	return &release, nil
}

// isNewer compares two semver-like version strings (e.g., "0.0.21" > "0.0.20").
func isNewer(latest, current string) bool {
	lParts := strings.Split(latest, ".")
	cParts := strings.Split(current, ".")

	for i := 0; i < len(lParts) && i < len(cParts); i++ {
		l, c := 0, 0
		fmt.Sscanf(lParts[i], "%d", &l)
		fmt.Sscanf(cParts[i], "%d", &c)
		if l > c {
			return true
		}
		if l < c {
			return false
		}
	}
	return len(lParts) > len(cParts)
}
