package store

import (
	"database/sql"
	"fmt"
	"time"
)

// AppSettingsStore persists application-level settings in SQLite.
type AppSettingsStore struct {
	db *sql.DB
}

func NewAppSettingsStore(dbPath string) (*AppSettingsStore, error) {
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_foreign_keys=ON&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open app settings db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS app_settings (
	key        TEXT PRIMARY KEY,
	value      TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL
);
`); err != nil {
		db.Close()
		return nil, err
	}
	return &AppSettingsStore{db: db}, nil
}

func (s *AppSettingsStore) Get(key string) (string, bool, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (s *AppSettingsStore) Set(key, value string) error {
	unlock := lockSQLiteWrite()
	defer unlock()

	_, err := s.db.Exec(
		`INSERT INTO app_settings(key, value, updated_at)
		 VALUES(?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, appSettingsNowUTC(),
	)
	return err
}

func (s *AppSettingsStore) SetMany(values map[string]string) error {
	unlock := lockSQLiteWrite()
	defer unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	ts := appSettingsNowUTC()
	for key, value := range values {
		if _, err := tx.Exec(
			`INSERT INTO app_settings(key, value, updated_at)
			 VALUES(?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			key, value, ts,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *AppSettingsStore) GetMany(keys []string) (map[string]string, error) {
	out := make(map[string]string, len(keys))
	for _, key := range keys {
		value, ok, err := s.Get(key)
		if err != nil {
			return nil, err
		}
		if ok {
			out[key] = value
		}
	}
	return out, nil
}

func appSettingsNowUTC() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func (s *AppSettingsStore) Close() error { return s.db.Close() }
