package service

import (
	"testing"
)

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{"valid password", "Password1", false},
		{"valid complex", "MyStr0ngP@ss!", false},
		{"too short", "Pa1", true},
		{"no uppercase", "password1", true},
		{"no digit", "Password", true},
		{"empty", "", true},
		{"only digits", "12345678", true},
		{"only uppercase", "ABCDEFGH", true},
		{"min valid length", "Abcdefg1", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePassword(tt.password)
			if (err != nil) != tt.wantErr {
				t.Errorf("validatePassword(%q) error = %v, wantErr %v", tt.password, err, tt.wantErr)
			}
		})
	}
}
