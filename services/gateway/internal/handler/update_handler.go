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

// Tauri updater expected response format
type tauriUpdateResponse struct {
	Version string `json:"version"`
	Notes   string `json:"notes,omitempty"`
	PubDate string `json:"pub_date,omitempty"`
	URL     string `json:"url"`
	Sig     string `json:"signature"`
}

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Body        string        `json:"body"`
	PublishedAt string        `json:"published_at"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// Check handles GET /update/{target}/{arch}/{current_version}
// Returns 204 if no update, or 200 with Tauri's expected JSON format.
func (h *UpdateHandler) Check(w http.ResponseWriter, r *http.Request) {
	target := r.PathValue("target")
	arch := r.PathValue("arch")
	currentVersion := r.PathValue("current_version")

	if target == "" || arch == "" || currentVersion == "" {
		http.Error(w, "missing path params", http.StatusBadRequest)
		return
	}

	release, err := h.getLatestRelease(r.Context())
	if err != nil {
		http.Error(w, "failed to check updates", http.StatusBadGateway)
		return
	}

	latestVersion := strings.TrimPrefix(release.TagName, "v")

	if !isNewer(latestVersion, currentVersion) {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Find the update bundle asset for this platform
	assetName := getUpdateAssetName(target, arch)
	if assetName == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	var bundleAsset *githubAsset
	var sigAsset *githubAsset
	for i, a := range release.Assets {
		if matchAsset(a.Name, assetName) {
			bundleAsset = &release.Assets[i]
		}
		if matchAsset(a.Name, assetName) && strings.HasSuffix(a.Name, ".sig") {
			sigAsset = &release.Assets[i]
		}
	}

	// Also look for sig explicitly (asset.zip.sig)
	if sigAsset == nil && bundleAsset != nil {
		sigName := bundleAsset.Name + ".sig"
		for i, a := range release.Assets {
			if a.Name == sigName {
				sigAsset = &release.Assets[i]
				break
			}
		}
	}

	if bundleAsset == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Fetch signature content
	sig := ""
	if sigAsset != nil {
		sig = h.fetchSignature(r.Context(), sigAsset.BrowserDownloadURL)
	}

	if sig == "" {
		// No signature = can't verify update, skip
		w.WriteHeader(http.StatusNoContent)
		return
	}

	resp := tauriUpdateResponse{
		Version: release.TagName,
		Notes:   release.Body,
		PubDate: release.PublishedAt,
		URL:     bundleAsset.BrowserDownloadURL,
		Sig:     sig,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// getUpdateAssetName returns the suffix pattern to match for a given platform.
func getUpdateAssetName(target, arch string) string {
	switch target {
	case "windows":
		return "nsis.zip"
	case "linux":
		return "AppImage.tar.gz"
	case "darwin":
		return "app.tar.gz"
	}
	return ""
}

// matchAsset checks if an asset name matches the expected update bundle pattern.
func matchAsset(name, pattern string) bool {
	// Must end with the pattern but NOT be a .sig file
	return strings.HasSuffix(name, pattern) && !strings.HasSuffix(name, ".sig")
}

// fetchSignature downloads the .sig file content (small text file).
func (h *UpdateHandler) fetchSignature(ctx context.Context, url string) string {
	// Check cache first
	cacheKey := "nexe:update:sig:" + url
	if cached, err := h.rdb.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
		return cached
	}

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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}

	sig := strings.TrimSpace(string(body))

	// Cache signature for same TTL as release
	h.rdb.Set(ctx, cacheKey, sig, cacheTTL)

	return sig
}

const redisCacheKey = "nexe:update:latest_release"
const cacheTTL = 5 * time.Minute

func (h *UpdateHandler) getLatestRelease(ctx context.Context) (*githubRelease, error) {
	cached, err := h.rdb.Get(ctx, redisCacheKey).Result()
	if err == nil && cached != "" {
		var release githubRelease
		if json.Unmarshal([]byte(cached), &release) == nil {
			return &release, nil
		}
	}

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

	if data, err := json.Marshal(release); err == nil {
		h.rdb.Set(ctx, redisCacheKey, string(data), cacheTTL)
	}

	return &release, nil
}

// isNewer compares two semver-like version strings (e.g., "0.1.1" > "0.1.0").
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
