package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/decatrondev/nexe/services/gateway/internal/service"
)

type contextKey string

const UserClaimsKey contextKey = "userClaims"

func Auth(jwtSvc *service.JWTService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":{"code":"unauthorized","message":"missing authorization header"}}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
				http.Error(w, `{"error":{"code":"unauthorized","message":"invalid authorization format"}}`, http.StatusUnauthorized)
				return
			}

			claims, err := jwtSvc.ValidateAccessToken(parts[1])
			if err != nil {
				http.Error(w, `{"error":{"code":"unauthorized","message":"invalid or expired token"}}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetClaims(r *http.Request) *service.AccessClaims {
	claims, ok := r.Context().Value(UserClaimsKey).(*service.AccessClaims)
	if !ok {
		return nil
	}
	return claims
}
