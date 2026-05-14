package handler

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var ogRegex = regexp.MustCompile(`<meta\s+(?:property|name)=["'](og:|twitter:)([^"']+)["']\s+content=["']([^"']*)["']`)
var ogRegexReverse = regexp.MustCompile(`<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["'](og:|twitter:)([^"']+)["']`)
var titleRegex = regexp.MustCompile(`<title[^>]*>([^<]*)</title>`)
var descRegex = regexp.MustCompile(`<meta\s+name=["']description["']\s+content=["']([^"']*)["']`)
var faviconRegex = regexp.MustCompile(`<link\s+[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']*)["']`)

type UnfurlResult struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Image       string `json:"image,omitempty"`
	SiteName    string `json:"siteName,omitempty"`
	Favicon     string `json:"favicon,omitempty"`
}

func HandleUnfurl(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" || (!strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://")) {
		writeError(w, http.StatusBadRequest, "invalid_url", "valid URL is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_url", "invalid URL")
		return
	}
	req.Header.Set("User-Agent", "NexeBot/1.0 (link preview)")
	req.Header.Set("Accept", "text/html")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, UnfurlResult{URL: url})
		return
	}
	defer resp.Body.Close()

	if !strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
		writeJSON(w, http.StatusOK, UnfurlResult{URL: url})
		return
	}

	// Read first 64KB only
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	html := string(body)

	result := UnfurlResult{URL: url}
	og := make(map[string]string)

	// Parse og: and twitter: meta tags
	for _, m := range ogRegex.FindAllStringSubmatch(html, -1) {
		key := m[1] + m[2]
		if og[key] == "" {
			og[key] = m[3]
		}
	}
	for _, m := range ogRegexReverse.FindAllStringSubmatch(html, -1) {
		key := m[2] + m[3]
		if og[key] == "" {
			og[key] = m[1]
		}
	}

	// Title: og:title > twitter:title > <title>
	result.Title = og["og:title"]
	if result.Title == "" {
		result.Title = og["twitter:title"]
	}
	if result.Title == "" {
		if m := titleRegex.FindStringSubmatch(html); m != nil {
			result.Title = strings.TrimSpace(m[1])
		}
	}

	// Description
	result.Description = og["og:description"]
	if result.Description == "" {
		result.Description = og["twitter:description"]
	}
	if result.Description == "" {
		if m := descRegex.FindStringSubmatch(html); m != nil {
			result.Description = m[1]
		}
	}
	// Trim description
	if len(result.Description) > 200 {
		result.Description = result.Description[:197] + "..."
	}

	// Image
	result.Image = og["og:image"]
	if result.Image == "" {
		result.Image = og["twitter:image"]
	}
	// Make relative URLs absolute
	if result.Image != "" && strings.HasPrefix(result.Image, "/") {
		// Extract origin from URL
		parts := strings.SplitN(url, "/", 4)
		if len(parts) >= 3 {
			result.Image = parts[0] + "//" + parts[2] + result.Image
		}
	}

	// Site name
	result.SiteName = og["og:site_name"]

	// Favicon
	if m := faviconRegex.FindStringSubmatch(html); m != nil {
		result.Favicon = m[1]
		if strings.HasPrefix(result.Favicon, "/") {
			parts := strings.SplitN(url, "/", 4)
			if len(parts) >= 3 {
				result.Favicon = parts[0] + "//" + parts[2] + result.Favicon
			}
		}
	}

	writeJSON(w, http.StatusOK, result)
}
