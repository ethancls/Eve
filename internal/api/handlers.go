package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/user/eve/internal/store"
)

var instanceNameRe = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}[a-z0-9]$`)

var allowedActions = map[string]bool{
	"stop": true, "delete": true,
}

// --- utility ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func methodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
}

func httpStatusFromError(msg string) int {
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "not found") || strings.Contains(lower, "does not exist") || strings.Contains(lower, "unknown") {
		return http.StatusNotFound
	}
	if strings.Contains(lower, "permission denied") || strings.Contains(lower, "forbidden") {
		return http.StatusForbidden
	}
	if strings.Contains(lower, "invalid") || strings.Contains(lower, "usage:") || strings.Contains(lower, "bad") {
		return http.StatusBadRequest
	}
	return http.StatusBadGateway
}

func looksLikeNotFound(msg string) bool {
	lower := strings.ToLower(msg)
	return strings.Contains(lower, "not found") || strings.Contains(lower, "does not exist") || strings.Contains(lower, "unknown")
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "invalid JSON: " + err.Error()})
		return false
	}
	return true
}

func (srv *Server) logAction(action, vmName, status, errMsg string) {
	if err := srv.activity.Add(action, vmName, status, errMsg); err != nil {
		srv.logger.Warn("activity log error", "err", err)
	}
}

// --- GET /api/health ---

func (srv *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	ctx := r.Context()
	system := srv.mp.SystemState(ctx)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":           "ok",
		"daemon_running":   system.Running,
		"container_system": system,
		"install_required": !system.Installed,
		"startup_required": system.Installed && !system.Running,
		"ws_clients":       srv.hub.Count(),
	})
}

// --- GET /api/system/version ---

func (srv *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	version, err := srv.mp.ServerVersion(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	lines := []string{fmt.Sprintf("Docker %s (API %s)", version.Version, version.APIVersion)}
	writeJSON(w, http.StatusOK, map[string]any{"version": version.Version, "lines": lines})
}

// --- GET /api/system/host ---

func (srv *Server) handleHostInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}

	cpus := runtime.NumCPU()
	ramMB := detectHostMemoryMB()
	hostname, _ := os.Hostname()

	var diskFreeGB int64 = 100
	var statfs syscall.Statfs_t
	if err := syscall.Statfs("/", &statfs); err == nil {
		diskFreeGB = int64(statfs.Bavail) * int64(statfs.Bsize) / (1024 * 1024 * 1024)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"hostname":     hostname,
		"os":           runtime.GOOS,
		"arch":         runtime.GOARCH,
		"cpus":         cpus,
		"memory_mb":    ramMB,
		"disk_free_gb": diskFreeGB,
	})
}

func detectHostMemoryMB() int64 {
	// Linux fast-path
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if !strings.HasPrefix(line, "MemTotal:") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 2 {
				return 0
			}
			kb, parseErr := strconv.ParseInt(fields[1], 10, 64)
			if parseErr != nil || kb <= 0 {
				return 0
			}
			return kb / 1024
		}
	}

	// macOS fallback
	out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		return 0
	}
	bytes, parseErr := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if parseErr != nil || bytes <= 0 {
		return 0
	}
	return bytes / (1024 * 1024)
}

// --- GET /api/images ---

func (srv *Server) handleImages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	items, err := srv.mp.ListImages(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": items})
}

// --- GET /api/networks ---

func (srv *Server) handleNetworks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	ctx := r.Context()
	nets, err := srv.mp.ListNetworks(ctx)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	// Build network → containers mapping from container network settings
	allContainers, _ := srv.mp.ListContainers(ctx)
	networkContainers := make(map[string][]string)
	for _, c := range allContainers {
		name := "unknown"
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		if c.NetworkSettings != nil {
			for netName := range c.NetworkSettings.Networks {
				networkContainers[netName] = append(networkContainers[netName], name)
			}
		}
	}

	var results []map[string]any
	for _, n := range nets {
		ipv4Subnet := ""
		ipv4Gateway := ""
		if len(n.IPAM.Config) > 0 {
			ipv4Subnet = n.IPAM.Config[0].Subnet
			ipv4Gateway = n.IPAM.Config[0].Gateway
		}

		// Prefer API containers, fallback to container network mapping
		var instances []string
		if n.Containers != nil {
			for _, containerInfo := range n.Containers {
				instances = append(instances, containerInfo.Name)
			}
		}
		if len(instances) == 0 {
			instances = networkContainers[n.Name]
		}
		if instances == nil {
			instances = []string{}
		}

		results = append(results, map[string]any{
			"name":         n.Name,
			"mode":         n.Driver,
			"type":         n.Scope,
			"plugin":       n.Driver,
			"status":       "up",
			"ipv4_subnet":  ipv4Subnet,
			"ipv4_gateway": ipv4Gateway,
			"containers":   instances,
			"instances":    instances,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"networks": results})
}

// --- GET /api/instances ---

func (srv *Server) handleGetInstances(w http.ResponseWriter, r *http.Request) {
	instances, err := srv.mp.GetAllInstancesInfo(r.Context(), true)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"instances": instances})
}

// --- POST /api/instances ---

func (srv *Server) handleCreateInstance(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name       string         `json:"name"`
		Image      string         `json:"image"`
		CPUs       any            `json:"cpus"`
		Memory     string         `json:"memory"`
		Platform   string         `json:"platform"`
		Arch       string         `json:"arch"`
		OS         string         `json:"os"`
		HomeMount  string         `json:"home_mount"`
		NoBoot     bool           `json:"no_boot"`
		SetDefault bool           `json:"set_default"`
		Options    map[string]any `json:"options"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Name == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "name is required"})
		return
	}
	if body.Image == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "image is required"})
		return
	}

	opts := cloneOptions(body.Options)
	opts["--name"] = body.Name
	if body.CPUs != nil {
		opts["--cpus"] = fmt.Sprintf("%v", body.CPUs)
	}
	if body.Memory != "" {
		opts["--memory"] = body.Memory
	}
	if body.Platform != "" {
		opts["--platform"] = body.Platform
	}
	if body.Arch != "" {
		opts["--arch"] = body.Arch
	}
	if body.OS != "" {
		opts["--os"] = body.OS
	}
	if body.HomeMount != "" {
		opts["--home-mount"] = body.HomeMount
	}
	if body.NoBoot {
		opts["--no-boot"] = true
	}
	if body.SetDefault {
		opts["--set-default"] = true
	}

	_, err := srv.mp.RunChecked(r.Context(), "machine create", []string{body.Image}, opts, "")
	if err != nil {
		srv.logAction("machine create", body.Name, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.mp.InvalidateCache()
	srv.logAction("machine create", body.Name, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- GET /api/instances/{name} ---

func (srv *Server) handleGetInstance(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	ctx := r.Context()
	// Try cache first
	instances, err := srv.mp.GetAllInstancesInfo(ctx, true)
	if err == nil {
		for _, inst := range instances {
			if n, _ := inst["name"].(string); n == name {
				writeJSON(w, http.StatusOK, inst)
				return
			}
		}
	}
	// Fall back to direct info call
	info, err := srv.mp.GetInstanceInfo(ctx, name)
	if err != nil {
		status := http.StatusBadGateway
		if looksLikeNotFound(err.Error()) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// --- POST /api/instances/{name}/actions/{action} ---

func (srv *Server) handleInstanceAction(w http.ResponseWriter, r *http.Request, name, action string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if !allowedActions[action] {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "unsupported action: " + action})
		return
	}

	var body struct {
		Purge bool `json:"purge"`
	}
	// best-effort decode
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck

	_ = body
	opts := map[string]any{}

	ctx := r.Context()
	command := action
	if action == "stop" || action == "delete" {
		command = "machine " + action
	}
	_, err := srv.mp.RunChecked(ctx, command, []string{name}, opts, "")
	if err != nil {
		srv.logAction(action, name, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.mp.InvalidateCache()
	srv.logAction(action, name, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- POST /api/instances/{name}/clone ---

func (srv *Server) handleCloneInstance(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck

	opts := map[string]any{}
	if body.Name != "" {
		opts["--name"] = body.Name
	}

	ctx := r.Context()
	_, err := srv.mp.RunChecked(ctx, "clone", []string{name}, opts, "")
	if err != nil {
		srv.logAction("clone", name, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.mp.InvalidateCache()
	srv.logAction("clone", name, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- POST /api/instances/{name}/exec ---

func (srv *Server) handleExecInstance(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Command               []string `json:"command"`
		WorkingDirectory      string   `json:"working_directory"`
		NoMapWorkingDirectory bool     `json:"no_map_working_directory"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Command) == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "command is required"})
		return
	}

	opts := map[string]any{}
	if body.WorkingDirectory != "" {
		opts["--working-directory"] = body.WorkingDirectory
	}
	if body.NoMapWorkingDirectory {
		opts["--no-map-working-directory"] = true
	}

	args := append([]string{name, "--"}, body.Command...)
	res, err := srv.mp.Run(r.Context(), "exec", args, opts, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"exit_code":   res.ExitCode,
		"stdout":      res.Stdout,
		"stderr":      res.Stderr,
		"duration_ms": res.DurationMs,
	})
}

// --- POST /api/instances/{name}/ssh-password ---

func (srv *Server) handleSSHPassword(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Username           string `json:"username"`
		PasswordLength     int    `json:"password_length"`
		EnablePasswordAuth bool   `json:"enable_password_auth"`
	}
	body.Username = "ubuntu"
	body.PasswordLength = 16
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck
	if body.Username == "" {
		body.Username = "ubuntu"
	}
	if body.PasswordLength < 8 {
		body.PasswordLength = 16
	}

	password := generatePassword(body.PasswordLength)
	ctx := r.Context()

	_, err := srv.mp.RunChecked(ctx, "exec",
		[]string{name, "--", "sudo", "chpasswd"},
		nil,
		body.Username+":"+password+"\n",
	)
	if err != nil {
		srv.logAction("ssh_password", name, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}

	if body.EnablePasswordAuth {
		script := "set -euo pipefail; " +
			"sudo install -d -m 755 /etc/ssh/sshd_config.d; " +
			"printf 'PasswordAuthentication yes\\nKbdInteractiveAuthentication yes\\n' | " +
			"sudo tee /etc/ssh/sshd_config.d/99-eve-password-auth.conf >/dev/null; " +
			"if command -v systemctl >/dev/null 2>&1; then " +
			"sudo systemctl restart ssh || sudo systemctl restart sshd; " +
			"else sudo service ssh restart || sudo service sshd restart; fi"
		srv.mp.RunChecked(ctx, "exec", []string{name, "--", "bash", "-lc", script}, nil, "") //nolint:errcheck
	}

	srv.mp.InvalidateCache()
	host := ""
	if info, err2 := srv.mp.GetInstanceInfo(ctx, name); err2 == nil {
		if ips, ok := info["ipv4"].([]string); ok && len(ips) > 0 {
			host = ips[0]
		}
	}

	sshCmd := fmt.Sprintf("ssh %s@%s", body.Username, host)
	if host == "" {
		sshCmd = fmt.Sprintf("ssh %s@<instance-ip>", body.Username)
	}

	srv.logAction("ssh_password", name, "success", "")
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "success",
		"instance":    name,
		"username":    body.Username,
		"host":        host,
		"ssh_command": sshCmd,
		"password":    password,
	})
}

// --- GET /api/instances/{name}/ssh-password/status ---

func (srv *Server) handleSSHPasswordStatus(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	username := r.URL.Query().Get("username")
	if username == "" {
		username = "ubuntu"
	}

	ctx := r.Context()
	info, err := srv.mp.GetInstanceInfo(ctx, name)
	if err != nil {
		status := http.StatusBadGateway
		if looksLikeNotFound(err.Error()) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	host := ""
	if ips, ok := info["ipv4"].([]string); ok && len(ips) > 0 {
		host = ips[0]
	}
	state, _ := info["state"].(string)
	sshCmd := fmt.Sprintf("ssh %s@%s", username, host)
	if host == "" {
		sshCmd = fmt.Sprintf("ssh %s@<instance-ip>", username)
	}

	if state != "Running" {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":         "success",
			"instance":       name,
			"username":       username,
			"host":           host,
			"ssh_command":    sshCmd,
			"checked":        false,
			"password_auth":  false,
			"account_locked": true,
			"enabled":        false,
			"error":          "instance not running",
		})
		return
	}

	script := probeSSHPasswordStatusScript(username)
	probe, perr := srv.mp.RunChecked(ctx, "exec",
		[]string{name, "--", "bash", "-lc", script}, nil, "")
	if perr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":         "success",
			"instance":       name,
			"username":       username,
			"host":           host,
			"ssh_command":    sshCmd,
			"checked":        false,
			"password_auth":  false,
			"account_locked": true,
			"enabled":        false,
			"error":          perr.Error(),
		})
		return
	}

	parsed := parseKeyValueOutput(probe.Stdout)
	passwordAuth := strings.ToLower(parsed["PASSWORD_AUTH"]) == "yes"
	accountLocked := parseBool(parsed["ACCOUNT_LOCKED"], true)
	enabled := passwordAuth && !accountLocked

	writeJSON(w, http.StatusOK, map[string]any{
		"status":         "success",
		"instance":       name,
		"username":       username,
		"host":           host,
		"ssh_command":    sshCmd,
		"checked":        true,
		"password_auth":  passwordAuth,
		"account_locked": accountLocked,
		"enabled":        enabled,
		"error":          "",
	})
}

// --- POST /api/instances/{name}/ssh-password/disable ---

func (srv *Server) handleSSHPasswordDisable(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Username            string `json:"username"`
		DisablePasswordAuth bool   `json:"disable_password_auth"`
		LockPassword        bool   `json:"lock_password"`
	}
	body.Username = "ubuntu"
	body.LockPassword = true
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck
	if body.Username == "" {
		body.Username = "ubuntu"
	}

	ctx := r.Context()
	if body.DisablePasswordAuth {
		script := "set -euo pipefail; " +
			"sudo install -d -m 755 /etc/ssh/sshd_config.d; " +
			"printf 'PasswordAuthentication no\\nKbdInteractiveAuthentication no\\n' | " +
			"sudo tee /etc/ssh/sshd_config.d/99-eve-password-auth.conf >/dev/null; " +
			"if command -v systemctl >/dev/null 2>&1; then " +
			"sudo systemctl restart ssh || sudo systemctl restart sshd; " +
			"else sudo service ssh restart || sudo service sshd restart; fi"
		if _, err := srv.mp.RunChecked(ctx, "exec", []string{name, "--", "bash", "-lc", script}, nil, ""); err != nil {
			srv.logAction("ssh_password_disable", name, "error", err.Error())
			writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
			return
		}
	}

	if body.LockPassword {
		script := "sudo passwd -l " + shellQuote(body.Username)
		if _, err := srv.mp.RunChecked(ctx, "exec", []string{name, "--", "bash", "-lc", script}, nil, ""); err != nil {
			srv.logAction("ssh_password_disable", name, "error", err.Error())
			writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
			return
		}
	}

	srv.logAction("ssh_password_disable", name, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- POST /api/instances/{name}/updates/run ---

func (srv *Server) handleRunUpdates(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Refresh     bool `json:"refresh"`
		FullUpgrade bool `json:"full_upgrade"`
		Autoremove  bool `json:"autoremove"`
	}
	body.Refresh = true
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck

	ctx := r.Context()
	info, err := srv.mp.GetInstanceInfo(ctx, name)
	if err != nil {
		status := http.StatusBadGateway
		if looksLikeNotFound(err.Error()) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	if state, _ := info["state"].(string); state != "Running" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "instance must be running to apply updates"})
		return
	}

	var cmds []string
	if body.Refresh {
		cmds = append(cmds, "sudo DEBIAN_FRONTEND=noninteractive apt-get update -y")
	}
	mode := "upgrade"
	if body.FullUpgrade {
		cmds = append(cmds, "sudo DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade")
		mode = "full-upgrade"
	} else {
		cmds = append(cmds, "sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade")
	}
	if body.Autoremove {
		cmds = append(cmds, "sudo DEBIAN_FRONTEND=noninteractive apt-get -y autoremove --purge")
	}

	script := "set -euo pipefail; " + strings.Join(cmds, "; ")
	ctx2, cancel := context.WithTimeout(ctx, 1800*1000*1000*1000) // 30 min
	defer cancel()

	if _, err := srv.mp.RunChecked(ctx2, "exec", []string{name, "--", "bash", "-lc", script}, nil, ""); err != nil {
		srv.logAction("updates_run", name, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}

	// Post-check remaining updates so UI can reflect real state.
	probe, probeErr := srv.mp.RunChecked(ctx, "exec",
		[]string{name, "--", "bash", "-lc", probeUpdatesScript()},
		nil, "")
	if probeErr != nil {
		srv.logAction("updates_run", name, "success", "")
		writeJSON(w, http.StatusOK, map[string]any{
			"status":   "success",
			"instance": name,
			"mode":     mode,
			"note":     "System packages upgraded successfully",
			"checked":  false,
			"error":    probeErr.Error(),
		})
		return
	}
	upgradable, security, reboot, source, packages := parseUpdatesProbeOutput(probe.Stdout)
	note := "System packages upgraded successfully"
	if upgradable > 0 {
		note = fmt.Sprintf("Update command completed, %d package(s) still pending", upgradable)
	}

	srv.logAction("updates_run", name, "success", "")
	writeJSON(w, http.StatusOK, map[string]any{
		"status":               "success",
		"instance":             name,
		"mode":                 mode,
		"note":                 note,
		"checked":              true,
		"upgradable_remaining": upgradable,
		"security_remaining":   security,
		"reboot_required":      reboot,
		"source":               source,
		"packages":             packages,
	})
}

// --- GET /api/updates ---

func (srv *Server) handleGetUpdates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	ctx := r.Context()
	instances, err := srv.mp.GetAllInstancesInfo(ctx, true)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}

	type updateStatus struct {
		Instance       string   `json:"instance"`
		State          string   `json:"state"`
		Checked        bool     `json:"checked"`
		Upgradable     int      `json:"upgradable,omitempty"`
		Security       int      `json:"security,omitempty"`
		RebootRequired bool     `json:"reboot_required,omitempty"`
		Packages       []string `json:"packages,omitempty"`
		Source         string   `json:"source,omitempty"`
		Error          string   `json:"error,omitempty"`
	}

	results := make([]updateStatus, len(instances))
	var wg sync.WaitGroup
	for i, inst := range instances {
		wg.Add(1)
		go func(idx int, inst map[string]any) {
			defer wg.Done()
			name, _ := inst["name"].(string)
			state, _ := inst["state"].(string)
			if name == "" {
				results[idx] = updateStatus{Checked: false, Error: "invalid instance"}
				return
			}
			if state != "Running" {
				results[idx] = updateStatus{Instance: name, State: state, Checked: false, Error: "instance not running"}
				return
			}
			probe, err := srv.mp.RunChecked(ctx, "exec",
				[]string{name, "--", "bash", "-lc", probeUpdatesScript()},
				nil, "")
			if err != nil {
				results[idx] = updateStatus{Instance: name, State: state, Checked: false, Error: err.Error()}
				return
			}
			upgradable, security, reboot, source, packages := parseUpdatesProbeOutput(probe.Stdout)
			results[idx] = updateStatus{
				Instance:       name,
				State:          state,
				Checked:        true,
				Upgradable:     upgradable,
				Security:       security,
				RebootRequired: reboot,
				Packages:       packages,
				Source:         source,
			}
		}(i, inst)
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, map[string]any{"updates": results})
}

// --- GET /api/instances/{name}/updates ---

func (srv *Server) handleGetInstanceUpdates(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	ctx := r.Context()
	info, err := srv.mp.GetInstanceInfo(ctx, name)
	if err != nil {
		status := http.StatusBadGateway
		if looksLikeNotFound(err.Error()) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	state, _ := info["state"].(string)
	if state != "Running" {
		writeJSON(w, http.StatusOK, map[string]any{"updates": []map[string]any{{
			"instance": name, "state": state, "checked": false, "error": "instance not running",
		}}})
		return
	}

	probe, err := srv.mp.RunChecked(ctx, "exec",
		[]string{name, "--", "bash", "-lc", probeUpdatesScript()}, nil, "")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"updates": []map[string]any{{
			"instance": name, "state": state, "checked": false, "error": err.Error(),
		}}})
		return
	}
	upgradable, security, reboot, source, packages := parseUpdatesProbeOutput(probe.Stdout)
	writeJSON(w, http.StatusOK, map[string]any{"updates": []map[string]any{{
		"instance":        name,
		"state":           state,
		"checked":         true,
		"upgradable":      upgradable,
		"security":        security,
		"reboot_required": reboot,
		"packages":        packages,
		"source":          source,
	}}})
}

// --- POST /api/instances/{name}/mounts ---

func (srv *Server) handleMount(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Source    string `json:"source"`
		Path      string `json:"path"`
		MountType string `json:"mount_type"`
		UIDMap    string `json:"uid_map"`
		GIDMap    string `json:"gid_map"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	opts := map[string]any{}
	if body.MountType != "" {
		opts["--type"] = body.MountType
	}
	if body.UIDMap != "" {
		opts["--uid-map"] = body.UIDMap
	}
	if body.GIDMap != "" {
		opts["--gid-map"] = body.GIDMap
	}
	target := name
	if body.Path != "" {
		target = name + ":" + body.Path
	}
	if _, err := srv.mp.RunChecked(r.Context(), "mount", []string{body.Source, target}, opts, ""); err != nil {
		srv.logAction("mount", name, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.mp.InvalidateCache()
	srv.logAction("mount", name, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- DELETE /api/instances/{name}/mounts ---

func (srv *Server) handleUmount(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	path := r.URL.Query().Get("path")
	target := name
	if path != "" {
		target = name + ":" + path
	}
	if _, err := srv.mp.RunChecked(r.Context(), "umount", []string{target}, nil, ""); err != nil {
		srv.logAction("umount", name, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.mp.InvalidateCache()
	srv.logAction("umount", name, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- GET /api/instances/{name}/snapshots ---

func (srv *Server) handleGetInstanceSnapshots(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	ctx := r.Context()
	_, data, err := srv.mp.RunJSONChecked(ctx, "info", []string{name},
		map[string]any{"--snapshots": true, "--format": "json"})
	if err != nil {
		// fallback: list --snapshots
		_, data2, err2 := srv.mp.RunJSONChecked(ctx, "list", nil, map[string]any{"--snapshots": true, "--format": "json"})
		if err2 != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err2.Error()})
			return
		}
		snapshots := normalizeSnapshots(data2)
		var filtered []map[string]any
		for _, s := range snapshots {
			if inst, _ := s["instance"].(string); inst == name {
				filtered = append(filtered, s)
			}
		}
		if filtered == nil {
			filtered = []map[string]any{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"snapshots": filtered})
		return
	}
	snapshots := normalizeSnapshots(data)
	var filtered []map[string]any
	for _, s := range snapshots {
		if inst, _ := s["instance"].(string); inst == "" || inst == name {
			filtered = append(filtered, s)
		}
	}
	if filtered == nil {
		filtered = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"snapshots": filtered})
}

// --- POST /api/instances/{name}/snapshots ---

func (srv *Server) handleCreateSnapshot(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Name    string `json:"name"`
		Comment string `json:"comment"`
	}
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck

	opts := map[string]any{}
	if body.Name != "" {
		opts["--name"] = body.Name
	}
	if body.Comment != "" {
		opts["--comment"] = body.Comment
	}

	if _, err := srv.mp.RunChecked(r.Context(), "snapshot", []string{name}, opts, ""); err != nil {
		srv.logAction("snapshot", name, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.mp.InvalidateCache()
	srv.logAction("snapshot", name, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- GET /api/instances/{name}/history ---

func (srv *Server) handleGetHistory(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	points := srv.metrics.Get(name)
	if points == nil {
		points = []store.MetricPoint{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"history": points})
}

// --- GET /api/snapshots ---

func (srv *Server) handleGetAllSnapshots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	_, data, err := srv.mp.RunJSONChecked(r.Context(), "info", nil,
		map[string]any{"--snapshots": true, "--format": "json"})
	if err != nil {
		// fallback: list --snapshots (no created date)
		_, data2, err2 := srv.mp.RunJSONChecked(r.Context(), "list", nil,
			map[string]any{"--snapshots": true, "--format": "json"})
		if err2 != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err2.Error()})
			return
		}
		data = data2
	}
	snapshots := normalizeSnapshots(data)
	if snapshots == nil {
		snapshots = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"snapshots": snapshots})
}

// --- POST /api/snapshots/{instance}/{snapshot}/restore ---

func (srv *Server) handleRestoreSnapshot(w http.ResponseWriter, r *http.Request, instance, snapshot string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Destructive bool `json:"destructive"`
	}
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck

	opts := map[string]any{}
	if body.Destructive {
		opts["--destructive"] = true
	}
	ref := instance + "." + snapshot
	if _, err := srv.mp.RunChecked(r.Context(), "restore", []string{ref}, opts, ""); err != nil {
		// Some restore flows require confirmation; retry once with --destructive for API mode.
		lower := strings.ToLower(err.Error())
		needsDestructive := strings.Contains(lower, "unable to query client for confirmation") ||
			strings.Contains(lower, "use 'destructive'")
		if !body.Destructive && needsDestructive {
			if _, retryErr := srv.mp.RunChecked(r.Context(), "restore", []string{ref}, map[string]any{"--destructive": true}, ""); retryErr == nil {
				srv.mp.InvalidateCache()
				srv.logAction("restore", instance, "success", "")
				writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
				return
			}
		}
		srv.logAction("restore", instance, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.mp.InvalidateCache()
	srv.logAction("restore", instance, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- DELETE /api/snapshots/{instance}/{snapshot} ---

func (srv *Server) handleDeleteSnapshot(w http.ResponseWriter, r *http.Request, instance, snapshot string) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	ref := instance + "." + snapshot
	if _, err := srv.mp.RunChecked(r.Context(), "delete", []string{ref}, map[string]any{"--purge": true}, ""); err != nil {
		srv.logAction("delete_snapshot", instance, "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.mp.InvalidateCache()
	srv.logAction("delete_snapshot", instance, "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- POST /api/transfers ---

func (srv *Server) handleTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Sources     []string `json:"sources"`
		Destination string   `json:"destination"`
		Recursive   bool     `json:"recursive"`
		Parents     bool     `json:"parents"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	opts := map[string]any{}
	if body.Recursive {
		opts["--recursive"] = true
	}
	if body.Parents {
		opts["--parents"] = true
	}
	args := append(body.Sources, body.Destination)
	if _, err := srv.mp.RunChecked(r.Context(), "transfer", args, opts, ""); err != nil {
		srv.logAction("transfer", "", "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.logAction("transfer", "", "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- GET /api/aliases ---

func (srv *Server) handleGetAliases(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	_, data, err := srv.mp.RunJSONChecked(r.Context(), "aliases", nil, map[string]any{"--format": "json"})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	var aliases any
	if dm, ok := data.(map[string]any); ok {
		if v, ok := dm["aliases"]; ok {
			aliases = v
		} else if v, ok := dm["list"]; ok {
			aliases = v
		} else {
			aliases = data
		}
	} else {
		aliases = data
	}
	if aliases == nil {
		aliases = []any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"aliases": aliases})
}

// --- POST /api/aliases ---

func (srv *Server) handleCreateAlias(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Definition            string `json:"definition"`
		Name                  string `json:"name"`
		NoMapWorkingDirectory bool   `json:"no_map_working_directory"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	args := []string{body.Definition}
	if body.Name != "" {
		args = append(args, body.Name)
	}
	opts := map[string]any{}
	if body.NoMapWorkingDirectory {
		opts["--no-map-working-directory"] = true
	}
	if _, err := srv.mp.RunChecked(r.Context(), "alias", args, opts, ""); err != nil {
		srv.logAction("alias", "", "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.logAction("alias", "", "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- DELETE /api/aliases/{name} ---

func (srv *Server) handleDeleteAlias(w http.ResponseWriter, r *http.Request, name string) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	if _, err := srv.mp.RunChecked(r.Context(), "unalias", []string{name}, nil, ""); err != nil {
		srv.logAction("unalias", "", "error", err.Error())
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	srv.logAction("unalias", "", "success", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- POST /api/aliases/prefer ---

func (srv *Server) handlePreferAlias(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if _, err := srv.mp.RunChecked(r.Context(), "prefer", []string{body.Name}, nil, ""); err != nil {
		writeJSON(w, httpStatusFromError(err.Error()), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- GET /api/settings/keys ---

func (srv *Server) handleSettingsKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	var args []string
	if prefix := r.URL.Query().Get("prefix"); prefix != "" {
		args = []string{prefix}
	}
	res, err := srv.mp.RunChecked(r.Context(), "get", args, map[string]any{"--keys": true}, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	var keys []string
	for _, line := range strings.Split(res.Stdout, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			keys = append(keys, line)
		}
	}
	if keys == nil {
		keys = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
}

// --- GET /api/settings ---

func (srv *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	ctx := r.Context()
	keysRes, err := srv.mp.RunChecked(ctx, "get", nil, map[string]any{"--keys": true}, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	var keys []string
	for _, line := range strings.Split(keysRes.Stdout, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			keys = append(keys, line)
		}
	}

	type pair struct {
		key   string
		value string
	}
	pairsCh := make(chan pair, len(keys))
	var wg sync.WaitGroup
	for _, k := range keys {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			res, err := srv.mp.RunChecked(ctx, "get", []string{key}, map[string]any{"--raw": true}, "")
			if err != nil {
				return
			}
			pairsCh <- pair{key: key, value: res.Stdout}
		}(k)
	}
	wg.Wait()
	close(pairsCh)

	values := make(map[string]string)
	for p := range pairsCh {
		values[p.key] = p.value
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": values})
}

// --- GET /api/settings/{key} ---

func (srv *Server) handleGetSetting(w http.ResponseWriter, r *http.Request, key string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	val, ok, err := srv.appConfig.Get(key)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"key": key, "value": ""})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": key, "value": val})
}

// --- PUT /api/settings/{key} ---

func (srv *Server) handlePutSetting(w http.ResponseWriter, r *http.Request, key string) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Value string `json:"value"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if err := srv.appConfig.Set(key, body.Value); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- GET /api/activity ---

func (srv *Server) handleGetActivity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	q := r.URL.Query()
	limit := 100
	if s := q.Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}
	action := q.Get("action")
	vmName := q.Get("vm_name")

	records, err := srv.activity.List(limit, action, vmName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if records == nil {
		records = []store.ActivityRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"activity": records})
}

// --- GET /api/stats ---

func (srv *Server) handleGetStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	containers, err := srv.mp.ListContainers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}

	total := len(containers)
	running, stopped, suspended := 0, 0, 0
	usedRam := int64(0)
	var cpuPercent float64
	for _, c := range containers {
		switch strings.ToLower(c.State) {
		case "running":
			running++
			name := c.ID
			if len(c.Names) > 0 {
				name = strings.TrimPrefix(c.Names[0], "/")
			}
			points := srv.metrics.Get(name)
			if len(points) > 0 {
				last := points[len(points)-1]
				usedRam += last.RAMUsed
				cpuPercent += last.CPU
			}
		case "paused":
			suspended++
		default:
			stopped++
		}
	}

	usedDisk := int64(0)
	for _, c := range containers {
		usedDisk += c.SizeRootFs
	}

	var diskTotalGB int64 = 100
	var statfs syscall.Statfs_t
	if err := syscall.Statfs("/", &statfs); err == nil {
		diskTotalGB = int64(statfs.Blocks) * int64(statfs.Bsize) / (1024 * 1024 * 1024)
	}
	totalDisk := diskTotalGB * 1024 * 1024 * 1024
	totalCpus := int64(runtime.NumCPU())
	totalRam := detectHostMemoryMB() * 1024 * 1024

	writeJSON(w, http.StatusOK, map[string]any{
		"daemon_running": true,
		"total":          total,
		"running":        running,
		"stopped":        stopped,
		"suspended":      suspended,
		"total_cpus":     totalCpus,
		"cpu_percent":    cpuPercent,
		"total_ram":      totalRam,
		"used_ram":       usedRam,
		"total_disk":     totalDisk,
		"used_disk":      usedDisk,
	})
}

// --- GET /api/templates ---

func (srv *Server) handleGetTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	templates, err := srv.templates.ListAll()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": templates})
}

// --- POST /api/templates ---

func (srv *Server) handleCreateTemplate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		CPUs        int    `json:"cpus"`
		MemoryMB    int    `json:"memory_mb"`
		DiskGB      int    `json:"disk_gb"`
		Image       string `json:"image"`
		Tier        string `json:"tier"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Name == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "name is required"})
		return
	}
	if body.Image == "" {
		body.Image = "24.04"
	}
	if body.CPUs < 1 {
		body.CPUs = 1
	}
	if body.MemoryMB < 128 {
		body.MemoryMB = 1024
	}
	if body.DiskGB < 1 {
		body.DiskGB = 10
	}

	if _, err := srv.templates.Create(body.Name, body.Description, body.Image, body.Tier, body.CPUs, body.MemoryMB, body.DiskGB); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	templates, _ := srv.templates.ListAll()
	writeJSON(w, http.StatusOK, map[string]any{"templates": templates})
}

// --- DELETE /api/templates/{id} ---

func (srv *Server) handleDeleteTemplate(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	if strings.HasPrefix(id, "builtin-") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot delete built-in templates"})
		return
	}
	deleted, err := srv.templates.Delete(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !deleted {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "template not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "error": ""})
}

// --- helpers ---

var cliDateFormats = []string{
	"Mon Jan 2 15:04:05 2006 MST",
	"Mon Jan _2 15:04:05 2006 MST",
	"2006-01-02T15:04:05Z07:00",
	"2006-01-02 15:04:05",
}

func normalizeCLIDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	for _, layout := range cliDateFormats {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
	}
	return s
}

func normalizeSnapshots(data any) []map[string]any {
	if data == nil {
		return nil
	}
	if arr, ok := data.([]any); ok {
		return toMapSlice(arr)
	}
	dm, ok := data.(map[string]any)
	if !ok {
		return nil
	}
	for _, key := range []string{"list", "snapshots"} {
		if v, ok := dm[key]; ok {
			if arr, ok := v.([]any); ok {
				return toMapSlice(arr)
			}
		}
	}
	// Snapshot detail formats can be nested under info.instance.snapshots.snapshotName
	// or under info.instance.snapshotName.
	if info, ok := dm["info"].(map[string]any); ok {
		var result []map[string]any
		for instance, instData := range info {
			instMap, ok := instData.(map[string]any)
			if !ok {
				continue
			}
			// New format: nested under "snapshots" key
			if snapsMap, ok := instMap["snapshots"].(map[string]any); ok {
				for snapName, meta := range snapsMap {
					item := map[string]any{"instance": instance, "snapshot": snapName}
					if metaMap, ok := meta.(map[string]any); ok {
						for k, v := range metaMap {
							if k == "created" {
								if s, ok := v.(string); ok {
									item[k] = normalizeCLIDate(s)
									continue
								}
							}
							item[k] = v
						}
					}
					result = append(result, item)
				}
				continue
			}
			// Old format: info.instance.snapshotName (from list --snapshots)
			for snapName, meta := range instMap {
				item := map[string]any{"instance": instance, "snapshot": snapName}
				if metaMap, ok := meta.(map[string]any); ok {
					for k, v := range metaMap {
						item[k] = v
					}
				}
				result = append(result, item)
			}
		}
		return result
	}
	return nil
}

func toMapSlice(arr []any) []map[string]any {
	result := make([]map[string]any, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]any); ok {
			result = append(result, m)
		}
	}
	return result
}

func toInt64Generic(v any) int64 {
	if v == nil {
		return 0
	}
	switch n := v.(type) {
	case int64:
		return n
	case float64:
		return int64(n)
	case int:
		return int64(n)
	case string:
		i, _ := strconv.ParseInt(n, 10, 64)
		return i
	}
	return 0
}

func probeUpdatesScript() string {
	return `set -euo pipefail
UPGRADABLE=0; SECURITY=0; SOURCE='none'
if [ -x /usr/lib/update-notifier/apt-check ]; then
  RAW=$(/usr/lib/update-notifier/apt-check 2>/dev/null || true)
  if echo "$RAW" | grep -Eq '^[0-9]+;[0-9]+$'; then
    UPGRADABLE=${RAW%%;*}; SECURITY=${RAW##*;}; SOURCE='apt-check'
  fi
fi
PACKAGES=$(apt list --upgradable 2>/dev/null | tail -n +2 | sed '/^\s*$/d' | head -n 25 || true)
if [ "$SOURCE" = 'none' ]; then
  if [ -n "$PACKAGES" ]; then
    UPGRADABLE=$(printf "%s\n" "$PACKAGES" | wc -l | tr -d ' ')
  else
    UPGRADABLE=0
  fi
  SECURITY=0; SOURCE='apt-list'
fi
if [ -f /var/run/reboot-required ]; then REBOOT_REQUIRED=true; else REBOOT_REQUIRED=false; fi
echo "UPGRADABLE=$UPGRADABLE"
echo "SECURITY=$SECURITY"
echo "SOURCE=$SOURCE"
echo "REBOOT_REQUIRED=$REBOOT_REQUIRED"
echo "PACKAGES_BEGIN"
printf "%s\n" "$PACKAGES"
echo "PACKAGES_END"`
}

func probeSSHPasswordStatusScript(username string) string {
	uq := shellQuote(username)
	return `set -euo pipefail
PASSWORD_AUTH=''
if command -v sshd >/dev/null 2>&1; then
  PASSWORD_AUTH=$(sshd -T 2>/dev/null | awk '/^passwordauthentication /{print tolower($2); exit}' || true)
fi
if [ -z "$PASSWORD_AUTH" ]; then
  PASSWORD_AUTH=$(grep -hE '^\s*PasswordAuthentication\s+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | tail -n1 | awk '{print tolower($2)}' || true)
fi
if [ -z "$PASSWORD_AUTH" ]; then PASSWORD_AUTH='no'; fi
PASS_STATUS=$(sudo passwd -S ` + uq + ` 2>/dev/null | awk '{print $2}' || true)
if [ "$PASS_STATUS" = 'L' ]; then ACCOUNT_LOCKED=true; else ACCOUNT_LOCKED=false; fi
echo "PASSWORD_AUTH=$PASSWORD_AUTH"
echo "ACCOUNT_LOCKED=$ACCOUNT_LOCKED"`
}

func parseUpdatesProbeOutput(stdout string) (upgradable, security int, rebootRequired bool, source string, packages []string) {
	inPackages := false
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if line == "PACKAGES_BEGIN" {
			inPackages = true
			continue
		}
		if line == "PACKAGES_END" {
			inPackages = false
			continue
		}
		if inPackages {
			packages = append(packages, line)
			continue
		}
		if !strings.Contains(line, "=") {
			continue
		}
		idx := strings.Index(line, "=")
		key := line[:idx]
		val := strings.TrimSpace(line[idx+1:])
		switch key {
		case "UPGRADABLE":
			upgradable, _ = strconv.Atoi(val)
		case "SECURITY":
			security, _ = strconv.Atoi(val)
		case "SOURCE":
			source = val
		case "REBOOT_REQUIRED":
			rebootRequired = parseBool(val, false)
		}
	}
	return
}

func parseKeyValueOutput(s string) map[string]string {
	result := make(map[string]string)
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, "=") {
			continue
		}
		idx := strings.Index(line, "=")
		result[line[:idx]] = strings.TrimSpace(line[idx+1:])
	}
	return result
}

func parseBool(s string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// --- GET /api/fs/check-url?url=... ---

func (srv *Server) handleFsCheckURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url required"})
		return
	}
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "only http/https URLs supported"})
		return
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Head(rawURL)
	if err != nil {
		// Try GET if HEAD fails (some servers don't support HEAD)
		resp, err = client.Get(rawURL)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}
	contentLength := resp.ContentLength
	contentType := resp.Header.Get("Content-Type")
	urlExt := strings.ToLower(filepath.Ext(strings.Split(rawURL, "?")[0]))
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             resp.StatusCode >= 200 && resp.StatusCode < 400,
		"status":         resp.StatusCode,
		"content_length": contentLength,
		"content_type":   contentType,
		"supported":      supportedImageExtensions[urlExt],
	})
}

// --- GET /api/fs/browse?path=... ---

var imageExtensions = map[string]bool{
	".img": true, ".iso": true, ".qcow2": true,
	".vmdk": true, ".vhd": true, ".vhdx": true, ".raw": true,
}

// Only these disk image extensions are accepted by the import flow.
var supportedImageExtensions = map[string]bool{
	".img": true, ".qcow2": true,
}

func (srv *Server) handleFsBrowse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}

	reqPath := r.URL.Query().Get("path")
	if reqPath == "" {
		if home, err := os.UserHomeDir(); err == nil {
			reqPath = home
		} else {
			reqPath = "/"
		}
	}

	// Clean and resolve to absolute path
	reqPath = filepath.Clean(reqPath)

	info, err := os.Stat(reqPath)
	if err != nil || !info.IsDir() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "not a directory"})
		return
	}

	entries, err := os.ReadDir(reqPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	type Entry struct {
		Name      string `json:"name"`
		Path      string `json:"path"`
		IsDir     bool   `json:"is_dir"`
		Size      int64  `json:"size,omitempty"`
		Supported bool   `json:"supported"`
	}

	result := make([]Entry, 0, len(entries))
	for _, e := range entries {
		// Skip hidden files/dirs
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if e.IsDir() {
			result = append(result, Entry{Name: e.Name(), Path: filepath.Join(reqPath, e.Name()), IsDir: true, Supported: true})
		} else if imageExtensions[ext] {
			result = append(result, Entry{Name: e.Name(), Path: filepath.Join(reqPath, e.Name()), IsDir: false, Size: fi.Size(), Supported: supportedImageExtensions[ext]})
		}
	}

	parent := ""
	if reqPath != "/" {
		parent = filepath.Dir(reqPath)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":    reqPath,
		"parent":  parent,
		"entries": result,
	})
}

const passwordAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func generatePassword(length int) string {
	b := make([]byte, length)
	// Use crypto/rand via math/rand seeded approach - we'll use OS directly
	f, err := os.Open("/dev/urandom")
	if err != nil {
		// fallback
		for i := range b {
			b[i] = passwordAlphabet[i%len(passwordAlphabet)]
		}
		return string(b)
	}
	defer f.Close()
	raw := make([]byte, length)
	f.Read(raw) //nolint:errcheck
	for i, c := range raw {
		b[i] = passwordAlphabet[int(c)%len(passwordAlphabet)]
	}
	return string(b)
}
