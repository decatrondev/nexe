package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

type EmailService struct {
	apiKey string
	from   string
}

func NewEmailService(apiKey, from string) *EmailService {
	if apiKey == "" {
		slog.Warn("RESEND_API_KEY not set — emails will be logged only")
	}
	return &EmailService{
		apiKey: apiKey,
		from:   from,
	}
}

func (s *EmailService) SendVerificationCode(to, code string) error {
	if s.apiKey == "" {
		slog.Info("email (dev mode)", "to", to, "code", code)
		return nil
	}

	html := fmt.Sprintf(`
		<div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px; background: #0f172a;">
			<h1 style="color: #6366f1; font-size: 28px; margin-bottom: 8px;">Nexe</h1>
			<p style="color: #94a3b8; font-size: 14px; margin-bottom: 32px;">Communication for Streamers</p>
			<h2 style="color: #e2e8f0; font-size: 20px;">Verify your email</h2>
			<p style="color: #94a3b8;">Enter this code to complete your registration:</p>
			<div style="background: #1e293b; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
				<span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #6366f1;">%s</span>
			</div>
			<p style="color: #64748b; font-size: 12px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
		</div>
	`, code)

	subject := fmt.Sprintf("Nexe — Your verification code: %s", code)

	return s.send(to, subject, html)
}

func (s *EmailService) send(to, subject, html string) error {
	payload := map[string]interface{}{
		"from":    s.from,
		"to":      []string{to},
		"subject": subject,
		"html":    html,
	}

	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		slog.Error("resend API error", "status", resp.StatusCode, "body", string(respBody), "to", to)
		return fmt.Errorf("resend error (%d): %s", resp.StatusCode, string(respBody))
	}

	slog.Info("verification email sent", "to", to)
	return nil
}
