package handler

import (
	"encoding/json"
	"net"
	"net/http"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/repository"
	"github.com/decatrondev/nexe/services/gateway/internal/service"
)

func extractIP(r *http.Request) string {
	ip := r.Header.Get("X-Real-IP")
	if ip == "" {
		ip, _, _ = net.SplitHostPort(r.RemoteAddr)
		if ip == "" {
			ip = r.RemoteAddr
		}
	}
	return ip
}

type TOTPHandler struct {
	users *repository.UserRepository
	auth  *service.AuthService
}

func NewTOTPHandler(users *repository.UserRepository, auth *service.AuthService) *TOTPHandler {
	return &TOTPHandler{users: users, auth: auth}
}

// Enable generates a TOTP secret and returns it + the provisioning URI for QR.
// Does NOT activate 2FA yet — user must verify with a code first.
func (h *TOTPHandler) Enable(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	user, err := h.users.GetByID(r.Context(), claims.Subject)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}

	if user.TOTPEnabled {
		writeError(w, http.StatusBadRequest, "already_enabled", "2FA is already enabled")
		return
	}

	secret, uri, err := service.GenerateTOTPSecret(user.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "totp_error", err.Error())
		return
	}

	// Save secret (not yet enabled)
	if err := h.users.SetTOTPSecret(r.Context(), user.ID, secret); err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"secret": secret,
		"uri":    uri,
	})
}

// Verify confirms the TOTP code, activates 2FA, and returns recovery codes.
func (h *TOTPHandler) Verify(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "code is required")
		return
	}

	user, err := h.users.GetByID(r.Context(), claims.Subject)
	if err != nil || user == nil || user.TOTPSecret == nil {
		writeError(w, http.StatusBadRequest, "no_secret", "enable 2FA first")
		return
	}

	if !service.ValidateTOTP(body.Code, *user.TOTPSecret) {
		writeError(w, http.StatusUnauthorized, "invalid_code", "invalid verification code")
		return
	}

	// Activate 2FA
	if err := h.users.EnableTOTP(r.Context(), user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	// Generate recovery codes
	codes, err := service.GenerateRecoveryCodes(8)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "codes_error", err.Error())
		return
	}

	if err := h.users.SaveRecoveryCodes(r.Context(), user.ID, codes); err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":       true,
		"recoveryCodes": codes,
	})
}

// Disable turns off 2FA after verifying with a current code.
func (h *TOTPHandler) Disable(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "code is required")
		return
	}

	user, err := h.users.GetByID(r.Context(), claims.Subject)
	if err != nil || user == nil || !user.TOTPEnabled || user.TOTPSecret == nil {
		writeError(w, http.StatusBadRequest, "not_enabled", "2FA is not enabled")
		return
	}

	if !service.ValidateTOTP(body.Code, *user.TOTPSecret) {
		writeError(w, http.StatusUnauthorized, "invalid_code", "invalid code")
		return
	}

	if err := h.users.DisableTOTP(r.Context(), user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"disabled": true})
}

// LoginVerify is the second step of login when 2FA is enabled.
// Accepts email + password + TOTP code and returns tokens.
func (h *TOTPHandler) LoginVerify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Password == "" || body.Code == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "email, password and code are required")
		return
	}

	user, err := h.users.GetByEmail(r.Context(), body.Email)
	if err != nil || user == nil || user.PasswordHash == nil {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
		return
	}

	if !service.CheckPasswordHash(body.Password, *user.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
		return
	}

	if !user.TOTPEnabled || user.TOTPSecret == nil {
		writeError(w, http.StatusBadRequest, "totp_not_enabled", "2FA is not enabled")
		return
	}

	if !service.ValidateTOTP(body.Code, *user.TOTPSecret) {
		writeError(w, http.StatusUnauthorized, "invalid_code", "invalid 2FA code")
		return
	}

	// Generate tokens
	tokens, err := h.auth.CreateSessionForUser(r.Context(), user, extractIP(r), r.UserAgent())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"accessToken":  tokens.AccessToken,
		"refreshToken": tokens.RefreshToken,
		"user":         user,
	})
}

// RecoverLogin allows login with a recovery code instead of TOTP.
func (h *TOTPHandler) RecoverLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email        string `json:"email"`
		Password     string `json:"password"`
		RecoveryCode string `json:"recoveryCode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Password == "" || body.RecoveryCode == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "email, password and recoveryCode are required")
		return
	}

	user, err := h.users.GetByEmail(r.Context(), body.Email)
	if err != nil || user == nil || user.PasswordHash == nil {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
		return
	}

	if !service.CheckPasswordHash(body.Password, *user.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
		return
	}

	used, err := h.users.UseRecoveryCode(r.Context(), user.ID, body.RecoveryCode)
	if err != nil || !used {
		writeError(w, http.StatusUnauthorized, "invalid_code", "invalid or used recovery code")
		return
	}

	tokens, err := h.auth.CreateSessionForUser(r.Context(), user, extractIP(r), r.UserAgent())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"accessToken":  tokens.AccessToken,
		"refreshToken": tokens.RefreshToken,
		"user":         user,
	})
}
