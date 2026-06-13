package store

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
)

// Template represents an instance launch template.
type Template struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CPUs        int    `json:"cpus"`
	MemoryMB    int    `json:"memory_mb"`
	DiskGB      int    `json:"disk_gb"`
	Image       string `json:"image"`
	Tier        string `json:"tier"`
	IsBuiltin   bool   `json:"is_builtin"`
}

var builtinTemplates = []Template{
	{"builtin-nano", "nano", "Ultra-lightweight for quick tests", 1, 512, 10, "24.04", "nano", true},
	{"builtin-micro", "micro", "Minimal services and CLIs", 1, 1024, 10, "24.04", "micro", true},
	{"builtin-small", "small", "Small workloads and dev environments", 2, 2048, 20, "24.04", "small", true},
	{"builtin-medium", "medium", "General purpose — most common choice", 2, 4096, 40, "24.04", "medium", true},
	{"builtin-large", "large", "Compute-intensive builds and services", 4, 8192, 80, "24.04", "large", true},
	{"builtin-xlarge", "xlarge", "High-performance workloads", 8, 16384, 100, "24.04", "xlarge", true},
	{"builtin-2xlarge", "2xlarge", "Memory-optimized, heavy compilation", 16, 32768, 200, "24.04", "2xlarge", true},
}

// TemplateStore persists custom templates in SQLite.
type TemplateStore struct {
	db *sql.DB
}

// NewTemplateStore opens the SQLite database and initialises the templates table.
func NewTemplateStore(dbPath string) (*TemplateStore, error) {
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open templates db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cpus        INTEGER NOT NULL DEFAULT 1,
    memory_mb   INTEGER NOT NULL DEFAULT 1024,
    disk_gb     INTEGER NOT NULL DEFAULT 10,
    image       TEXT NOT NULL DEFAULT '24.04',
    tier        TEXT NOT NULL DEFAULT ''
)`); err != nil {
		db.Close()
		return nil, err
	}
	return &TemplateStore{db: db}, nil
}

// ListAll returns builtin templates followed by custom ones.
func (s *TemplateStore) ListAll() ([]Template, error) {
	rows, err := s.db.Query(
		`SELECT id,name,description,cpus,memory_mb,disk_gb,image,tier FROM templates ORDER BY rowid`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Template, 0, len(builtinTemplates)+4)
	result = append(result, builtinTemplates...)
	for rows.Next() {
		var t Template
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.CPUs, &t.MemoryMB, &t.DiskGB, &t.Image, &t.Tier); err != nil {
			return nil, err
		}
		t.IsBuiltin = false
		result = append(result, t)
	}
	return result, rows.Err()
}

// Create inserts a new custom template and returns it.
func (s *TemplateStore) Create(name, description, image, tier string, cpus, memoryMB, diskGB int) (Template, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	t := Template{
		ID:          uuid.New().String(),
		Name:        name,
		Description: description,
		CPUs:        cpus,
		MemoryMB:    memoryMB,
		DiskGB:      diskGB,
		Image:       image,
		Tier:        tier,
		IsBuiltin:   false,
	}
	_, err := s.db.Exec(
		`INSERT INTO templates(id,name,description,cpus,memory_mb,disk_gb,image,tier) VALUES(?,?,?,?,?,?,?,?)`,
		t.ID, t.Name, t.Description, t.CPUs, t.MemoryMB, t.DiskGB, t.Image, t.Tier,
	)
	return t, err
}

// Delete removes a custom template by ID. Returns true if a row was deleted.
func (s *TemplateStore) Delete(id string) (bool, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	res, err := s.db.Exec(`DELETE FROM templates WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// Close closes the underlying database.
func (s *TemplateStore) Close() error { return s.db.Close() }
