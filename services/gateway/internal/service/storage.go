package service

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// Storage is the interface for file storage. Swap LocalStorage for R2Storage later.
type Storage interface {
	// Upload saves a file and returns its public URL.
	Upload(bucket string, filename string, reader io.Reader) (string, error)
	// UploadAttachment saves a chat attachment (images, videos, documents) and returns its public URL.
	UploadAttachment(filename string, reader io.Reader) (string, error)
	// Delete removes a file by its public URL.
	Delete(url string) error
}

// LocalStorage stores files on the local filesystem and serves them via a base URL.
type LocalStorage struct {
	BasePath string // e.g. /var/www/html/nexe/uploads
	BaseURL  string // e.g. https://uploads.nexe.decatron.net
}

func NewLocalStorage(basePath, baseURL string) *LocalStorage {
	return &LocalStorage{BasePath: basePath, BaseURL: baseURL}
}

func (s *LocalStorage) Upload(bucket string, filename string, reader io.Reader) (string, error) {
	// Sanitize bucket (avatars, banners, etc.)
	bucket = filepath.Clean(bucket)
	dir := filepath.Join(s.BasePath, bucket)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create directory: %w", err)
	}

	// Generate unique filename preserving extension
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".png"
	}
	// Only allow safe extensions
	ext = strings.ToLower(ext)
	allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true}
	if !allowed[ext] {
		return "", fmt.Errorf("unsupported file type: %s", ext)
	}

	newName := uuid.New().String() + ext
	fullPath := filepath.Join(dir, newName)

	file, err := os.Create(fullPath)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, reader); err != nil {
		os.Remove(fullPath)
		return "", fmt.Errorf("write file: %w", err)
	}

	url := fmt.Sprintf("%s/%s/%s", strings.TrimRight(s.BaseURL, "/"), bucket, newName)
	return url, nil
}

var attachmentAllowed = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
	".mp4": true, ".webm": true, ".mov": true,
	".pdf": true, ".txt": true, ".zip": true, ".json": true,
	".mp3": true, ".ogg": true, ".wav": true,
}

func (s *LocalStorage) UploadAttachment(filename string, reader io.Reader) (string, error) {
	dir := filepath.Join(s.BasePath, "attachments")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create directory: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		ext = ".bin"
	}
	if !attachmentAllowed[ext] {
		return "", fmt.Errorf("unsupported file type: %s", ext)
	}

	newName := uuid.New().String() + ext
	fullPath := filepath.Join(dir, newName)

	file, err := os.Create(fullPath)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, reader); err != nil {
		os.Remove(fullPath)
		return "", fmt.Errorf("write file: %w", err)
	}

	url := fmt.Sprintf("%s/attachments/%s", strings.TrimRight(s.BaseURL, "/"), newName)
	return url, nil
}

func (s *LocalStorage) Delete(url string) error {
	if url == "" {
		return nil
	}
	// Extract relative path from URL
	rel := strings.TrimPrefix(url, s.BaseURL)
	rel = strings.TrimPrefix(rel, "/")
	if rel == "" || strings.Contains(rel, "..") {
		return nil // safety: don't delete anything suspicious
	}
	fullPath := filepath.Join(s.BasePath, rel)
	return os.Remove(fullPath)
}
