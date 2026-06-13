package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func (srv *Server) handleProjectsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}

	dir := srv.cfg.ProjectsDir
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create projects dir"})
		return
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	var projects []map[string]any
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		
		name := entry.Name()
		composeFile := filepath.Join(dir, name, "docker-compose.yml")
		hasCompose := false
		if _, err := os.Stat(composeFile); err == nil {
			hasCompose = true
		} else {
			// fallback to compose.yaml
			if _, err := os.Stat(filepath.Join(dir, name, "compose.yaml")); err == nil {
				hasCompose = true
			}
		}

		projects = append(projects, map[string]any{
			"name":        name,
			"has_compose": hasCompose,
		})
	}
	if projects == nil {
		projects = []map[string]any{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}

func (srv *Server) routeProjects(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		srv.handleProjectsList(w, r)
		return
	}

	name := parts[0]
	// Basic validation to prevent path traversal
	if strings.Contains(name, "/") || strings.Contains(name, "..") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid project name"})
		return
	}

	projectDir := filepath.Join(srv.cfg.ProjectsDir, name)

	if len(parts) == 1 {
		if r.Method == http.MethodDelete {
			if err := os.RemoveAll(projectDir); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
		} else {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
		return
	}

	switch parts[1] {
	case "compose":
		srv.handleProjectCompose(w, r, projectDir)
	case "action":
		if len(parts) == 3 && r.Method == http.MethodPost {
			srv.handleProjectAction(w, r, projectDir, name, parts[2])
		} else {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		}
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (srv *Server) handleProjectCompose(w http.ResponseWriter, r *http.Request, projectDir string) {
	composePath := filepath.Join(projectDir, "docker-compose.yml")
	envPath := filepath.Join(projectDir, ".env")

	if r.Method == http.MethodGet {
		// Read files, don't error if they don't exist
		composeContent, _ := os.ReadFile(composePath)
		if len(composeContent) == 0 {
			composeContent, _ = os.ReadFile(filepath.Join(projectDir, "compose.yaml"))
		}
		envContent, _ := os.ReadFile(envPath)

		writeJSON(w, http.StatusOK, map[string]string{
			"compose": string(composeContent),
			"env":     string(envContent),
		})
		return
	}

	if r.Method == http.MethodPut {
		var req struct {
			Compose string `json:"compose"`
			Env     string `json:"env"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		if err := os.MkdirAll(projectDir, 0755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create project directory"})
			return
		}

		if err := os.WriteFile(composePath, []byte(req.Compose), 0644); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save docker-compose.yml"})
			return
		}

		if err := os.WriteFile(envPath, []byte(req.Env), 0644); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save .env"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
		return
	}

	methodNotAllowed(w)
}

func (srv *Server) handleProjectAction(w http.ResponseWriter, r *http.Request, projectDir, name, action string) {
	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "project not found"})
		return
	}

	var args []string
	switch action {
	case "up":
		args = []string{"compose", "up", "-d", "--remove-orphans"}
	case "down":
		args = []string{"compose", "down"}
	case "restart":
		args = []string{"compose", "restart"}
	case "pull":
		args = []string{"compose", "pull"}
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid action"})
		return
	}

	cmd := exec.CommandContext(r.Context(), "docker", args...)
	cmd.Dir = projectDir
	
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error":  fmt.Sprintf("compose %s failed: %v", action, err),
			"output": string(out),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "success",
		"output": string(out),
	})
}
