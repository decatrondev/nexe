package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/redis/go-redis/v9"

	"github.com/decatrondev/nexe/services/voice/internal/model"
)

type VoiceService struct {
	rdb              *redis.Client
	events           *EventPublisher
	livekitHost      string
	livekitPublicURL string
	livekitKey       string
	livekitSecret    string
	guildsURL        string
	roomClient       *lksdk.RoomServiceClient
}

func NewVoiceService(rdb *redis.Client, events *EventPublisher, livekitHost, livekitPublicURL, livekitKey, livekitSecret, guildsURL string) *VoiceService {
	roomClient := lksdk.NewRoomServiceClient(livekitHost, livekitKey, livekitSecret)

	return &VoiceService{
		rdb:              rdb,
		events:           events,
		livekitHost:      livekitHost,
		livekitPublicURL: livekitPublicURL,
		livekitKey:       livekitKey,
		livekitSecret:    livekitSecret,
		guildsURL:        guildsURL,
		roomClient:       roomClient,
	}
}

// voiceStateKey returns the Redis key for a user's voice state.
func voiceStateKey(userID string) string {
	return fmt.Sprintf("nexe:voice:user:%s", userID)
}

// channelParticipantsKey returns the Redis key for a channel's participant set.
func channelParticipantsKey(channelID string) string {
	return fmt.Sprintf("nexe:voice:channel:%s:participants", channelID)
}

// JoinChannel generates a LiveKit token and tracks the user's voice state.
func (s *VoiceService) JoinChannel(ctx context.Context, userID, username, guildID, channelID string) (*model.JoinResponse, error) {
	// Check if user is already in a voice channel — leave it first
	existing, err := s.GetUserVoiceState(ctx, userID)
	if err == nil && existing != nil {
		s.LeaveChannel(ctx, userID)
	}

	// Verify channel belongs to guild and is a voice channel
	if err := s.verifyVoiceChannel(guildID, channelID); err != nil {
		return nil, err
	}

	// Room name = channelID (1:1 mapping)
	roomName := channelID

	// Ensure LiveKit room exists
	_, err = s.roomClient.CreateRoom(ctx, &livekit.CreateRoomRequest{
		Name:            roomName,
		EmptyTimeout:    300, // 5 minutes
		MaxParticipants: 50,
	})
	if err != nil {
		slog.Warn("room create returned error (may already exist)", "error", err, "room", roomName)
	}

	// Generate LiveKit access token
	at := auth.NewAccessToken(s.livekitKey, s.livekitSecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     roomName,
	}
	at.AddGrant(grant).
		SetIdentity(userID).
		SetName(username).
		SetValidFor(24 * time.Hour)

	token, err := at.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	// Save voice state to Redis
	state := model.VoiceState{
		UserID:    userID,
		GuildID:   guildID,
		ChannelID: channelID,
		SelfMute:  false,
		SelfDeaf:  false,
	}

	stateJSON, _ := json.Marshal(state)
	pipe := s.rdb.Pipeline()
	pipe.Set(ctx, voiceStateKey(userID), stateJSON, 25*time.Hour)
	pipe.SAdd(ctx, channelParticipantsKey(channelID), userID)
	pipe.Expire(ctx, channelParticipantsKey(channelID), 25*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		slog.Error("failed to save voice state", "error", err)
	}

	// Publish voice state update event
	s.events.Publish(ctx, guildID, channelID, EventVoiceStateUpdate, "", state)

	// Get current participants
	participants, _ := s.GetChannelParticipants(ctx, channelID, guildID)

	// LiveKit WS URL for client connection — use public URL if available
	wsURL := s.livekitPublicURL
	if wsURL == "" {
		wsURL = s.livekitHost
		if len(wsURL) > 4 && wsURL[:5] == "https" {
			wsURL = "wss" + wsURL[5:]
		} else if len(wsURL) > 4 && wsURL[:4] == "http" {
			wsURL = "ws" + wsURL[4:]
		}
	}

	return &model.JoinResponse{
		Token:        token,
		URL:          wsURL,
		Participants: participants,
	}, nil
}

