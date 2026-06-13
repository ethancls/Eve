package api

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	shellSessionIdleTimeout   = 10 * time.Minute
	shellSessionCleanupPeriod = 1 * time.Minute
	shellWriteTimeout         = 10 * time.Second
	shellSessionRewindBytes   = 1024 * 1024
	shellReplayChunkSize      = 16 * 1024
)

type shellSessionManager struct {
	mu              sync.RWMutex
	sessions        map[string]*shellSession
	logger          *slog.Logger
	containerBinary string
}

type shellSession struct {
	id       string
	ownerID  string
	kind     string
	instance string

	cmd  *exec.Cmd
	ptmx *os.File

	manager *shellSessionManager
	logger  *slog.Logger

	mu             sync.Mutex
	connWriteMu    sync.Mutex
	attached       *websocket.Conn
	lastDetachedAt time.Time
	closed         bool
	closeOnce      sync.Once
	outputBuf      []byte
}

func newShellSessionManager(logger *slog.Logger, containerBinary string) *shellSessionManager {
	m := &shellSessionManager{
		sessions:        make(map[string]*shellSession),
		logger:          logger,
		containerBinary: containerBinary,
	}
	go m.cleanupLoop()
	return m
}

func (m *shellSessionManager) cleanupLoop() {
	ticker := time.NewTicker(shellSessionCleanupPeriod)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		for _, sess := range m.snapshot() {
			if sess.shouldCloseIdle(now) {
				sess.close("idle timeout")
			}
		}
	}
}

func (m *shellSessionManager) snapshot() []*shellSession {
	m.mu.RLock()
	defer m.mu.RUnlock()

	items := make([]*shellSession, 0, len(m.sessions))
	for _, sess := range m.sessions {
		items = append(items, sess)
	}
	return items
}

func (m *shellSessionManager) remove(id string) {
	m.mu.Lock()
	delete(m.sessions, id)
	m.mu.Unlock()
}

func (m *shellSessionManager) get(id string) (*shellSession, bool) {
	m.mu.RLock()
	sess, ok := m.sessions[id]
	m.mu.RUnlock()
	return sess, ok
}

func (m *shellSessionManager) getOrCreate(ownerID, kind, instance, requestedID string) (*shellSession, error) {
	requestedID = strings.TrimSpace(requestedID)
	if requestedID != "" {
		if sess, ok := m.get(requestedID); ok {
			if sess.matches(ownerID, kind, instance) && !sess.isClosed() {
				return sess, nil
			}
		}
	}
	return m.create(ownerID, kind, instance)
}

func (m *shellSessionManager) create(ownerID, kind, instance string) (*shellSession, error) {
	var cmd *exec.Cmd
	bin := m.containerBinary
	if bin == "" {
		bin = "docker"
	}
	switch kind {
	case "container":
		cmd = exec.Command(bin, "exec", "-i", "-t", instance, "sh") //nolint:gosec
	case "machine", "instance":
		cmd = exec.Command(bin, "machine", "run", "-n", instance, "-i", "-t") //nolint:gosec
	default:
		return nil, fmt.Errorf("unsupported shell kind %q", kind)
	}
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}

	sess := &shellSession{
		id:       uuid.NewString(),
		ownerID:  ownerID,
		kind:     kind,
		instance: instance,
		cmd:      cmd,
		ptmx:     ptmx,
		manager:  m,
		logger:   m.logger,
	}

	m.mu.Lock()
	m.sessions[sess.id] = sess
	m.mu.Unlock()

	go sess.streamPTY()
	return sess, nil
}

func (s *shellSession) ID() string { return s.id }

func (s *shellSession) matches(ownerID, kind, instance string) bool {
	return s.ownerID == ownerID && s.kind == kind && s.instance == instance
}

func (s *shellSession) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

func (s *shellSession) shouldCloseIdle(now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.attached != nil || s.lastDetachedAt.IsZero() {
		return false
	}
	return now.Sub(s.lastDetachedAt) >= shellSessionIdleTimeout
}

