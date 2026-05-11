package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

// GenerateTOTPSecret creates a new TOTP secret and returns the secret + QR provisioning URI.
func GenerateTOTPSecret(username string) (secret string, uri string, err error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "Nexe",
		AccountName: username,
	})
	if err != nil {
		return "", "", fmt.Errorf("generate TOTP: %w", err)
	}
	return key.Secret(), key.URL(), nil
}

// ValidateTOTP checks if a 6-digit code is valid for the given secret.
func ValidateTOTP(code, secret string) bool {
	return totp.Validate(code, secret)
}

// CheckPasswordHash compares a plaintext password with a bcrypt hash.
func CheckPasswordHash(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// GenerateRecoveryCodes creates n random recovery codes.
func GenerateRecoveryCodes(n int) ([]string, error) {
	codes := make([]string, n)
	for i := 0; i < n; i++ {
		b := make([]byte, 4)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		codes[i] = hex.EncodeToString(b)
	}
	return codes, nil
}
