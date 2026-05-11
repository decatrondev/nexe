package handler

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"

	"github.com/decatrondev/nexe/services/gateway/internal/middleware"
	"github.com/decatrondev/nexe/services/gateway/internal/service"
)

type AuthHandler struct {
	auth *service.AuthService
}

func NewAuthHandler(auth *service.AuthService) *AuthHandler {
	return &AuthHandler{auth: auth}
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var input service.RegisterInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	user, code, err := h.auth.Register(r.Context(), input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "registration_failed", err.Error())
		return
	}

	// In production, send email with code. For dev, log it.
	slog.Info("verification code generated", "email", input.Email, "code", code)

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"data": map[string]interface{}{
			"userId":  user.ID,
			"email":   user.Email,
			"message": "verification code sent to email",
		},
	})
}

func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var input service.VerifyEmailInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	if err := h.auth.VerifyEmail(r.Context(), input); err != nil {
		writeError(w, http.StatusBadRequest, "verification_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "email verified successfully"},
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var input service.LoginInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "invalid request body")
		return
	}

	ip := r.Header.Get("X-Real-IP")
	if ip == "" {
		ip, _, _ = net.SplitHostPort(r.RemoteAddr)
		if ip == "" {
			ip = r.RemoteAddr
		}
	}
	userAgent := r.Header.Get("User-Agent")

	tokens, user, err := h.auth.Login(r.Context(), input, ip, userAgent)
	if err != nil {
		if err.Error() == "email not verified" {
			writeError(w, http.StatusForbidden, "email_not_verified", "Please verify your email before logging in")
			return
		}
		writeError(w, http.StatusUnauthorized, "login_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"accessToken":  tokens.AccessToken,
			"refreshToken": tokens.RefreshToken,
			"expiresIn":    tokens.ExpiresIn,
			"user": map[string]interface{}{
				"id":       user.ID,
				"username": user.Username,
				"email":    user.Email,
				"tier":     user.Tier,
			},
		},
	})
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "refreshToken is required")
		return
	}

	ip := r.Header.Get("X-Real-IP")
	if ip == "" {
		ip, _, _ = net.SplitHostPort(r.RemoteAddr)
		if ip == "" {
			ip = r.RemoteAddr
		}
	}
	userAgent := r.Header.Get("User-Agent")

	tokens, err := h.auth.RefreshTokens(r.Context(), body.RefreshToken, ip, userAgent)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "refresh_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]interface{}{
			"accessToken":  tokens.AccessToken,
			"refreshToken": tokens.RefreshToken,
			"expiresIn":    tokens.ExpiresIn,
		},
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var body struct {
		SessionID string `json:"sessionId"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if body.SessionID != "" {
		if err := h.auth.Logout(r.Context(), body.SessionID); err != nil {
			writeError(w, http.StatusInternalServerError, "logout_failed", err.Error())
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "logged out"},
	})
}

func (h *AuthHandler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	if err := h.auth.LogoutAll(r.Context(), claims.Subject); err != nil {
		writeError(w, http.StatusInternalServerError, "logout_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "all sessions terminated"},
	})
}

func (h *AuthHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	sessions, err := h.auth.ListSessions(r.Context(), claims.Subject)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sessions_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": sessions,
	})
}

func (h *AuthHandler) ResendVerification(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "email is required")
		return
	}

	code, err := h.auth.ResendVerification(r.Context(), body.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, "resend_failed", err.Error())
		return
	}

	slog.Info("verification code resent", "email", body.Email, "code", code)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "verification code sent"},
	})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	// Fetch fresh data from DB (not just JWT claims) so linked accounts show up
	user, err := h.auth.GetUserByID(r.Context(), claims.Subject)
	if err != nil || user == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"data": map[string]interface{}{
				"id":       claims.Subject,
				"username": claims.Username,
				"email":    claims.Email,
				"tier":     claims.Tier,
				"twitchId": claims.TwitchID,
			},
		})
		return
	}

	resp := map[string]interface{}{
		"id":       user.ID,
		"username": user.Username,
		"email":    user.Email,
		"tier":     user.Tier,
	}
	if user.TwitchID != nil && *user.TwitchID != "" {
		resp["twitchId"] = *user.TwitchID
	}
	if user.TwitchLogin != nil && *user.TwitchLogin != "" {
		resp["twitchLogin"] = *user.TwitchLogin
	}
	if user.TwitchDisplayName != nil && *user.TwitchDisplayName != "" {
		resp["twitchDisplayName"] = *user.TwitchDisplayName
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"data": resp})
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "email is required")
		return
	}

	if err := h.auth.ForgotPassword(r.Context(), body.Email); err != nil {
		writeError(w, http.StatusInternalServerError, "forgot_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "if the email exists, a reset code has been sent"},
	})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Code == "" || body.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "email, code, and newPassword are required")
		return
	}

	if err := h.auth.ResetPassword(r.Context(), body.Email, body.Code, body.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, "reset_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data": map[string]string{"message": "password reset successfully"},
	})
}
