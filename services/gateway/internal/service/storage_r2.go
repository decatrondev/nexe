package service

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

// R2Storage stores files in Cloudflare R2 via S3-compatible API.
type R2Storage struct {
	client    *s3.Client
	bucket    string
	publicURL string // e.g. https://pub-xxx.r2.dev
}

func NewR2Storage(accountEndpoint, accessKeyID, secretAccessKey, bucket, publicURL string) (*R2Storage, error) {
	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, "")),
		config.WithRegion("auto"),
	)
	if err != nil {
		return nil, fmt.Errorf("r2 config: %w", err)
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(accountEndpoint)
	})

	return &R2Storage{
		client:    client,
		bucket:    bucket,
		publicURL: strings.TrimRight(publicURL, "/"),
	}, nil
}

func (s *R2Storage) Upload(bucket string, filename string, reader io.Reader) (string, error) {
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".png"
	}
	ext = strings.ToLower(ext)
	allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true}
	if !allowed[ext] {
		return "", fmt.Errorf("unsupported file type: %s", ext)
	}

	key := fmt.Sprintf("%s/%s%s", bucket, uuid.New().String(), ext)

	contentType := "image/png"
	switch ext {
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	case ".gif":
		contentType = "image/gif"
	case ".webp":
		contentType = "image/webp"
	}

	_, err := s.client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        reader,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return "", fmt.Errorf("r2 upload: %w", err)
	}

	url := fmt.Sprintf("%s/%s", s.publicURL, key)
	return url, nil
}

var r2AttachmentTypes = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
	".gif": "image/gif", ".webp": "image/webp",
	".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
	".pdf": "application/pdf", ".txt": "text/plain",
	".zip": "application/zip", ".json": "application/json",
	".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
}

func (s *R2Storage) UploadAttachment(filename string, reader io.Reader) (string, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		ext = ".bin"
	}
	contentType, ok := r2AttachmentTypes[ext]
	if !ok {
		return "", fmt.Errorf("unsupported file type: %s", ext)
	}

	key := fmt.Sprintf("attachments/%s%s", uuid.New().String(), ext)

	_, err := s.client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        reader,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return "", fmt.Errorf("r2 upload attachment: %w", err)
	}

	url := fmt.Sprintf("%s/%s", s.publicURL, key)
	return url, nil
}

func (s *R2Storage) Delete(url string) error {
	if url == "" {
		return nil
	}
	// Extract key from public URL
	key := strings.TrimPrefix(url, s.publicURL+"/")
	if key == url || key == "" {
		return nil // not an R2 URL, skip
	}

	_, err := s.client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	return err
}