// LeaveChannel removes a user from their current voice channel.
func (s *VoiceService) LeaveChannel(ctx context.Context, userID string) error {
	state, err := s.GetUserVoiceState(ctx, userID)
	if err != nil || state == nil {
		return nil // not in any channel
	}

	// Remove from LiveKit room
	roomName := state.ChannelID
	_, err = s.roomClient.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{
		Room:     roomName,
		Identity: userID,
	})
	if err != nil {
		slog.Warn("failed to remove participant from LiveKit", "error", err)
	}

	// Remove from Redis
	pipe := s.rdb.Pipeline()
	pipe.Del(ctx, voiceStateKey(userID))
	pipe.SRem(ctx, channelParticipantsKey(state.ChannelID), userID)
	pipe.Exec(ctx)

	// Publish leave event (empty channel = left)
	leaveState := model.VoiceState{
		UserID:    userID,
		GuildID:   state.GuildID,
		ChannelID: "", // empty = left voice
	}
	s.events.Publish(ctx, state.GuildID, state.ChannelID, EventVoiceStateUpdate, "", leaveState)

	return nil
}

// UpdateVoiceState updates mute/deafen state.
func (s *VoiceService) UpdateVoiceState(ctx context.Context, userID string, selfMute, selfDeaf *bool) (*model.VoiceState, error) {
	state, err := s.GetUserVoiceState(ctx, userID)
	if err != nil || state == nil {
		return nil, fmt.Errorf("not in a voice channel")
	}

	if selfMute != nil {
		state.SelfMute = *selfMute
	}
	if selfDeaf != nil {
		state.SelfDeaf = *selfDeaf
		if *selfDeaf {
			state.SelfMute = true // deafen implies mute
		}
	}

	stateJSON, _ := json.Marshal(state)
	s.rdb.Set(ctx, voiceStateKey(userID), stateJSON, 25*time.Hour)

	// Publish state update
	s.events.Publish(ctx, state.GuildID, state.ChannelID, EventVoiceStateUpdate, "", state)

	return state, nil
}

