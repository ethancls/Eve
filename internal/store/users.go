package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

var loginRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,30}$`)

const (
	passwordHashAlgo       = "sha256"
	passwordHashIterations = 180000
	passwordSaltSize       = 16
)

const (
	RoleUser          = "user"
	RoleAdministrator = "administrator"
	RoleOwner         = "owner"
)

var (
	ErrUserNotFound          = errors.New("user not found")
	ErrInvalidCredentials    = errors.New("invalid credentials")
	ErrInvalidLogin          = errors.New("invalid login")
	ErrInvalidPassword       = errors.New("invalid password")
	ErrInvalidRole           = errors.New("invalid role")
	ErrInvalidAvatarURL      = errors.New("invalid avatar URL")
	ErrInvalidOIDCIdentity   = errors.New("oidc issuer and subject must both be set")
	ErrPasswordRequired      = errors.New("password is required for local users")
	ErrCannotDeleteLastOwner = errors.New("cannot delete the last owner user")
	ErrCannotDemoteLastOwner = errors.New("cannot demote the last owner user")
)

type User struct {
	ID          string `json:"id"`
	Login       string `json:"login"`
	HasPassword bool   `json:"has_password"`
	Name        string `json:"name"`
	AvatarURL   string `json:"avatar_url"`
	OIDCIssuer  string `json:"oidc_issuer"`
	OIDCSubject string `json:"oidc_subject"`
	Role        string `json:"role"`
	LastLogin   string `json:"last_login"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type CreateUserInput struct {
	Login       string
	Password    string
	Name        string
	AvatarURL   string
	OIDCIssuer  string
	OIDCSubject string
	Role        string
}

type UpdateUserInput struct {
	Login       string
	Name        string
	AvatarURL   string
	OIDCIssuer  string
	OIDCSubject string
	Role        string
}

type userWithSecret struct {
	User
	PasswordHash string
}

type UserStore struct {
	db *sql.DB
}

func NewUserStore(dbPath string) (*UserStore, error) {
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL&_foreign_keys=ON&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open users db: %w", err)
	}
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS users (
	id            TEXT PRIMARY KEY,
	login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
	password_hash TEXT NOT NULL DEFAULT '',
	name          TEXT NOT NULL DEFAULT '',
	avatar_url    TEXT NOT NULL DEFAULT '',
	oidc_issuer   TEXT NOT NULL DEFAULT '',
	oidc_subject  TEXT NOT NULL DEFAULT '',
	role          TEXT NOT NULL DEFAULT 'user',
	last_login    TEXT NOT NULL DEFAULT '',
	created_at    TEXT NOT NULL,
	updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_identity
	ON users(oidc_issuer, oidc_subject)
	WHERE oidc_issuer <> '' AND oidc_subject <> '';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
`); err != nil {
		db.Close()
		return nil, err
	}

	return &UserStore{db: db}, nil
}

func normalizeLogin(login string) string {
	return strings.ToLower(strings.TrimSpace(login))
}

func validateLogin(login string) error {
	if !loginRe.MatchString(login) {
		return ErrInvalidLogin
	}
	return nil
}

func normalizeAvatarURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", ErrInvalidAvatarURL
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", ErrInvalidAvatarURL
	}
	return raw, nil
}

func normalizeOIDC(issuer, subject string) (string, string, error) {
	issuer = strings.TrimSpace(issuer)
	subject = strings.TrimSpace(subject)
	if (issuer == "") != (subject == "") {
		return "", "", ErrInvalidOIDCIdentity
	}
	return issuer, subject, nil
}

func normalizeRole(role string) string {
	role = strings.ToLower(strings.TrimSpace(role))
	switch role {
	case "":
		return RoleUser
	case "admin":
		return RoleAdministrator
	default:
		return role
	}
}

func validateRole(role string) error {
	if !IsValidRole(role) {
		return ErrInvalidRole
	}
	return nil
}

func IsValidRole(role string) bool {
	switch role {
	case RoleUser, RoleAdministrator, RoleOwner:
		return true
	default:
		return false
	}
}

func HasAdminPrivileges(role string) bool {
	return RoleRank(role) >= RoleRank(RoleAdministrator)
}

func RoleRank(role string) int {
	switch normalizeRole(role) {
	case RoleOwner:
		return 30
	case RoleAdministrator:
		return 20
	default:
		return 10
	}
}

func IsOwner(role string) bool {
	return normalizeRole(role) == RoleOwner
}

func hashPassword(password string) (string, error) {
	if len(strings.TrimSpace(password)) < 4 {
		return "", ErrInvalidPassword
	}
	salt := make([]byte, passwordSaltSize)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	sum := passwordDigest(salt, passwordHashIterations, password)
	return fmt.Sprintf(
		"%s$%d$%s$%s",
		passwordHashAlgo,
		passwordHashIterations,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(sum),
	), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != passwordHashAlgo {
		return false
	}
	iterations := 0
	if _, err := fmt.Sscanf(parts[1], "%d", &iterations); err != nil || iterations < 1 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got := passwordDigest(salt, iterations, password)
	if len(got) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(got, expected) == 1
}

func passwordDigest(salt []byte, iterations int, password string) []byte {
	d := sha256.Sum256(append(append([]byte{}, salt...), []byte(password)...))
	out := d[:]
	for i := 1; i < iterations; i++ {
		h := sha256.New()
		h.Write(out)
		h.Write([]byte(password))
		h.Write(salt)
		out = h.Sum(nil)
	}
	return out
}

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func scanUser(row scanner) (User, string, error) {
	var u User
	var passwordHash string
	err := row.Scan(
		&u.ID,
		&u.Login,
		&passwordHash,
		&u.Name,
		&u.AvatarURL,
		&u.OIDCIssuer,
		&u.OIDCSubject,
		&u.Role,
		&u.LastLogin,
		&u.CreatedAt,
		&u.UpdatedAt,
	)
	u.Role = normalizeRole(u.Role)
	u.HasPassword = passwordHash != ""
	return u, passwordHash, err
}

type scanner interface {
	Scan(dest ...any) error
}

func (s *UserStore) EnsureDefaultOwner(login, password, name string) (bool, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	login = normalizeLogin(login)
	if err := validateLogin(login); err != nil {
		return false, err
	}
	pwHash, err := hashPassword(password)
	if err != nil {
		return false, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Eve Owner"
	}

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return false, err
	}
	if count > 0 {
		return false, nil
	}

	ts := nowUTC()
	_, err = s.db.Exec(
		`INSERT INTO users(id,login,password_hash,name,avatar_url,oidc_issuer,oidc_subject,role,last_login,created_at,updated_at)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		uuid.NewString(), login, pwHash, name, "", "", "", RoleOwner, "", ts, ts,
	)
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *UserStore) EnsureDefaultAdmin(login, password, name string) (bool, error) {
	return s.EnsureDefaultOwner(login, password, name)
}

