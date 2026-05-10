package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/decatrondev/nexe/services/gateway/internal/service"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second
	maxMessageSize = 4096
)

var (
	upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}
	nextConnID uint64
)

type WSMessage struct {
	Op int             `json:"op"`
	T  string          `json:"t,omitempty"`
	D  json.RawMessage `json:"d,omitempty"`
}

type WSClient struct {
	id       uint64
	conn     *websocket.Conn
	userID   string
	username string
	send     chan []byte
	guildIDs []string
}

type WSHandler struct {
	jwt       *service.JWTService
	rdb       *redis.Client
	guildsURL string
	clients   map[uint64]*WSClient            // connID → client
	userConns map[string]map[uint64]bool       // userID → set of connIDs
	guildSubs map[string]map[string]bool       // guildID → set of userIDs
	mu        sync.RWMutex
}

func NewWSHandler(jwt *service.JWTService, rdb *redis.Client, guildsURL string) *WSHandler {
	return &WSHandler{
		jwt:       jwt,
		rdb:       rdb,
		guildsURL: guildsURL,
		clients:   make(map[uint64]*WSClient),
		userConns: make(map[string]map[uint64]bool),
		guildSubs: make(map[string]map[string]bool),
	}
}

func (h *WSHandler) HandleWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		token = r.Header.Get("Sec-WebSocket-Protocol")
	}
	if token == "" {
		http.Error(w, "missing auth token", http.StatusUnauthorized)
		return
	}

	claims, err := h.jwt.ValidateAccessToken(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade failed", "error", err)
		return
	}

	connID := atomic.AddUint64(&nextConnID, 1)
	client := &WSClient{
		id:       connID,
		conn:     conn,
		userID:   claims.Subject,
		username: claims.Username,
		send:     make(chan []byte, 256),
	}

	h.mu.Lock()
	h.clients[connID] = client
	if h.userConns[client.userID] == nil {
		h.userConns[client.userID] = make(map[uint64]bool)
	}
	h.userConns[client.userID][connID] = true
	h.mu.Unlock()

	slog.Info("ws client connected", "connId", connID, "userId", client.userID, "username", client.username)

	// Send READY event
	ready, _ := json.Marshal(WSMessage{
		Op: 0,
		T:  "READY",
		D:  json.RawMessage(`{"userId":"` + client.userID + `","username":"` + client.username + `"}`),
	})
	client.send <- ready

	go h.subscribeClientToGuilds(client)
	go h.writePump(client)
	go h.readPump(client)
}

func (h *WSHandler) subscribeClientToGuilds(client *WSClient) {
	req, err := http.NewRequest("GET", h.guildsURL+"/guilds/me", nil)
	if err != nil {
		slog.Error("failed to create guilds request", "error", err, "userId", client.userID)
		return
	}
	req.Header.Set("X-User-ID", client.userID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Error("failed to fetch user guilds", "error", err, "userId", client.userID)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Error("guilds service returned non-200", "status", resp.StatusCode, "body", string(body))
		return
	}

	var guilds []struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&guilds); err != nil {
		slog.Error("failed to decode guilds response", "error", err)
		return
	}

	guildIDs := make([]string, 0, len(guilds))
	for _, g := range guilds {
		guildIDs = append(guildIDs, g.ID)
	}

	h.mu.Lock()
	client.guildIDs = guildIDs
	for _, gid := range guildIDs {
		if h.guildSubs[gid] == nil {
			h.guildSubs[gid] = make(map[string]bool)
		}
		h.guildSubs[gid][client.userID] = true
	}
	h.mu.Unlock()

	slog.Info("client subscribed to guilds", "userId", client.userID, "guildCount", len(guildIDs))
}

// BroadcastToGuild sends an event to all connected clients in a guild,
// optionally excluding a specific user (e.g. the sender).
func (h *WSHandler) BroadcastToGuild(guildID string, data []byte, excludeUserID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	members := h.guildSubs[guildID]
	if members == nil {
		return
	}

	for userID := range members {
		if userID == excludeUserID {
			continue
		}
		connIDs := h.userConns[userID]
		for connID := range connIDs {
			client, ok := h.clients[connID]
			if !ok {
				continue
			}
			select {
			case client.send <- data:
			default:
				slog.Warn("client send buffer full, dropping event", "connId", connID, "userId", userID)
			}
		}
	}
}