// GetUserVoiceState returns a user's current voice state.
func (s *VoiceService) GetUserVoiceState(ctx context.Context, userID string) (*model.VoiceState, error) {
	data, err := s.rdb.Get(ctx, voiceStateKey(userID)).Bytes()
	if err != nil {
		return nil, err
	}

	var state model.VoiceState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

// GetChannelParticipants returns all users in a voice channel.
func (s *VoiceService) GetChannelParticipants(ctx context.Context, channelID, guildID string) ([]model.VoiceState, error) {
	userIDs, err := s.rdb.SMembers(ctx, channelParticipantsKey(channelID)).Result()
	if err != nil {
		return nil, err
	}

	var participants []model.VoiceState
	for _, uid := range userIDs {
		state, err := s.GetUserVoiceState(ctx, uid)
		if err != nil {
			// User state expired, clean up
			s.rdb.SRem(ctx, channelParticipantsKey(channelID), uid)
			continue
		}
		participants = append(participants, *state)
	}

	return participants, nil
}

// GetGuildVoiceStates returns all voice states for a guild (across all channels).
func (s *VoiceService) GetGuildVoiceStates(ctx context.Context, guildID string) ([]model.VoiceState, error) {
	// Get all voice channels for this guild by scanning channel participant keys
	// and checking if participants belong to this guild
	iter := s.rdb.Scan(ctx, 0, "nexe:voice:channel:*:participants", 100).Iterator()
	var states []model.VoiceState

	for iter.Next(ctx) {
		channelKey := iter.Val()
		userIDs, _ := s.rdb.SMembers(ctx, channelKey).Result()
		for _, uid := range userIDs {
			state, err := s.GetUserVoiceState(ctx, uid)
			if err != nil {
				continue
			}
			if state.GuildID == guildID {
				states = append(states, *state)
			}
		}
	}

	return states, nil
}

// UpdateStreaming updates a user's streaming state and broadcasts it.
func (s *VoiceService) UpdateStreaming(ctx context.Context, userID string, streaming bool, streamType string) (*model.VoiceState, error) {
	state, err := s.GetUserVoiceState(ctx, userID)
	if err != nil || state == nil {
		return nil, fmt.Errorf("not in a voice channel")
	}

	state.Streaming = streaming
	if streaming {
		state.StreamType = streamType
	} else {
		state.StreamType = ""
	}

	stateJSON, _ := json.Marshal(state)
	s.rdb.Set(ctx, voiceStateKey(userID), stateJSON, 25*time.Hour)

	// Publish update so everyone sees LIVE status
	s.events.Publish(ctx, state.GuildID, state.ChannelID, EventVoiceStateUpdate, "", state)

	return state, nil
}

// ServerMuteUser applies server-level mute/deafen to a user (moderator action).
func (s *VoiceService) ServerMuteUser(ctx context.Context, targetUserID string, muted, deafened *bool) (*model.VoiceState, error) {
	state, err := s.GetUserVoiceState(ctx, targetUserID)
	if err != nil || state == nil {
		return nil, fmt.Errorf("user is not in a voice channel")
	}

	if muted != nil {
		state.Muted = *muted
	}
	if deafened != nil {
		state.Deafened = *deafened
		if *deafened {
			state.Muted = true
		}
	}

	stateJSON, _ := json.Marshal(state)
	s.rdb.Set(ctx, voiceStateKey(targetUserID), stateJSON, 25*time.Hour)

	// Publish state update so the target user's client reacts
	s.events.Publish(ctx, state.GuildID, state.ChannelID, EventVoiceStateUpdate, "", state)

	return state, nil
}

// MoveUser moves a user from their current voice channel to another one.
func (s *VoiceService) MoveUser(ctx context.Context, targetUserID, newChannelID string) error {
	state, err := s.GetUserVoiceState(ctx, targetUserID)
	if err != nil || state == nil {
		return fmt.Errorf("user is not in a voice channel")
	}

	oldChannelID := state.ChannelID
	guildID := state.GuildID

	// Verify new channel is a voice channel in the same guild
	if err := s.verifyVoiceChannel(guildID, newChannelID); err != nil {
		return err
	}

	// Remove from old channel participant set
	s.rdb.SRem(ctx, channelParticipantsKey(oldChannelID), targetUserID)

	// Remove from old LiveKit room
	s.roomClient.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{
		Room:     oldChannelID,
		Identity: targetUserID,
	})

	// Update state to new channel
	state.ChannelID = newChannelID
	stateJSON, _ := json.Marshal(state)

	pipe := s.rdb.Pipeline()
	pipe.Set(ctx, voiceStateKey(targetUserID), stateJSON, 25*time.Hour)
	pipe.SAdd(ctx, channelParticipantsKey(newChannelID), targetUserID)
	pipe.Expire(ctx, channelParticipantsKey(newChannelID), 25*time.Hour)
	pipe.Exec(ctx)

	// Ensure new LiveKit room exists
	s.roomClient.CreateRoom(ctx, &livekit.CreateRoomRequest{
		Name:            newChannelID,
		EmptyTimeout:    300,
		MaxParticipants: 50,
	})

	// Publish leave event for old channel and join event for new channel
	leaveState := model.VoiceState{UserID: targetUserID, GuildID: guildID, ChannelID: ""}
	s.events.Publish(ctx, guildID, oldChannelID, EventVoiceStateUpdate, "", leaveState)
	s.events.Publish(ctx, guildID, newChannelID, EventVoiceStateUpdate, "", *state)

	return nil
}

// verifyVoiceChannel checks that the channel exists, belongs to the guild, and is type "voice".
func (s *VoiceService) verifyVoiceChannel(guildID, channelID string) error {
	url := fmt.Sprintf("%s/guilds/%s/channels", s.guildsURL, guildID)
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to verify channel: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("guild channels request failed: %d", resp.StatusCode)
	}

	var channels []struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&channels); err != nil {
		return fmt.Errorf("failed to decode channels: %w", err)
	}

	for _, ch := range channels {
		if ch.ID == channelID {
			if ch.Type != "voice" {
				return fmt.Errorf("channel is not a voice channel")
			}
			return nil
		}
	}

	return fmt.Errorf("channel not found in guild")
}

// ---------------------------------------------------------------------------
// DM Voice/Video Calls
// ---------------------------------------------------------------------------

func dmCallKey(callID string) string {
	return fmt.Sprintf("nexe:dm-call:%s", callID)
}

