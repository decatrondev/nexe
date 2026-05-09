package service

import (
	"fmt"
	"log/slog"

	"github.com/resend/resend-go/v2"
)

type EmailService struct {
	client *resend.Client
	from   string
}

func NewEmailService(apiKey, from string) *EmailService {
	if apiKey == "" {
		slog.Warn("RESEND_API_KEY not set — emails will be logged only")
		return &EmailService{from: from}
	}
	return &EmailService{
		client: resend.NewClient(apiKey),
		from:   from,
	}
}

func (s *EmailService) SendVerificationCode(to, code string) error {
	if s.client == nil {
		slog.Info("email (dev mode)", "to", to, "code", code)
		return nil
	}

	html := fmt.Sprintf(`
		<div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
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

	params := &resend.SendEmailRequest{
		From:    s.from,
		To:      []string{to},
		Subject: fmt.Sprintf("Nexe — Your verification code: %s", code),
		Html:    html,
	}

	_, err := s.client.Emails.Send(params)
	if err != nil {
		slog.Error("failed to send email", "error", err, "to", to)
		return fmt.Errorf("send email: %w", err)
	}

	slog.Info("verification email sent", "to", to)
	return nil
}
