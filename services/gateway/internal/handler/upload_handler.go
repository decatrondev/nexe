package handler

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
	"github.com/decatrondev/nexe/services/gateway/internal/service"
)

const maxUploadSize = 50 << 20 // 50 MB (Free tier)

type UploadHandler struct {
	storage  service.Storage
	profiles *repository.ProfileRepository
}

func NewUploadHandler(storage service.Storage, profiles *repository.ProfileRepository) *UploadHandler {
	return &UploadHandler{storage: storage, profiles: profiles}
}

// UploadAvatar handles POST /users/@me/avatar
func (h *UploadHandler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	h.handleUpload(w, r, "avatars", "avatarUrl")
}

// UploadBanner handles POST /users/@me/banner
func (h *UploadHandler) UploadBanner(w http.ResponseWriter, r *http.Request) {
	h.handleUpload(w, r, "banners", "bannerUrl")
}

// DeleteAvatar handles DELETE /users/@me/avatar
func (h *UploadHandler) DeleteAvatar(w http.ResponseWriter, r *http.Request) {
	h.handleDelete(w, r, "avatarUrl")
}

// DeleteBanner handles DELETE /users/@me/banner
func (h *UploadHandler) DeleteBanner(w http.ResponseWriter, r *http.Request) {
	h.handleDelete(w, r, "bannerUrl")
}

// UploadAttachment handles POST /upload/attachment — for chat file uploads
func (h *UploadHandler) UploadAttachment(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "too_large", "file must be under 50MB")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "no_file", "file field is required")
		return
	}
	defer file.Close()

	url, err := h.storage.UploadAttachment(header.Filename, file)
	if err != nil {
		slog.Error("attachment upload failed", "error", err)
		writeError(w, http.StatusInternalServerError, "upload_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"url":      url,
		"filename": header.Filename,
		"size":     header.Size,
	})
}

func (h *UploadHandler) handleUpload(w http.ResponseWriter, r *http.Request, bucket, field string) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "too_large", "file must be under 50MB")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "no_file", "file field is required")
		return
	}
	defer file.Close()

	// Delete old file if exists
	profile, _ := h.profiles.GetByUserID(r.Context(), claims.Subject)
	if profile != nil {
		var oldURL string
		if field == "avatarUrl" && profile.AvatarUrl != nil {
			oldURL = *profile.AvatarUrl
		} else if field == "bannerUrl" && profile.BannerUrl != nil {
			oldURL = *profile.BannerUrl
		}
		if oldURL != "" {
			if err := h.storage.Delete(oldURL); err != nil {
				slog.Warn("failed to delete old file", "url", oldURL, "error", err)
			}
		}
	}

	// Upload new file
	url, err := h.storage.Upload(bucket, header.Filename, file)
	if err != nil {
		slog.Error("upload failed", "error", err, "bucket", bucket)
		writeError(w, http.StatusInternalServerError, "upload_error", err.Error())
		return
	}

	// Update profile
	if err := h.profiles.Update(r.Context(), claims.Subject, map[string]interface{}{field: url}); err != nil {
		slog.Error("profile update failed after upload", "error", err)
		writeError(w, http.StatusInternalServerError, "update_error", "failed to update profile")
		return
	}

	// Log activity
	actType := "avatar_update"
	if field == "bannerUrl" {
		actType = "banner_update"
	}
	go h.profiles.LogActivity(context.Background(), claims.Subject, actType, map[string]string{})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"url": url,
	})
}

func (h *UploadHandler) handleDelete(w http.ResponseWriter, r *http.Request, field string) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	profile, _ := h.profiles.GetByUserID(r.Context(), claims.Subject)
	if profile != nil {
		var oldURL string
		if field == "avatarUrl" && profile.AvatarUrl != nil {
			oldURL = *profile.AvatarUrl
		} else if field == "bannerUrl" && profile.BannerUrl != nil {
			oldURL = *profile.BannerUrl
		}
		if oldURL != "" {
			if err := h.storage.Delete(oldURL); err != nil {
				slog.Warn("failed to delete file", "url", oldURL, "error", err)
			}
		}
	}

	// Clear the field in profile
	if err := h.profiles.Update(r.Context(), claims.Subject, map[string]interface{}{field: nil}); err != nil {
		writeError(w, http.StatusInternalServerError, "update_error", "failed to update profile")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}
