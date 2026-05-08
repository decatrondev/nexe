package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/decatrondev/nexe/services/gateway/internal/service"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second
	maxMessageSize = 4096
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true }, // TODO: restrict in production
}

type WSMessage struct {
	Op   int             `json:"op"`
	T    string          `json:"t,omitempty"`
	D    json.RawMessage `json:"d,omitempty"`
}

type WSClient struct {
	conn     *websocket.Conn
	userID   string
	username string
	send     chan []byte
}

type WSHandler struct {
	jwt     *service.JWTService
	clients map[string]*WSClient
	mu      sync.RWMutex
}

func NewWSHandler(jwt *service.JWTService) *WSHandler {
	return &WSHandler{
		jwt:     jwt,
		clients: make(map[string]*WSClient),
	}
}

func (h *WSHandler) HandleWS(w http.ResponseWriter, r *http.Request) {
	// Get token from query param or header
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

	client := &WSClient{
		conn:     conn,
		userID:   claims.Subject,
		username: claims.Username,
		send:     make(chan []byte, 256),
	}

	h.mu.Lock()
	h.clients[client.userID] = client
	h.mu.Unlock()

	slog.Info("ws client connected", "userId", client.userID, "username", client.username)

	// Send READY event
	ready, _ := json.Marshal(WSMessage{
		Op: 0,
		T:  "READY",
		D:  json.RawMessage(`{"userId":"` + client.userID + `","username":"` + client.username + `"}`),
	})
	client.send <- ready

	go h.writePump(client)
	go h.readPump(client)
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
		}
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
	delete(h.clients, client.userID)
	h.mu.Unlock()
	close(client.send)
	slog.Info("ws client disconnected", "userId", client.userID)
}

func (h *WSHandler) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
