package webauthn

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/user/eve/internal/store"
)

type Service struct {
	w     *webauthn.WebAuthn
	store *store.WebAuthnStore
	users *store.UserStore
}

func New(wstore *store.WebAuthnStore, users *store.UserStore) (*Service, error) {
	rpID := os.Getenv("EVE_WEBAUTHN_RP_ID")
	originsStr := os.Getenv("EVE_WEBAUTHN_ORIGINS")

	if rpID == "" {
		appURL := os.Getenv("EVE_APP_URL")
		if appURL != "" {
			if u, err := url.Parse(appURL); err == nil && u.Host != "" {
				rpID = u.Hostname()
				if originsStr == "" {
					originsStr = appURL
				}
			}
		}
	}
	if rpID == "" {
		rpID = "localhost"
	}
	if originsStr == "" {
		originsStr = "http://localhost:5173"
	}

	origins := strings.Split(originsStr, ",")
	for i, o := range origins {
		origins[i] = strings.TrimSpace(o)
	}

	w, err := webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: "Eve",
		RPOrigins:     origins,
	})
	if err != nil {
		return nil, fmt.Errorf("webauthn init: %w", err)
	}

	return &Service{w: w, store: wstore, users: users}, nil
}

func (s *Service) BeginLogin(login string) (string, *protocol.CredentialAssertion, error) {
	var userID, userLogin string
	if login != "" {
		user, ok, err := s.users.GetByLogin(login)
		if err != nil {
			return "", nil, err
		}
		if ok {
			userID = user.ID
			userLogin = user.Login
		}
	}

	var opts *protocol.CredentialAssertion
	var session *webauthn.SessionData
	var err error

	if userID != "" {
		wu := &webAuthnUser{id: userID, login: userLogin, store: s.store}
		opts, session, err = s.w.BeginLogin(wu)
	} else {
		opts, session, err = s.w.BeginDiscoverableLogin()
	}

	if err != nil {
		return "", nil, err
	}

	sessionID, err := s.store.CreateSession(session, userID, userLogin, "login")
	if err != nil {
		return "", nil, err
	}
	return sessionID, opts, nil
}

func (s *Service) FinishLogin(sessionID string, credentialJSON []byte) (*store.User, error) {
	session, userID, purpose, err := s.store.GetSession(sessionID)
	if err != nil || session == nil || purpose != "login" {
		return nil, fmt.Errorf("invalid session")
	}
	defer s.store.DeleteSession(sessionID)

	parsed, err := protocol.ParseCredentialRequestResponseBytes(credentialJSON)
	if err != nil {
		return nil, err
	}

	var cred *webauthn.Credential

	if userID != "" {
		wu := &webAuthnUser{id: userID, store: s.store}
		cred, err = s.w.ValidateLogin(wu, *session, parsed)
	} else {
		cred, err = s.w.ValidateDiscoverableLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
			return &webAuthnUser{id: string(userHandle), store: s.store}, nil
		}, *session, parsed)
	}

	if err != nil {
		return nil, err
	}

	_ = s.store.UpdateCredential(cred)

	// Find user by credential ID
	stored, err := s.store.GetCredentialByID(cred.ID)
	if err != nil || stored == nil {
		return nil, fmt.Errorf("credential not found — it may have been revoked, re-register your passkey")
	}
	user, _, _ := s.users.GetByID(stored.UserID)
	if user.ID == "" {
		return nil, fmt.Errorf("user not found for credential")
	}
	return &user, nil
}

func (s *Service) BeginRegistration(user store.User, name string) (string, *protocol.CredentialCreation, error) {
	wu := &webAuthnUser{id: user.ID, login: user.Login, store: s.store}

	opts, session, err := s.w.BeginRegistration(wu, webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
		RequireResidentKey: protocol.ResidentKeyRequired(),
		ResidentKey:        protocol.ResidentKeyRequirementRequired,
		UserVerification:   protocol.VerificationRequired,
	}))
	if err != nil {
		return "", nil, err
	}
	sessionID, err := s.store.CreateSession(session, user.ID, user.Login, "registration")
	if err != nil {
		return "", nil, err
	}
	return sessionID, opts, nil
}

func (s *Service) FinishRegistration(sessionID string, credentialJSON []byte, name string) error {
	session, userID, purpose, err := s.store.GetSession(sessionID)
	if err != nil || session == nil || purpose != "registration" {
		return fmt.Errorf("invalid session")
	}
	defer s.store.DeleteSession(sessionID)

	parsed, err := protocol.ParseCredentialCreationResponseBytes(credentialJSON)
	if err != nil {
		return err
	}

	wu := &webAuthnUser{id: userID, store: s.store}
	cred, err := s.w.CreateCredential(wu, *session, parsed)
	if err != nil {
		return err
	}
	_, err = s.store.CreateCredential(userID, name, cred)
	return err
}

type webAuthnUser struct {
	id    string
	login string
	store *store.WebAuthnStore
}

func (u *webAuthnUser) WebAuthnID() []byte {
	return []byte(u.id)
}

func (u *webAuthnUser) WebAuthnName() string {
	return u.login
}

func (u *webAuthnUser) WebAuthnDisplayName() string {
	return u.login
}

func (u *webAuthnUser) WebAuthnCredentials() []webauthn.Credential {
	creds, _ := u.store.GetCredentialsByUser(u.id)
	list := make([]webauthn.Credential, 0, len(creds))
	for _, c := range creds {
		if c.Credential != nil {
			list = append(list, *c.Credential)
		}
	}
	return list
}
