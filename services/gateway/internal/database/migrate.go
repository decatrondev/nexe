package database

import (
	"database/sql"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"sort"
	"strings"
)

// AutoMigrate looks for a migrations directory relative to the binary and runs pending migrations.
func AutoMigrate(db *sql.DB) error {
	// Try common locations
	for _, dir := range []string{"migrations", "../migrations", "services/gateway/migrations"} {
		info, err := os.Stat(dir)
		if err == nil && info.IsDir() {
			slog.Info("found migrations directory", "path", dir)
			return RunMigrations(db, os.DirFS(dir))
		}
	}
	slog.Debug("no migrations directory found, skipping auto-migrate")
	return nil
}

// RunMigrations executes all .up.sql files from the filesystem that haven't been applied yet.
func RunMigrations(db *sql.DB, migrations fs.FS) error {
	// Create tracking table
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS nexe_migrations (
		filename TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`)
	if err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	// Find all .up.sql files
	var files []string
	err = fs.WalkDir(migrations, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(path, ".up.sql") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("failed to walk migrations: %w", err)
	}
	sort.Strings(files)

	applied := 0
	for _, file := range files {
		// Check if already applied
		var exists bool
		db.QueryRow("SELECT EXISTS(SELECT 1 FROM nexe_migrations WHERE filename = $1)", file).Scan(&exists)
		if exists {
			continue
		}

		// Read and execute
		content, err := fs.ReadFile(migrations, file)
		if err != nil {
			return fmt.Errorf("failed to read migration %s: %w", file, err)
		}

		if _, err := db.Exec(string(content)); err != nil {
			return fmt.Errorf("failed to apply migration %s: %w", file, err)
		}

		if _, err := db.Exec("INSERT INTO nexe_migrations (filename) VALUES ($1)", file); err != nil {
			return fmt.Errorf("failed to record migration %s: %w", file, err)
		}

		slog.Info("applied migration", "file", file)
		applied++
	}

	if applied > 0 {
		slog.Info("migrations complete", "applied", applied)
	}
	return nil
}
