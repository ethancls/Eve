package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type WebAuthnCredential struct {
	ID           string `json:"id"`
	UserID       string `json:"user_id"`
	CredentialID []byte `json:"-"`
	Name         string `json:"name"`
	Credential   *webauthn.Credential
	SignCount    uint32 `json:"-"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
	LastUsedAt   string `json:"last_used_at"`
}

type WebAuthnStore struct {
	db *sql.DB
}

func NewWebAuthnStore(dbPath string) (*WebAuthnStore, error) {
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_foreign_keys=ON&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open webauthn db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS webauthn_credentials (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			credential_id BLOB NOT NULL UNIQUE,
			name TEXT NOT NULL DEFAULT '',
			credential_json TEXT NOT NULL,
			sign_count INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_used_at TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE IF NOT EXISTS webauthn_sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT,
			login TEXT,
			purpose TEXT NOT NULL,
			session_json TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_wc_user_id ON webauthn_credentials(user_id);
		CREATE INDEX IF NOT EXISTS idx_ws_expires ON webauthn_sessions(expires_at);
	`); err != nil {
		db.Close()
		return nil, err
	}
	return &WebAuthnStore{db: db}, nil
}

func (s *WebAuthnStore) CreateCredential(userID, name string, cred *webauthn.Credential) (string, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	jsonData, _ := json.Marshal(cred)
	ts := time.Now().UTC().Format(time.RFC3339Nano)
	id := uuid.NewString()

	// UPSERT: if credential_id already exists for this user, update it
	existing, _ := s.GetCredentialByID(cred.ID)
	if existing != nil {
		_, err := s.db.Exec(
			`UPDATE webauthn_credentials SET name=?, credential_json=?, sign_count=?, updated_at=?
			 WHERE credential_id=?`,
			name, string(jsonData), cred.Authenticator.SignCount, ts, cred.ID,
		)
		return existing.ID, err
	}

	_, err := s.db.Exec(
		`INSERT INTO webauthn_credentials(id,user_id,credential_id,name,credential_json,sign_count,created_at,updated_at,last_used_at)
		 VALUES(?,?,?,?,?,?,?,?,?)`,
		id, userID, cred.ID, name, string(jsonData), cred.Authenticator.SignCount, ts, ts, "",
	)
	return id, err
}

func (s *WebAuthnStore) GetCredentialsByUser(userID string) ([]WebAuthnCredential, error) {
	rows, err := s.db.Query(
		`SELECT id,user_id,credential_id,name,credential_json,sign_count,created_at,updated_at,last_used_at
		 FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCredentials(rows)
}

func (s *WebAuthnStore) GetCredentialByID(credentialID []byte) (*WebAuthnCredential, error) {
	row := s.db.QueryRow(
		`SELECT id,user_id,credential_id,name,credential_json,sign_count,created_at,updated_at,last_used_at
		 FROM webauthn_credentials WHERE credential_id = ?`, credentialID,
	)
	var c WebAuthnCredential
	var credJSON string
	err := row.Scan(&c.ID, &c.UserID, &c.CredentialID, &c.Name, &credJSON, &c.SignCount, &c.CreatedAt, &c.UpdatedAt, &c.LastUsedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var cred webauthn.Credential
	if err := json.Unmarshal([]byte(credJSON), &cred); err != nil {
		return nil, err
	}
	c.Credential = &cred
	return &c, nil
}

func (s *WebAuthnStore) UpdateCredential(cred *webauthn.Credential) error {
	unlock := lockSQLiteWrite()
	defer unlock()

	jsonData, _ := json.Marshal(cred)
	ts := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.Exec(
		`UPDATE webauthn_credentials SET credential_json=?, sign_count=?, updated_at=?, last_used_at=? WHERE credential_id=?`,
		string(jsonData), cred.Authenticator.SignCount, ts, ts, cred.ID,
	)
	return err
}

func (s *WebAuthnStore) DeleteCredential(id string) error {
	unlock := lockSQLiteWrite()
	defer unlock()
	_, err := s.db.Exec(`DELETE FROM webauthn_credentials WHERE id = ?`, id)
	return err
}

func (s *WebAuthnStore) DeleteUserCredentials(userID string) error {
	unlock := lockSQLiteWrite()
	defer unlock()
	_, err := s.db.Exec(`DELETE FROM webauthn_credentials WHERE user_id = ?`, userID)
	return err
}

func (s *WebAuthnStore) CountCredentialsByUser(userID string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = ?`, userID).Scan(&n)
	return n, err
}

// ---- sessions ----

func (s *WebAuthnStore) CreateSession(session *webauthn.SessionData, userID, login, purpose string) (string, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	id := uuid.NewString()
	jsonData, _ := json.Marshal(session)
	ts := time.Now().UTC().Format(time.RFC3339Nano)
	exp := time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339Nano)
	_, err := s.db.Exec(
		`INSERT INTO webauthn_sessions(id,user_id,login,purpose,session_json,expires_at,created_at)
		 VALUES(?,?,?,?,?,?,?)`,
		id, userID, login, purpose, string(jsonData), exp, ts,
	)
	return id, err
}

func (s *WebAuthnStore) GetSession(id string) (*webauthn.SessionData, string, string, error) {
	var userID, login, purpose, jsonData, expiresAt string
	err := s.db.QueryRow(
		`SELECT user_id,login,purpose,session_json,expires_at FROM webauthn_sessions WHERE id = ?`, id,
	).Scan(&userID, &login, &purpose, &jsonData, &expiresAt)
	if err == sql.ErrNoRows {
		return nil, "", "", nil
	}
	if err != nil {
		return nil, "", "", err
	}
	var sd webauthn.SessionData
	if err := json.Unmarshal([]byte(jsonData), &sd); err != nil {
		return nil, "", "", err
	}
	return &sd, userID, purpose, nil
}

func (s *WebAuthnStore) DeleteSession(id string) error {
	unlock := lockSQLiteWrite()
	defer unlock()
	_, err := s.db.Exec(`DELETE FROM webauthn_sessions WHERE id = ?`, id)
	return err
}

func (s *WebAuthnStore) DeleteExpiredSessions() {
	s.db.Exec(`DELETE FROM webauthn_sessions WHERE expires_at < ?`, time.Now().UTC().Format(time.RFC3339Nano))
}

func (s *WebAuthnStore) Close() error { return s.db.Close() }

func scanCredentials(rows *sql.Rows) ([]WebAuthnCredential, error) {
	var list []WebAuthnCredential
	for rows.Next() {
		var c WebAuthnCredential
		var credJSON string
		if err := rows.Scan(&c.ID, &c.UserID, &c.CredentialID, &c.Name, &credJSON, &c.SignCount, &c.CreatedAt, &c.UpdatedAt, &c.LastUsedAt); err != nil {
			return nil, err
		}
		var cred webauthn.Credential
		if err := json.Unmarshal([]byte(credJSON), &cred); err != nil {
			return nil, err
		}
		c.Credential = &cred
		list = append(list, c)
	}
	return list, rows.Err()
}