func (s *shellSession) attach(conn *websocket.Conn) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fmt.Errorf("session closed")
	}
	prev := s.attached
	s.attached = conn
	s.lastDetachedAt = time.Time{}
	rewind := make([]byte, len(s.outputBuf))
	copy(rewind, s.outputBuf)
	s.mu.Unlock()

	if prev != nil && prev != conn {
		_ = prev.Close()
	}
	if err := s.replay(conn, rewind); err != nil {
		s.detachIfMatch(conn)
		return err
	}
	return nil
}

func (s *shellSession) detachIfMatch(conn *websocket.Conn) {
	s.mu.Lock()
	if s.attached == conn {
		s.attached = nil
		s.lastDetachedAt = time.Now()
	}
	s.mu.Unlock()
}

func (s *shellSession) writeInput(data []byte) error {
	s.mu.Lock()
	ptmx := s.ptmx
	closed := s.closed
	s.mu.Unlock()

	if closed || ptmx == nil {
		return fmt.Errorf("session closed")
	}
	_, err := ptmx.Write(data)
	return err
}

func (s *shellSession) resize(cols, rows uint16) {
	if cols == 0 || rows == 0 {
		return
	}
	s.mu.Lock()
	ptmx := s.ptmx
	closed := s.closed
	s.mu.Unlock()

	if closed || ptmx == nil {
		return
	}
	_ = pty.Setsize(ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (s *shellSession) streamPTY() {
	buf := make([]byte, 4096)
	for {
		n, readErr := s.ptmx.Read(buf)
		if n > 0 {
			payload := make([]byte, n)
			copy(payload, buf[:n])
			s.appendOutput(payload)
			if err := s.writeOutput(payload); err != nil {
				s.logger.Debug("shell session write output failed", "session_id", s.id, "err", err)
			}
		}
		if readErr != nil {
			s.close("pty closed")
			return
		}
	}
}

func (s *shellSession) appendOutput(payload []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed || len(payload) == 0 {
		return
	}
	s.outputBuf = append(s.outputBuf, payload...)
	if len(s.outputBuf) > shellSessionRewindBytes {
		s.outputBuf = s.outputBuf[len(s.outputBuf)-shellSessionRewindBytes:]
	}
}

func (s *shellSession) replay(conn *websocket.Conn, data []byte) error {
	if len(data) == 0 {
		return nil
	}

	s.connWriteMu.Lock()
	defer s.connWriteMu.Unlock()

	for i := 0; i < len(data); i += shellReplayChunkSize {
		end := i + shellReplayChunkSize
		if end > len(data) {
			end = len(data)
		}
		_ = conn.SetWriteDeadline(time.Now().Add(shellWriteTimeout))
		if err := conn.WriteMessage(websocket.BinaryMessage, data[i:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *shellSession) writeOutput(payload []byte) error {
	s.mu.Lock()
	conn := s.attached
	closed := s.closed
	s.mu.Unlock()

	if closed || conn == nil {
		return nil
	}

	s.connWriteMu.Lock()
	_ = conn.SetWriteDeadline(time.Now().Add(shellWriteTimeout))
	err := conn.WriteMessage(websocket.BinaryMessage, payload)
	s.connWriteMu.Unlock()
	if err != nil {
		s.detachIfMatch(conn)
		return err
	}
	return nil
}

func (s *shellSession) close(reason string) {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		conn := s.attached
		s.attached = nil
		ptmx := s.ptmx
		s.ptmx = nil
		cmd := s.cmd
		s.cmd = nil
		s.mu.Unlock()

		if conn != nil {
			_ = conn.Close()
		}
		if ptmx != nil {
			_ = ptmx.Close()
		}
		if cmd != nil {
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			_ = cmd.Wait()
		}

		s.manager.remove(s.id)
		s.logger.Debug("shell session closed", "session_id", s.id, "instance", s.instance, "reason", reason)
	})
}
