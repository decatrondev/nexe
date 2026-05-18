package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/decatrondev/nexe/services/notifications/internal/repository"
)

type PushService struct {
	repo       *repository.PushRepository
	vapidPub   string
	vapidPriv  string
	vapidEmail string
}

func NewPushService(repo *repository.PushRepository, vapidPub, vapidPriv, vapidEmail string) *PushService {
	return &PushService{
		repo:       repo,
		vapidPub:   vapidPub,
		vapidPriv:  vapidPriv,
		vapidEmail: vapidEmail,
	}
}

type PushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Icon  string `json:"icon,omitempty"`
	URL   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
}

// SendToUser sends a push notification to all subscriptions for a user.
func (s *PushService) SendToUser(ctx context.Context, userID string, payload PushPayload) {
	if s.vapidPub == "" || s.vapidPriv == "" {
		return
	}

	subs, err := s.repo.GetByUser(ctx, userID)
	if err != nil || len(subs) == 0 {
		return
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return
	}

	for _, sub := range subs {
		go func(sub repository.PushSubscription) {
			wSub := &webpush.Subscription{
				Endpoint: sub.Endpoint,
				Keys: webpush.Keys{
					P256dh: sub.P256dh,
					Auth:   sub.Auth,
				},
			}

			resp, err := webpush.SendNotification(data, wSub, &webpush.Options{
				Subscriber:      s.vapidEmail,
				VAPIDPublicKey:  s.vapidPub,
				VAPIDPrivateKey: s.vapidPriv,
				TTL:             60,
			})
			if err != nil {
				slog.Debug("push send failed", "error", err, "endpoint", sub.Endpoint[:40])
				return
			}
			defer resp.Body.Close()

			// 410 Gone or 404 = subscription expired, remove it
			if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
				s.repo.DeleteByEndpoint(context.Background(), sub.Endpoint)
				slog.Debug("removed expired push subscription", "endpoint", sub.Endpoint[:40])
			}
		}(sub)
	}
}

// Subscribe saves a push subscription for a user.
func (s *PushService) Subscribe(ctx context.Context, userID, endpoint, p256dh, auth string) error {
	return s.repo.Save(ctx, &repository.PushSubscription{
		UserID:   userID,
		Endpoint: endpoint,
		P256dh:   p256dh,
		Auth:     auth,
	})
}

// Unsubscribe removes a push subscription.
func (s *PushService) Unsubscribe(ctx context.Context, userID, endpoint string) error {
	return s.repo.Delete(ctx, userID, endpoint)
}

// GetVAPIDPublicKey returns the public key for the frontend.
func (s *PushService) GetVAPIDPublicKey() string {
	return s.vapidPub
}