func (s *UserStore) List() ([]User, error) {
	rows, err := s.db.Query(
		`SELECT id,login,password_hash,name,avatar_url,oidc_issuer,oidc_subject,role,last_login,created_at,updated_at
		 FROM users ORDER BY lower(login) ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		u, _, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *UserStore) GetByID(id string) (User, bool, error) {
	row := s.db.QueryRow(
		`SELECT id,login,password_hash,name,avatar_url,oidc_issuer,oidc_subject,role,last_login,created_at,updated_at
		 FROM users WHERE id = ?`,
		id,
	)
	u, _, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, false, nil
	}
	return u, err == nil, err
}

func (s *UserStore) GetByLogin(login string) (User, bool, error) {
	login = normalizeLogin(login)
	row := s.db.QueryRow(
		`SELECT id,login,password_hash,name,avatar_url,oidc_issuer,oidc_subject,role,last_login,created_at,updated_at
		 FROM users WHERE lower(login) = lower(?)`,
		login,
	)
	u, _, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, false, nil
	}
	return u, err == nil, err
}

func (s *UserStore) getByIDWithSecret(id string) (userWithSecret, bool, error) {
	row := s.db.QueryRow(
		`SELECT id,login,password_hash,name,avatar_url,oidc_issuer,oidc_subject,role,last_login,created_at,updated_at
		 FROM users WHERE id = ?`,
		id,
	)
	u, pw, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return userWithSecret{}, false, nil
	}
	if err != nil {
		return userWithSecret{}, false, err
	}
	return userWithSecret{User: u, PasswordHash: pw}, true, nil
}

func (s *UserStore) getByLoginWithSecret(login string) (userWithSecret, bool, error) {
	login = normalizeLogin(login)
	row := s.db.QueryRow(
		`SELECT id,login,password_hash,name,avatar_url,oidc_issuer,oidc_subject,role,last_login,created_at,updated_at
		 FROM users WHERE lower(login) = lower(?)`,
		login,
	)
	u, pw, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return userWithSecret{}, false, nil
	}
	if err != nil {
		return userWithSecret{}, false, err
	}
	return userWithSecret{User: u, PasswordHash: pw}, true, nil
}

func (s *UserStore) GetByOIDC(issuer, subject string) (User, bool, error) {
	issuer, subject, err := normalizeOIDC(issuer, subject)
	if err != nil {
		return User{}, false, err
	}
	if issuer == "" {
		return User{}, false, nil
	}
	row := s.db.QueryRow(
		`SELECT id,login,password_hash,name,avatar_url,oidc_issuer,oidc_subject,role,last_login,created_at,updated_at
		 FROM users WHERE oidc_issuer = ? AND oidc_subject = ?`,
		issuer, subject,
	)
	u, _, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, false, nil
	}
	return u, err == nil, err
}

func (s *UserStore) Authenticate(login, password string) (User, error) {
	u, ok, err := s.getByLoginWithSecret(login)
	if err != nil {
		return User{}, err
	}
	if !ok || u.PasswordHash == "" || !verifyPassword(password, u.PasswordHash) {
		return User{}, ErrInvalidCredentials
	}
	return u.User, nil
}

func (s *UserStore) CheckPassword(userID, password string) (bool, error) {
	u, ok, err := s.getByIDWithSecret(userID)
	if err != nil {
		return false, err
	}
	if !ok || u.PasswordHash == "" {
		return false, nil
	}
	return verifyPassword(password, u.PasswordHash), nil
}

func (s *UserStore) Create(input CreateUserInput) (User, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	login := normalizeLogin(input.Login)
	if err := validateLogin(login); err != nil {
		return User{}, err
	}
	avatarURL, err := normalizeAvatarURL(input.AvatarURL)
	if err != nil {
		return User{}, err
	}
	issuer, subject, err := normalizeOIDC(input.OIDCIssuer, input.OIDCSubject)
	if err != nil {
		return User{}, err
	}
	role := normalizeRole(input.Role)
	if err := validateRole(role); err != nil {
		return User{}, err
	}

	passwordHash := ""
	if strings.TrimSpace(input.Password) != "" {
		passwordHash, err = hashPassword(input.Password)
		if err != nil {
			return User{}, err
		}
	} else if issuer == "" {
		return User{}, ErrPasswordRequired
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = login
	}

	u := User{
		ID:          uuid.NewString(),
		Login:       login,
		Name:        name,
		AvatarURL:   avatarURL,
		OIDCIssuer:  issuer,
		OIDCSubject: subject,
		Role:        role,
		LastLogin:   "",
		CreatedAt:   nowUTC(),
		UpdatedAt:   nowUTC(),
	}
	_, err = s.db.Exec(
		`INSERT INTO users(id,login,password_hash,name,avatar_url,oidc_issuer,oidc_subject,role,last_login,created_at,updated_at)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		u.ID, u.Login, passwordHash, u.Name, u.AvatarURL, u.OIDCIssuer, u.OIDCSubject, u.Role, u.LastLogin, u.CreatedAt, u.UpdatedAt,
	)
	if err != nil {
		return User{}, err
	}
	u.HasPassword = passwordHash != ""
	return u, nil
}

