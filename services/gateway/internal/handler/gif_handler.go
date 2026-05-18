package handler

import (
	"io"
	"net/http"
	"net/url"
)

type GifHandler struct {
	giphyAPIKey string
}

func NewGifHandler(giphyAPIKey string) *GifHandler {
	return &GifHandler{giphyAPIKey: giphyAPIKey}
}

func (h *GifHandler) SearchGifs(w http.ResponseWriter, r *http.Request) {
	if h.giphyAPIKey == "" {
		writeError(w, http.StatusServiceUnavailable, "GIF_UNAVAILABLE", "GIF search not configured")
		return
	}

	q := r.URL.Query().Get("q")
	if q == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "q parameter required")
		return
	}

	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "20"
	}
	offset := r.URL.Query().Get("offset")

	params := url.Values{
		"api_key": {h.giphyAPIKey},
		"q":       {q},
		"limit":   {limit},
		"rating":  {"g"},
	}
	if offset != "" {
		params.Set("offset", offset)
	}

	resp, err := http.Get("https://api.giphy.com/v1/gifs/search?" + params.Encode())
	if err != nil {
		writeError(w, http.StatusBadGateway, "GIF_ERROR", "failed to fetch GIFs")
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (h *GifHandler) TrendingGifs(w http.ResponseWriter, r *http.Request) {
	if h.giphyAPIKey == "" {
		writeError(w, http.StatusServiceUnavailable, "GIF_UNAVAILABLE", "GIF search not configured")
		return
	}

	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "20"
	}
	offset := r.URL.Query().Get("offset")

	params := url.Values{
		"api_key": {h.giphyAPIKey},
		"limit":   {limit},
		"rating":  {"g"},
	}
	if offset != "" {
		params.Set("offset", offset)
	}

	resp, err := http.Get("https://api.giphy.com/v1/gifs/trending?" + params.Encode())
	if err != nil {
		writeError(w, http.StatusBadGateway, "GIF_ERROR", "failed to fetch trending GIFs")
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (h *GifHandler) GifCategories(w http.ResponseWriter, r *http.Request) {
	if h.giphyAPIKey == "" {
		writeError(w, http.StatusServiceUnavailable, "GIF_UNAVAILABLE", "GIF search not configured")
		return
	}

	params := url.Values{
		"api_key": {h.giphyAPIKey},
	}

	resp, err := http.Get("https://api.giphy.com/v1/gifs/categories?" + params.Encode())
	if err != nil {
		writeError(w, http.StatusBadGateway, "GIF_ERROR", "failed to fetch categories")
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
