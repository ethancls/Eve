package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// ActivityRecord represents a single activity log entry.
type ActivityRecord struct {
	Timestamp string `json:"timestamp"`
	Action    string `json:"action"`
	VMName    string `json:"vm_name"`
	Status    string `json:"status"`
	Error     string `json:"error"`
}

// ActivityStore persists activity records in SQLite.
type ActivityStore struct {
	db        *sql.DB
	retention int
}

// NewActivityStore opens the SQLite database and initialises the activity table.
func NewActivityStore(dbPath string, retention int) (*ActivityStore, error) {
	if retention < 100 {
		retention = 100
	}
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_foreign_keys=ON&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open activity db: %w", err)
	}
	db.SetMaxOpenConns(1) // serialise writes
	if err := initActivityDB(db); err != nil {
		db.Close()
		return nil, err
	}
	return &ActivityStore{db: db, retention: retention}, nil
}

func initActivityDB(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS activity (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL,
    action    TEXT    NOT NULL,
    vm_name   TEXT    NOT NULL,
    status    TEXT    NOT NULL,
    error     TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action    ON activity(action);
CREATE INDEX IF NOT EXISTS idx_activity_vm_name   ON activity(vm_name);
`)
	return err
}

// Add inserts a new activity record and trims old entries.
func (s *ActivityStore) Add(action, vmName, status, errMsg string) error {
	unlock := lockSQLiteWrite()
	defer unlock()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.Exec(
		`INSERT INTO activity(timestamp,action,vm_name,status,error) VALUES(?,?,?,?,?)`,
		now, action, vmName, status, errMsg,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`
DELETE FROM activity WHERE id NOT IN (
    SELECT id FROM activity ORDER BY id DESC LIMIT ?
)`, s.retention); err != nil {
		return err
	}
	return tx.Commit()
}

// List returns the most recent activity records, with optional filters.
func (s *ActivityStore) List(limit int, action, vmName string) ([]ActivityRecord, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 1000 {
		limit = 1000
	}

	query := `SELECT timestamp,action,vm_name,status,error FROM activity`
	var where []string
	var args []any
	if action != "" {
		where = append(where, "action = ?")
		args = append(args, action)
	}
	if vmName != "" {
		where = append(where, "vm_name = ?")
		args = append(args, vmName)
	}
	if len(where) > 0 {
		query += " WHERE " + where[0]
		for _, w := range where[1:] {
			query += " AND " + w
		}
	}
	query += " ORDER BY id DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []ActivityRecord
	for rows.Next() {
		var r ActivityRecord
		if err := rows.Scan(&r.Timestamp, &r.Action, &r.VMName, &r.Status, &r.Error); err != nil {
			return nil, err
		}
		records = append(records, r)
	}
	return records, rows.Err()
}

// Close closes the underlying database.
func (s *ActivityStore) Close() error { return s.db.Close() }