// StartRedisSubscriber listens for events published to Redis and broadcasts
// them to the appropriate guild clients.
func (h *WSHandler) StartRedisSubscriber(ctx context.Context) {
	pubsub := h.rdb.PSubscribe(ctx, "nexe:events:*")
	defer pubsub.Close()

	slog.Info("redis subscriber started", "pattern", "nexe:events:*")

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			slog.Info("redis subscriber stopped")
			return
		case msg, ok := <-ch:
			if !ok {
				slog.Warn("redis subscription channel closed")
				return
			}
			h.handleRedisEvent(msg)
		}
	}
}

type redisEvent struct {
	Type    string          `json:"type"`
	GuildID string          `json:"guildId"`
	UserID  string          `json:"userId,omitempty"`
	Data    json.RawMessage `json:"data"`
}

func (h *WSHandler) handleRedisEvent(msg *redis.Message) {
	const prefix = "nexe:events:guild:"
	if !strings.HasPrefix(msg.Channel, prefix) {
		return
	}

	var evt redisEvent
	if err := json.Unmarshal([]byte(msg.Payload), &evt); err != nil {
		slog.Error("failed to parse redis event", "error", err)
		return
	}

	guildID := strings.TrimPrefix(msg.Channel, prefix)
	if guildID == "" {
		return
	}

	wsMsg := WSMessage{
		Op: 0,
		T:  evt.Type,
		D:  evt.Data,
	}
	data, err := json.Marshal(wsMsg)
	if err != nil {
		return
	}

	// Don't exclude sender — the frontend deduplicates via message ID.
	// Excluding by userID would block other tabs/devices of the same user.
	h.BroadcastToGuild(guildID, data, "")
}

func (h *WSHandler) readPump(client *WSClient) {
	defer func() {
		h.removeClient(client)
		client.conn.Close()
	}()

	client.conn.SetReadLimit(maxMessageSize)
	client.conn.SetReadDeadline(time.Now().Add(pongWait))
	client.conn.SetPongHandler(func(string) error {
		client.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := client.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Error("ws read error", "error", err, "userId", client.userID)
			}
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Op {
		case 1: // HEARTBEAT
			ack, _ := json.Marshal(WSMessage{Op: 1, T: "HEARTBEAT_ACK"})
			client.send <- ack
		case 2: // TYPING_START
			h.handleTypingStart(client, msg.D)
		}
	}
}

type typingPayload struct {
	ChannelID string `json:"channelId"`
}

func (h *WSHandler) handleTypingStart(client *WSClient, raw json.RawMessage) {
	var payload typingPayload
	if err := json.Unmarshal(raw, &payload); err != nil || payload.ChannelID == "" {
		return
	}

	typingData, _ := json.Marshal(WSMessage{
		Op: 0,
		T:  "TYPING_START",
		D:  json.RawMessage(fmt.Sprintf(`{"userId":"%s","username":"%s","channelId":"%s","timestamp":%d}`, client.userID, client.username, payload.ChannelID, time.Now().UnixMilli())),
	})

	h.mu.RLock()
	guildIDs := client.guildIDs
	h.mu.RUnlock()

	for _, gid := range guildIDs {
		h.BroadcastToGuild(gid, typingData, client.userID)
	}
}

func (h *WSHandler) writePump(client *WSClient) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		client.conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.send:
			client.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				client.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := client.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			client.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := client.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *WSHandler) removeClient(client *WSClient) {
	h.mu.Lock()
	// Remove from guild subscriptions
	for _, gid := range client.guildIDs {
		if members, ok := h.guildSubs[gid]; ok {
			// Only remove user from guild if this was their last connection
			if conns := h.userConns[client.userID]; len(conns) <= 1 {
				delete(members, client.userID)
				if len(members) == 0 {
					delete(h.guildSubs, gid)
				}
			}
		}
	}
	// Remove connection
	delete(h.clients, client.id)
	if conns, ok := h.userConns[client.userID]; ok {
		delete(conns, client.id)
		if len(conns) == 0 {
			delete(h.userConns, client.userID)
		}
	}
	h.mu.Unlock()
	close(client.send)
	slog.Info("ws client disconnected", "connId", client.id, "userId", client.userID)
}

func (h *WSHandler) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