func (s *UserStore) Update(id string, input UpdateUserInput) (User, bool, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	login := normalizeLogin(input.Login)
	if err := validateLogin(login); err != nil {
		return User{}, false, err
	}
	avatarURL, err := normalizeAvatarURL(input.AvatarURL)
	if err != nil {
		return User{}, false, err
	}
	issuer, subject, err := normalizeOIDC(input.OIDCIssuer, input.OIDCSubject)
	if err != nil {
		return User{}, false, err
	}
	role := normalizeRole(input.Role)
	if err := validateRole(role); err != nil {
		return User{}, false, err
	}

	current, found, err := s.GetByID(id)
	if err != nil {
		return User{}, false, err
	}
	if !found {
		return User{}, false, nil
	}
	if current.Role == RoleOwner && role != RoleOwner {
		owners, err := s.CountOwners()
		if err != nil {
			return User{}, false, err
		}
		if owners <= 1 {
			return User{}, false, ErrCannotDemoteLastOwner
		}
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = login
	}
	ts := nowUTC()
	res, err := s.db.Exec(
		`UPDATE users
		 SET login=?, name=?, avatar_url=?, oidc_issuer=?, oidc_subject=?, role=?, updated_at=?
		 WHERE id=?`,
		login, name, avatarURL, issuer, subject, role, ts, id,
	)
	if err != nil {
		return User{}, false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return User{}, false, nil
	}
	return s.GetByID(id)
}

func (s *UserStore) SetPassword(id, password string) (bool, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	pwHash, err := hashPassword(password)
	if err != nil {
		return false, err
	}
	res, err := s.db.Exec(
		`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
		pwHash, nowUTC(), id,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *UserStore) TouchLastLogin(id string) error {
	unlock := lockSQLiteWrite()
	defer unlock()

	_, err := s.db.Exec(`UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?`, nowUTC(), nowUTC(), id)
	return err
}

func (s *UserStore) Delete(id string) (bool, error) {
	unlock := lockSQLiteWrite()
	defer unlock()

	u, ok, err := s.GetByID(id)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil
	}
	if u.Role == RoleOwner {
		owners, err := s.CountOwners()
		if err != nil {
			return false, err
		}
		if owners <= 1 {
			return false, ErrCannotDeleteLastOwner
		}
	}
	res, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *UserStore) CountByRole(role string) (int, error) {
	role = normalizeRole(role)
	if err := validateRole(role); err != nil {
		return 0, err
	}
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = ?`, role).Scan(&n)
	return n, err
}

func (s *UserStore) CountOwners() (int, error) {
	return s.CountByRole(RoleOwner)
}

func (s *UserStore) Close() error { return s.db.Close() }