// StartDMCall creates a LiveKit room for a DM call and signals the recipient.
func (s *VoiceService) StartDMCall(ctx context.Context, callerID, username, channelID string, video bool) (*model.DMCallResponse, error) {
	// Leave any existing voice channel
	existing, err := s.GetUserVoiceState(ctx, callerID)
	if err == nil && existing != nil {
		s.LeaveChannel(ctx, callerID)
	}

	callID := fmt.Sprintf("dm-%s-%d", channelID, time.Now().UnixMilli())
	roomName := callID

	// Create LiveKit room (small, short-lived)
	_, err = s.roomClient.CreateRoom(ctx, &livekit.CreateRoomRequest{
		Name:            roomName,
		EmptyTimeout:    60, // 1 minute empty = destroy
		MaxParticipants: 10, // group DMs
	})
	if err != nil {
		slog.Warn("dm call room create error", "error", err)
	}

	// Generate token for caller
	at := auth.NewAccessToken(s.livekitKey, s.livekitSecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     roomName,
	}
	at.AddGrant(grant).
		SetIdentity(callerID).
		SetName(username).
		SetValidFor(2 * time.Hour)

	token, err := at.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("failed to generate dm call token: %w", err)
	}

	// Store call state in Redis
	callData, _ := json.Marshal(model.DMCallSignal{
		Type:      "ring",
		CallID:    callID,
		ChannelID: channelID,
		CallerID:  callerID,
		Video:     video,
	})
	s.rdb.Set(ctx, dmCallKey(callID), callData, 2*time.Minute) // ring expires in 2 min

	// Publish ring event to the DM channel
	s.events.Publish(ctx, "", channelID, "DM_CALL_RING", callerID, model.DMCallSignal{
		Type:      "ring",
		CallID:    callID,
		ChannelID: channelID,
		CallerID:  callerID,
		Video:     video,
	})

	return &model.DMCallResponse{
		CallID: callID,
		Token:  token,
		URL:    s.livekitPublicURL,
	}, nil
}

// AcceptDMCall generates a token for the callee to join the DM call.
func (s *VoiceService) AcceptDMCall(ctx context.Context, userID, username, callID string) (*model.DMCallResponse, error) {
	// Verify call exists
	data, err := s.rdb.Get(ctx, dmCallKey(callID)).Result()
	if err != nil {
		return nil, fmt.Errorf("call not found or expired")
	}

	var signal model.DMCallSignal
	json.Unmarshal([]byte(data), &signal)

	// Generate token
	at := auth.NewAccessToken(s.livekitKey, s.livekitSecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     callID,
	}
	at.AddGrant(grant).
		SetIdentity(userID).
		SetName(username).
		SetValidFor(2 * time.Hour)

	token, err := at.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("failed to generate accept token: %w", err)
	}

	// Publish accept event
	s.events.Publish(ctx, "", signal.ChannelID, "DM_CALL_ACCEPT", userID, model.DMCallSignal{
		Type:      "accept",
		CallID:    callID,
		ChannelID: signal.ChannelID,
		CallerID:  signal.CallerID,
	})

	// Extend call TTL
	s.rdb.Expire(ctx, dmCallKey(callID), 2*time.Hour)

	return &model.DMCallResponse{
		CallID: callID,
		Token:  token,
		URL:    s.livekitPublicURL,
	}, nil
}

// RejectDMCall signals the caller that the call was rejected.
func (s *VoiceService) RejectDMCall(ctx context.Context, userID, callID string) error {
	data, err := s.rdb.Get(ctx, dmCallKey(callID)).Result()
	if err != nil {
		return nil
	}

	var signal model.DMCallSignal
	json.Unmarshal([]byte(data), &signal)

	s.events.Publish(ctx, "", signal.ChannelID, "DM_CALL_REJECT", userID, model.DMCallSignal{
		Type:      "reject",
		CallID:    callID,
		ChannelID: signal.ChannelID,
		CallerID:  signal.CallerID,
	})

	s.rdb.Del(ctx, dmCallKey(callID))
	return nil
}

// EndDMCall terminates the call for all participants.
func (s *VoiceService) EndDMCall(ctx context.Context, userID, callID string) error {
	data, err := s.rdb.Get(ctx, dmCallKey(callID)).Result()
	if err != nil {
		return nil
	}

	var signal model.DMCallSignal
	json.Unmarshal([]byte(data), &signal)

	s.events.Publish(ctx, "", signal.ChannelID, "DM_CALL_END", userID, model.DMCallSignal{
		Type:      "end",
		CallID:    callID,
		ChannelID: signal.ChannelID,
		CallerID:  signal.CallerID,
	})

	// Destroy LiveKit room
	s.roomClient.DeleteRoom(ctx, &livekit.DeleteRoomRequest{Room: callID})
	s.rdb.Del(ctx, dmCallKey(callID))
	return nil
}
