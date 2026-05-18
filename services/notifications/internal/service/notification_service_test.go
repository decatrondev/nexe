package service

import (
	"reflect"
	"testing"
)

func TestParseMentionUsers(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []string
	}{
		{"no mentions", "hello world", nil},
		{"single mention", "hello <@abc-123> world", []string{"abc-123"}},
		{"multiple mentions", "<@user1> and <@user2>", []string{"user1", "user2"}},
		{"skip role mentions", "<@&role1> <@user1>", []string{"user1"}},
		{"mixed content", "hey <@user1> check <@&admin> and <@user2>!", []string{"user1", "user2"}},
		{"empty", "", nil},
		{"unclosed mention", "hello <@user1", nil},
		{"everyone", "@everyone no angle brackets", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseMentionUsers(tt.content)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseMentionUsers(%q) = %v, want %v", tt.content, got, tt.want)
			}
		})
	}
}

func TestParseMentionRoles(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []string
	}{
		{"no roles", "hello world", nil},
		{"single role", "hey <@&role-1>", []string{"role-1"}},
		{"skip user mentions", "<@user1> <@&role1>", []string{"role1"}},
		{"multiple roles", "<@&admin> and <@&mod>", []string{"admin", "mod"}},
		{"empty", "", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseMentionRoles(tt.content)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseMentionRoles(%q) = %v, want %v", tt.content, got, tt.want)
			}
		})
	}
}
