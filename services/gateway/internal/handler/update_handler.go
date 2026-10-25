package handler

import (
	"context"
	"crypto/sha256"
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
	SHA256          string `json:"sha256,omitempty"`
	Size            int64  `json:"size,omitempty"`
	Notes           string `json:"notes,omitempty"`
	DebURL          string `json:"deb_url,omitempty"`
}

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Draft       bool          `json:"draft"`
	Prerelease  bool          `json:"prerelease"`
	Body        string        `json:"body"`
	PublishedAt string        `json:"published_at"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// Check handles GET /update/check?version=0.1.5&platform=windows-x86_64
// Returns portable zip URL + SHA256 for silent updates (no installer).
func (h *UpdateHandler) Check(w http.ResponseWriter, r *http.Request) {
	currentVersion := r.URL.Query().Get("version")
	platform := r.URL.Query().Get("platform")

	if currentVersion == "" || platform == "" {
		writeError(w, http.StatusBadRequest, "missing_params", "version and platform are required")
		return
	}

	release, err := h.getLatestRelease(r.Context(), platform)
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

	// Find the portable update zip for this platform
	// Naming: nexe-update-vX.Y.Z-{platform}.zip
	var asset *githubAsset
	for i, a := range release.Assets {
		if strings.HasPrefix(a.Name, "nexe-update-") && strings.Contains(a.Name, platform) && strings.HasSuffix(a.Name, ".zip") {
			asset = &release.Assets[i]
			break
		}
	}

	if asset == nil {
		// No portable update zip available
		writeJSON(w, http.StatusOK, updateCheckResponse{
			UpdateAvailable: false,
			Version:         latestVersion,
			CurrentVersion:  currentVersion,
		})
		return
	}

	// Get SHA256 hash (from .sha256 file or cached)
	sha := h.getAssetSHA256(r.Context(), asset.Name, release)

	resp := updateCheckResponse{
		UpdateAvailable: true,
		Version:         latestVersion,
		CurrentVersion:  currentVersion,
		DownloadURL:     asset.BrowserDownloadURL,
		SHA256:          sha,
		Size:            asset.Size,
		Notes:           release.Body,
	}

	// For Linux: also provide .deb URL for package-based updates
	if platform == "linux-x86_64" {
		for _, a := range release.Assets {
			if strings.HasSuffix(a.Name, ".deb") {
				resp.DebURL = a.BrowserDownloadURL
				break
			}
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// getAssetSHA256 finds the .sha256 file for an asset and returns its content.
func (h *UpdateHandler) getAssetSHA256(ctx context.Context, assetName string, release *githubRelease) string {
	shaName := assetName + ".sha256"

	// Check cache
	cacheKey := "nexe:update:sha256:" + shaName
	if cached, err := h.rdb.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
		return cached
	}

	// Find .sha256 asset
	for _, a := range release.Assets {
		if a.Name == shaName {
			sha := h.fetchSmallFile(ctx, a.BrowserDownloadURL)
			if sha != "" {
				// sha256 file format: "hash  filename" or just "hash"
				sha = strings.Fields(sha)[0]
				h.rdb.Set(ctx, cacheKey, sha, cacheTTL)
				return sha
			}
		}
	}

	return ""
}

func (h *UpdateHandler) fetchSmallFile(ctx context.Context, url string) string {
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "GET", url, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "Nexe-UpdateCheck/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return ""
	}
	defer resp.Body.Close()

	// Limit read to 1KB (sha256 is 64 chars)
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}

// computeSHA256 is unused but available for future use
func computeSHA256(data []byte) string {
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h)
}

const redisCacheKey = "nexe:update:releases"
const cacheTTL = 5 * time.Minute

// hasUpdateAsset reports whether a release already carries the portable update zip for a platform.
func hasUpdateAsset(release *githubRelease, platform string) bool {
	for _, a := range release.Assets {
		if strings.HasPrefix(a.Name, "nexe-update-") && strings.Contains(a.Name, platform) && strings.HasSuffix(a.Name, ".zip") {
			return true
		}
	}
	return false
}

// getLatestRelease returns the newest published release that already has an update zip for the
// platform. A release is created at the start of the CI run and its assets are uploaded as each
// build finishes, so the newest release alone can be empty for several minutes.
func (h *UpdateHandler) getLatestRelease(ctx context.Context, platform string) (*githubRelease, error) {
	releases, err := h.getReleases(ctx)
	if err != nil {
		return nil, err
	}

	var newest *githubRelease
	for i := range releases {
		rel := &releases[i]
		if rel.Draft || rel.Prerelease {
			continue
		}
		if newest == nil {
			newest = rel
		}
		if hasUpdateAsset(rel, platform) {
			return rel, nil
		}
	}

	if newest == nil {
		return nil, fmt.Errorf("no published releases")
	}
	return newest, nil
}

func (h *UpdateHandler) getReleases(ctx context.Context) ([]githubRelease, error) {
	cached, err := h.rdb.Get(ctx, redisCacheKey).Result()
	if err == nil && cached != "" {
		var releases []githubRelease
		if json.Unmarshal([]byte(cached), &releases) == nil {
			return releases, nil
		}
	}

	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases?per_page=10", h.githubOwner, h.githubRepo)

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

	var releases []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("decode releases: %w", err)
	}

	if data, err := json.Marshal(releases); err == nil {
		h.rdb.Set(ctx, redisCacheKey, string(data), cacheTTL)
	}

	return releases, nil
}

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
