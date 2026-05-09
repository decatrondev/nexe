package database

import (
	"database/sql"
	"fmt"
	"log/slog"

	_ "github.com/lib/pq"
)

func NewPostgres(dbURL string) (*sql.DB, error) {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	slog.Info("connected to PostgreSQL")
	return db, nil
}
