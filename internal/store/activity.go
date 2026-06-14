package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ActivityRecord represents a single activity log entry.
type ActivityRecord struct {
	Timestamp string `json:"timestamp"`
	UserID    string `json:"user_id"`
	UserLogin string `json:"user_login"`
	Action    string `json:"action"`
	VMName    string `json:"vm_name"`
	Status    string `json:"status"`
	Error     string `json:"error"`
	Metadata  string `json:"metadata"`
}

// ActivityFilter holds optional filters for Query.
type ActivityFilter struct {
	Limit   int
	Offset  int
	Action  string
	VMName  string
	Status  string
	UserID  string
	Since   string // RFC3339Nano start
	Until   string // RFC3339Nano end
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
	    user_id   TEXT    NOT NULL DEFAULT '',
	    user_login TEXT   NOT NULL DEFAULT '',
	    action    TEXT    NOT NULL,
	    vm_name   TEXT    NOT NULL,
	    status    TEXT    NOT NULL,
	    error     TEXT    NOT NULL DEFAULT '',
	    metadata  TEXT    NOT NULL DEFAULT ''
	);
	CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_activity_action    ON activity(action);
	CREATE INDEX IF NOT EXISTS idx_activity_vm_name   ON activity(vm_name);
	CREATE INDEX IF NOT EXISTS idx_activity_user_id   ON activity(user_id);
	CREATE INDEX IF NOT EXISTS idx_activity_status    ON activity(status);
	`)
	if err != nil {
		return err
	}

	// Migrate existing tables that lack the new columns
	migrations := []string{
		"ALTER TABLE activity ADD COLUMN user_id TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE activity ADD COLUMN user_login TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE activity ADD COLUMN metadata TEXT NOT NULL DEFAULT ''",
	}
	for _, m := range migrations {
		db.Exec(m) // column may already exist from a previous run
	}
	return nil
}

// Add inserts a new activity record and trims old entries.
func (s *ActivityStore) Add(userID, userLogin, action, vmName, status, errMsg, metadata string) error {
	unlock := lockSQLiteWrite()
	defer unlock()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.Exec(
		`INSERT INTO activity(timestamp,user_id,user_login,action,vm_name,status,error,metadata) VALUES(?,?,?,?,?,?,?,?)`,
		now, userID, userLogin, action, vmName, status, errMsg, metadata,
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

// Query returns filtered activity records plus a total count.
func (s *ActivityStore) Query(filter ActivityFilter) ([]ActivityRecord, int, error) {
	if filter.Limit < 1 {
		filter.Limit = 50
	}
	if filter.Limit > 1000 {
		filter.Limit = 1000
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}

	var wheres []string
	var args []any

	if filter.Action != "" {
		wheres = append(wheres, "action = ?")
		args = append(args, filter.Action)
	}
	if filter.VMName != "" {
		wheres = append(wheres, "vm_name = ?")
		args = append(args, filter.VMName)
	}
	if filter.Status != "" {
		wheres = append(wheres, "status = ?")
		args = append(args, filter.Status)
	}
	if filter.UserID != "" {
		wheres = append(wheres, "user_id = ?")
		args = append(args, filter.UserID)
	}
	if filter.Since != "" {
		wheres = append(wheres, "timestamp >= ?")
		args = append(args, filter.Since)
	}
	if filter.Until != "" {
		wheres = append(wheres, "timestamp <= ?")
		args = append(args, filter.Until)
	}

	whereClause := ""
	if len(wheres) > 0 {
		whereClause = " WHERE " + strings.Join(wheres, " AND ")
	}

	// Count total
	var total int
	countQuery := "SELECT COUNT(*) FROM activity" + whereClause
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Select with pagination
	selectQuery := "SELECT timestamp,user_id,user_login,action,vm_name,status,error,metadata FROM activity" + whereClause + " ORDER BY id DESC LIMIT ? OFFSET ?"
	args = append(args, filter.Limit, filter.Offset)

	rows, err := s.db.Query(selectQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var records []ActivityRecord
	for rows.Next() {
		var r ActivityRecord
		if err := rows.Scan(&r.Timestamp, &r.UserID, &r.UserLogin, &r.Action, &r.VMName, &r.Status, &r.Error, &r.Metadata); err != nil {
			return nil, 0, err
		}
		records = append(records, r)
	}
	return records, total, rows.Err()
}

// List returns the most recent activity records, with optional filters. Deprecated: use Query.
func (s *ActivityStore) List(limit int, action, vmName string) ([]ActivityRecord, error) {
	records, _, err := s.Query(ActivityFilter{Limit: limit, Action: action, VMName: vmName})
	return records, err
}

// Close closes the underlying database.
func (s *ActivityStore) Close() error { return s.db.Close() }
