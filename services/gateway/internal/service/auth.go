package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/decatrondev/nexe/services/gateway/internal/model"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

var (
	emailRegex    = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,32}$`)
)

type AuthService struct {
	users        *repository.UserRepository
	sessions     *repository.SessionRepository
	verification *repository.VerificationRepository
	jwt          *JWTService
	email        *EmailService
}

func NewAuthService(
	users *repository.UserRepository,
	sessions *repository.SessionRepository,
	verification *repository.VerificationRepository,
	jwt *JWTService,
	email *EmailService,
) *AuthService {
	return &AuthService{
		users:        users,
		sessions:     sessions,
		verification: verification,
		jwt:          jwt,
		email:        email,
	}
}

func (s *AuthService) GetUserByID(ctx context.Context, id string) (*model.User, error) {
	return s.users.GetByID(ctx, id)
}

type RegisterInput struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type VerifyEmailInput struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

type AuthTokens struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
}

func (s *AuthService) Register(ctx context.Context, input RegisterInput) (*model.User, string, error) {
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.Username = strings.TrimSpace(input.Username)

	if !emailRegex.MatchString(input.Email) {
		return nil, "", fmt.Errorf("invalid email format")
	}
	if !usernameRegex.MatchString(input.Username) {
		return nil, "", fmt.Errorf("username must be 3-32 characters, alphanumeric, hyphens and underscores only")
	}
	if err := validatePassword(input.Password); err != nil {
		return nil, "", err
	}

	existing, err := s.users.GetByEmail(ctx, input.Email)
	if err != nil {
		return nil, "", fmt.Errorf("check email: %w", err)
	}
	if existing != nil {
		return nil, "", fmt.Errorf("email already registered")
	}

	existing, err = s.users.GetByUsername(ctx, input.Username)
	if err != nil {
		return nil, "", fmt.Errorf("check username: %w", err)
	}
	if existing != nil {
		return nil, "", fmt.Errorf("username already taken")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), 12)
	if err != nil {
		return nil, "", fmt.Errorf("hash password: %w", err)
	}

	hashStr := string(hash)
	user := &model.User{
		Username:     input.Username,
		Email:        input.Email,
		PasswordHash: &hashStr,
	}

	if err := s.users.Create(ctx, user); err != nil {
		return nil, "", fmt.Errorf("create user: %w", err)
	}

	if err := s.users.CreateProfile(ctx, user.ID); err != nil {
		slog.Error("failed to create profile", "error", err, "userId", user.ID)
	}
	if err := s.users.CreateTier(ctx, user.ID); err != nil {
		slog.Error("failed to create tier", "error", err, "userId", user.ID)
	}

	code, err := s.generateVerificationCode(ctx, input.Email)
	if err != nil {
		return nil, "", fmt.Errorf("generate verification code: %w", err)
	}

	if err := s.email.SendVerificationCode(input.Email, code); err != nil {
		slog.Error("failed to send verification email", "error", err, "email", input.Email)
	}

	slog.Info("user registered", "userId", user.ID, "email", input.Email)
	return user, code, nil
}

func (s *AuthService) VerifyEmail(ctx context.Context, input VerifyEmailInput) error {
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))

	v, err := s.verification.GetLatest(ctx, input.Email)
	if err != nil {
		return fmt.Errorf("get verification: %w", err)
	}
	if v == nil {
		return fmt.Errorf("no pending verification found")
	}
	if v.Attempts >= 5 {
		return fmt.Errorf("too many attempts, request a new code")
	}

	if err := s.verification.IncrementAttempts(ctx, v.ID); err != nil {
		return fmt.Errorf("increment attempts: %w", err)
	}

	if v.Code != input.Code {
		return fmt.Errorf("invalid verification code")
	}

	if err := s.verification.MarkUsed(ctx, v.ID); err != nil {
		return fmt.Errorf("mark used: %w", err)
	}

	user, err := s.users.GetByEmail(ctx, input.Email)
	if err != nil || user == nil {
		return fmt.Errorf("user not found")
	}

	if err := s.users.VerifyEmail(ctx, user.ID); err != nil {
		return fmt.Errorf("verify email: %w", err)
	}

	slog.Info("email verified", "userId", user.ID, "email", input.Email)
	return nil
}

func (s *AuthService) Login(ctx context.Context, input LoginInput, ip, userAgent string) (*AuthTokens, *model.User, error) {
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))

	user, err := s.users.GetByEmail(ctx, input.Email)
	if err != nil {
		return nil, nil, fmt.Errorf("get user: %w", err)
	}
	if user == nil || user.PasswordHash == nil {
		return nil, nil, fmt.Errorf("invalid credentials")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(input.Password)); err != nil {
		return nil, nil, fmt.Errorf("invalid credentials")
	}

	if !user.EmailVerified {
		return nil, nil, fmt.Errorf("email not verified")
	}

	tokens, err := s.createSession(ctx, user, ip, userAgent)
	if err != nil {
		return nil, nil, err
	}

	slog.Info("user logged in", "userId", user.ID)
	return tokens, user, nil
}

func (s *AuthService) RefreshTokens(ctx context.Context, refreshToken, ip, userAgent string) (*AuthTokens, error) {
	hash := s.jwt.HashRefreshToken(refreshToken)

	// Find session by iterating (in production, index the hash)
	// For now, we decode the session ID from the token prefix or search
	// Simple approach: refresh token format is "sessionID:randomToken"
	parts := strings.SplitN(refreshToken, ":", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid refresh token format")
	}

	sessionID := parts[0]
	tokenPart := parts[1]
	tokenHash := s.jwt.HashRefreshToken(tokenPart)

	session, err := s.sessions.GetByID(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found or expired")
	}

	if session.RefreshTokenHash != tokenHash {
		// Possible token reuse attack — revoke all sessions
		slog.Warn("possible token reuse", "sessionId", sessionID, "userId", session.UserID)
		_ = s.sessions.DeleteAllByUser(ctx, session.UserID)
		return nil, fmt.Errorf("invalid refresh token")
	}

	// Delete old session
	_ = s.sessions.Delete(ctx, sessionID)

	user, err := s.users.GetByID(ctx, session.UserID)
	if err != nil || user == nil {
		return nil, fmt.Errorf("user not found")
	}

	// Create new session with new refresh token
	tokens, err := s.createSession(ctx, user, ip, userAgent)
	if err != nil {
		return nil, err
	}

	_ = hash // suppress unused warning
	return tokens, nil
}

func (s *AuthService) Logout(ctx context.Context, sessionID string) error {
	return s.sessions.Delete(ctx, sessionID)
}

func (s *AuthService) LogoutAll(ctx context.Context, userID string) error {
	return s.sessions.DeleteAllByUser(ctx, userID)
}

func (s *AuthService) ListSessions(ctx context.Context, userID string) ([]model.Session, error) {
	return s.sessions.ListByUser(ctx, userID)
}

func (s *AuthService) ResendVerification(ctx context.Context, email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))

	user, err := s.users.GetByEmail(ctx, email)
	if err != nil || user == nil {
		return "", fmt.Errorf("user not found")
	}
	if user.EmailVerified {
		return "", fmt.Errorf("email already verified")
	}

	code, err := s.generateVerificationCode(ctx, email)
	if err != nil {
		return "", fmt.Errorf("generate code: %w", err)
	}

	if err := s.email.SendVerificationCode(email, code); err != nil {
		slog.Error("failed to resend verification email", "error", err, "email", email)
	}

	return code, nil
}

func (s *AuthService) ForgotPassword(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))

	user, err := s.users.GetByEmail(ctx, email)
	if err != nil || user == nil {
		// Don't reveal if email exists
		return nil
	}

	code, err := s.generateVerificationCode(ctx, email)
	if err != nil {
		return fmt.Errorf("generate code: %w", err)
	}

	if err := s.email.SendPasswordResetCode(email, code); err != nil {
		slog.Error("failed to send reset email", "error", err, "email", email)
	}

	slog.Info("password reset requested", "email", email)
	return nil
}

func (s *AuthService) ResetPassword(ctx context.Context, email, code, newPassword string) error {
	email = strings.ToLower(strings.TrimSpace(email))

	if err := validatePassword(newPassword); err != nil {
		return err
	}

	v, err := s.verification.GetLatest(ctx, email)
	if err != nil {
		return fmt.Errorf("get verification: %w", err)
	}
	if v == nil {
		return fmt.Errorf("no pending reset code found")
	}
	if v.Attempts >= 5 {
		return fmt.Errorf("too many attempts, request a new code")
	}

	if err := s.verification.IncrementAttempts(ctx, v.ID); err != nil {
		return fmt.Errorf("increment attempts: %w", err)
	}

	if v.Code != code {
		return fmt.Errorf("invalid reset code")
	}

	if err := s.verification.MarkUsed(ctx, v.ID); err != nil {
		return fmt.Errorf("mark used: %w", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	if err := s.users.UpdatePassword(ctx, email, string(hash)); err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	slog.Info("password reset successful", "email", email)
	return nil
}

// CreateSessionForUser creates a session for a user without requiring password verification.
// Used for OAuth-based logins (e.g. Twitch).
func (s *AuthService) CreateSessionForUser(ctx context.Context, user *model.User, ip, userAgent string) (*AuthTokens, error) {
	return s.createSession(ctx, user, ip, userAgent)
}

func (s *AuthService) createSession(ctx context.Context, user *model.User, ip, userAgent string) (*AuthTokens, error) {
	twitchID := ""
	if user.TwitchID != nil {
		twitchID = *user.TwitchID
	}

	accessToken, err := s.jwt.GenerateAccessToken(user.ID, user.Username, user.Email, user.Tier, twitchID)
	if err != nil {
		return nil, fmt.Errorf("generate access token: %w", err)
	}

	rawToken, tokenHash := s.jwt.GenerateRefreshToken()

	sess := &model.Session{
		UserID:           user.ID,
		RefreshTokenHash: tokenHash,
		IPAddress:        &ip,
		UserAgent:        &userAgent,
		ExpiresAt:        time.Now().Add(s.jwt.RefreshTTL()),
	}

	if err := s.sessions.Create(ctx, sess); err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}

	refreshToken := sess.ID + ":" + rawToken

	return &AuthTokens{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    900, // 15 minutes
	}, nil
}

func (s *AuthService) generateVerificationCode(ctx context.Context, email string) (string, error) {
	code := generateCode()
	expiresAt := time.Now().Add(10 * time.Minute)

	if err := s.verification.Create(ctx, email, code, expiresAt); err != nil {
		return "", err
	}

	return code, nil
}

func generateCode() string {
	digits := "0123456789"
	code := make([]byte, 6)
	for i := range code {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		code[i] = digits[n.Int64()]
	}
	return string(code)
}

func validatePassword(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}
	hasUpper := false
	hasDigit := false
	for _, c := range password {
		if unicode.IsUpper(c) {
			hasUpper = true
		}
		if unicode.IsDigit(c) {
			hasDigit = true
		}
	}
	if !hasUpper {
		return fmt.Errorf("password must contain at least one uppercase letter")
	}
	if !hasDigit {
		return fmt.Errorf("password must contain at least one digit")
	}
	return nil
}
