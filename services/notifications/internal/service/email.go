package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
)

type EmailService struct {
	apiKey string
	from   string
}

func NewEmailService(apiKey, from string) *EmailService {
	if apiKey == "" {
		slog.Warn("RESEND_API_KEY not set for notifications — digest emails disabled")
	}
	return &EmailService{apiKey: apiKey, from: from}
}

func (s *EmailService) SendDigest(ctx context.Context, to, username string, unreadCount int) error {
	if s.apiKey == "" {
		slog.Info("digest email (dev mode)", "to", to, "unread", unreadCount)
		return nil
	}

	html := fmt.Sprintf(`
		<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px; background: #0f172a;">
			<h1 style="color: #6366f1; font-size: 28px; margin-bottom: 8px;">Nexe</h1>
			<p style="color: #94a3b8; font-size: 14px; margin-bottom: 32px;">Communication for Streamers</p>
			<h2 style="color: #e2e8f0; font-size: 20px;">Hey %s, you have unread notifications!</h2>
			<p style="color: #94a3b8; margin-bottom: 24px;">You have <strong style="color: #6366f1;">%d</strong> unread notifications waiting for you.</p>
			<div style="text-align: center; margin: 32px 0;">
				<a href="https://nexeapp.decatron.net" style="display: inline-block; background: #6366f1; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open Nexe</a>
			</div>
			<p style="color: #64748b; font-size: 12px; margin-top: 32px;">You're receiving this because you have unread notifications on Nexe. You can manage notification preferences in your settings.</p>
		</div>`, username, unreadCount)

	payload := map[string]interface{}{
		"from":    s.from,
		"to":     []string{to},
		"subject": fmt.Sprintf("You have %d unread notifications on Nexe", unreadCount),
		"html":   html,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("resend API error: %d", resp.StatusCode)
	}

	slog.Info("digest email sent", "to", to, "unread", unreadCount)
	return nil
}
