package middleware

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiter struct {
	redis  *redis.Client
	limit  int
	window time.Duration
}

func NewRateLimiter(rdb *redis.Client, limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{redis: rdb, limit: limit, window: window}
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractIP(r)
		key := fmt.Sprintf("nexe:ratelimit:%s:%s", r.URL.Path, ip)

		ctx := context.Background()
		count, err := rl.redis.Incr(ctx, key).Result()
		if err != nil {
			// If Redis is down, allow the request
			next.ServeHTTP(w, r)
			return
		}

		if count == 1 {
			rl.redis.Expire(ctx, key, rl.window)
		}

		if count > int64(rl.limit) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", fmt.Sprintf("%d", int(rl.window.Seconds())))
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":{"code":"rate_limited","message":"too many requests"}}`))
			return
		}

		next.ServeHTTP(w, r)
	})
}

func extractIP(r *http.Request) string {
	// Only trust X-Real-IP set by nginx (not spoofable by client)
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	// Fallback to RemoteAddr (direct connection)
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
