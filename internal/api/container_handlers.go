package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/docker/docker/pkg/stdcopy"
	"github.com/user/eve/internal/store"
)

func (srv *Server) handleContainerSystem(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		err := srv.mp.Ping(r.Context())
		state := map[string]any{
			"installed": true,
			"running":   err == nil,
			"binary":    "docker",
			"socket":    "unix:///var/run/docker.sock",
		}
		if err != nil {
			state["error"] = err.Error()
		}
		writeJSON(w, http.StatusOK, map[string]any{"system": state})
	} else {
		methodNotAllowed(w)
	}
}

func (srv *Server) handleSystemPrune(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if err := srv.mp.PruneSystem(r.Context()); err != nil {
		srv.logAction("prune", "", "error", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	srv.logAction("prune", "", "ok", "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "pruned successfully"})
}

func (srv *Server) handleContainersDispatch(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		items, err := srv.mp.ListContainers(r.Context())
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}

		var mapped []map[string]any
		for _, c := range items {
			name := "unknown"
			if len(c.Names) > 0 {
				name = strings.TrimPrefix(c.Names[0], "/")
			}
			mapped = append(mapped, map[string]any{
				"id":           c.ID,
				"name":         name,
				"image":        c.Image,
				"state":        c.State,
				"status":       c.Status,
				"created":      c.Created * 1000,
				"size_rw":      c.SizeRw,
				"size_root_fs": c.SizeRootFs,
				"raw":          c,
			})
		}
		if mapped == nil {
			mapped = []map[string]any{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"containers": mapped})
	case http.MethodPost:
		var body struct {
			Image   string   `json:"image"`
			Name    string   `json:"name"`
			Args    []string `json:"args"`
			Options struct {
				Env   map[string]string `json:"env"`
				Ports map[string]string `json:"ports"`
			} `json:"options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return
		}

		id, err := srv.mp.CreateAndStartContainer(r.Context(), body.Image, body.Name, body.Args, body.Options.Env, body.Options.Ports)
		if err != nil {
			srv.logAction("container create", body.Name, "error", err.Error())
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		srv.logAction("container create", body.Name, "ok", "")
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "started"})
	default:
		methodNotAllowed(w)
	}
}

func (srv *Server) routeContainers(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/containers/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	name := parts[0]
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			info, err := srv.mp.GetContainerInfo(r.Context(), name)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
				return
			}
			imageName := ""
			cmdStr := ""
			if info.Config != nil {
				imageName = info.Config.Image
				cmdStr = strings.Join(info.Config.Cmd, " ")
			}
			stateStr := ""
			if info.State != nil {
				stateStr = info.State.Status
			}
			mapped := map[string]any{
				"name":    strings.TrimPrefix(info.Name, "/"),
				"image":   imageName,
				"command": cmdStr,
				"created": info.Created,
				"state":   stateStr,
				"raw":     info,
			}
			writeJSON(w, http.StatusOK, map[string]any{"container": mapped})
		case http.MethodDelete:
			err := srv.mp.RemoveContainer(r.Context(), name, true)
			if err != nil {
				srv.logAction("container remove", name, "error", err.Error())
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			srv.logAction("container remove", name, "ok", "")
			writeJSON(w, http.StatusOK, map[string]any{"status": "success"})
		default:
			methodNotAllowed(w)
		}
		return
	}

	switch parts[1] {
	case "actions":
		if len(parts) != 3 || r.Method != http.MethodPost {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		action := parts[2]
		var err error
		if action == "start" {
			err = srv.mp.StartContainer(r.Context(), name)
		} else if action == "stop" {
			err = srv.mp.StopContainer(r.Context(), name)
		} else if action == "delete" || action == "kill" {
			err = srv.mp.RemoveContainer(r.Context(), name, true)
		} else if action == "restart" {
			err = srv.mp.RestartContainer(r.Context(), name)
		} else if action == "recreate" {
			err = srv.mp.RecreateContainer(r.Context(), name)
		} else {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "unsupported action"})
			return
		}

		if err != nil {
			srv.logAction("container "+action, name, "error", err.Error())
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		srv.logAction("container "+action, name, "ok", "")
		writeJSON(w, http.StatusOK, map[string]any{"status": "success"})
	case "logs":
		logsReader, err := srv.mp.ContainerLogs(r.Context(), name)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		defer logsReader.Close()

		inspectResp, inspectErr := srv.mp.GetContainerInfo(r.Context(), name)
		isTty := false
		if inspectErr == nil && inspectResp.Config != nil {
			isTty = inspectResp.Config.Tty
		}

		buf := new(strings.Builder)
		if isTty {
			io.Copy(buf, logsReader)
		} else {
			stdcopy.StdCopy(buf, buf, logsReader)
		}
		writeJSON(w, http.StatusOK, map[string]string{"logs": buf.String()})
	case "stats":
		points := srv.metrics.Get(name)
		if len(points) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{
				"cpu": 0,
				"memory": map[string]any{
					"used":  0,
					"total": 0,
				},
			})
			return
		}
		lastPoint := points[len(points)-1]
		writeJSON(w, http.StatusOK, map[string]any{
			"cpu": lastPoint.CPU,
			"memory": map[string]any{
				"used":  lastPoint.RAMUsed,
				"total": lastPoint.RAMTotal,
			},
		})
	case "history":
		points := srv.metrics.Get(name)
		if points == nil {
			points = []store.MetricPoint{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"history": points})
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (srv *Server) handleLocalImages(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		items, err := srv.mp.ListImages(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		containers, _ := srv.mp.ListContainers(r.Context())
		imageContainers := make(map[string][]string)
		for _, c := range containers {
			name := "unknown"
			if len(c.Names) > 0 {
				name = strings.TrimPrefix(c.Names[0], "/")
			}
			if c.Image != "" {
				imageContainers[c.Image] = append(imageContainers[c.Image], name)
			}
			if c.ImageID != "" {
				imageContainers[strings.TrimPrefix(c.ImageID, "sha256:")] = append(imageContainers[strings.TrimPrefix(c.ImageID, "sha256:")], name)
				imageContainers[c.ImageID] = append(imageContainers[c.ImageID], name)
			}
		}
		var mapped []map[string]any
		for _, img := range items {
			name := "<none>"
			if len(img.RepoTags) > 0 && img.RepoTags[0] != "<none>:<none>" {
				name = img.RepoTags[0]
			}
			attached := []string{}
			seen := make(map[string]bool)
			refs := append([]string{img.ID, strings.TrimPrefix(img.ID, "sha256:"), name}, img.RepoTags...)
			for _, ref := range refs {
				for _, containerName := range imageContainers[ref] {
					if !seen[containerName] {
						attached = append(attached, containerName)
						seen[containerName] = true
					}
				}
			}
			mapped = append(mapped, map[string]any{
				"id":         strings.TrimPrefix(img.ID, "sha256:"),
				"name":       name,
				"size":       img.Size,
				"created":    img.Created,
				"containers": attached,
				"raw":        img,
			})
		}
		if mapped == nil {
			mapped = []map[string]any{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"images": mapped})
		return
	}

	if r.Method == http.MethodPost {
		var body struct {
			Action string `json:"action"`
			Image  string `json:"image"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return
		}
		switch body.Action {
		case "pull":
			if err := srv.mp.PullImage(r.Context(), body.Image); err != nil {
				srv.logAction("image pull", body.Image, "error", err.Error())
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			srv.logAction("image pull", body.Image, "ok", "")
			writeJSON(w, http.StatusOK, map[string]any{"status": "pulled"})
		case "delete":
			if err := srv.mp.RemoveImage(r.Context(), body.Image, true); err != nil {
				srv.logAction("image delete", body.Image, "error", err.Error())
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			srv.logAction("image delete", body.Image, "ok", "")
			writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
		default:
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "unsupported action"})
		}
		return
	}

	methodNotAllowed(w)
}

func (srv *Server) handleRegistrySearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	provider := r.URL.Query().Get("provider")
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}})
		return
	}
	if provider == "" {
		provider = "docker.io"
	}

	var searchURL string
	if strings.Contains(provider, "ghcr.io") {
		searchURL = fmt.Sprintf("https://api.github.com/search/repositories?q=%s", url.QueryEscape(q))
		req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, searchURL, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		defer resp.Body.Close()
		var githubResp struct {
			Items []struct {
				FullName    string `json:"full_name"`
				Description string `json:"description"`
				Stargazers  int    `json:"stargazers_count"`
			} `json:"items"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&githubResp); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse github response"})
			return
		}
		var results []map[string]any
		for _, item := range githubResp.Items {
			results = append(results, map[string]any{
				"name":        "ghcr.io/" + item.FullName,
				"description": item.Description,
				"star_count":  item.Stargazers,
				"is_official": false,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"results": results})
		return
	}

	// docker.io fallback search
	searchURL = fmt.Sprintf("https://hub.docker.com/v2/search/repositories/?query=%s&page_size=25", url.QueryEscape(q))
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, searchURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	var hubResp struct {
		Results []struct {
			RepoName    string `json:"repo_name"`
			Description string `json:"short_description"`
			StarCount   int    `json:"star_count"`
			IsOfficial  bool   `json:"is_official"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&hubResp); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse hub response"})
		return
	}
	var results []map[string]any
	for _, item := range hubResp.Results {
		results = append(results, map[string]any{
			"name":        item.RepoName,
			"description": item.Description,
			"star_count":  item.StarCount,
			"is_official": item.IsOfficial,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (srv *Server) handleRegistryTags(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	provider := r.URL.Query().Get("provider")
	image := r.URL.Query().Get("image")
	if image == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "image is required"})
		return
	}

	if provider == "" || provider == "docker.io" {
		parts := strings.SplitN(image, "/", 2)
		namespace := "library"
		repo := image
		if len(parts) == 2 {
			namespace = parts[0]
			repo = parts[1]
		}
		tagURL := fmt.Sprintf("https://hub.docker.com/v2/namespaces/%s/repositories/%s/tags?page_size=100", namespace, repo)
		req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, tagURL, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		defer resp.Body.Close()
		var tagsResp struct {
			Results []struct {
				Name string `json:"name"`
			} `json:"results"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&tagsResp); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse hub response"})
			return
		}
		var tags []string
		for _, item := range tagsResp.Results {
			tags = append(tags, item.Name)
		}
		writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
		return
	}

	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "fetching tags for this provider is not supported yet"})
}

func (srv *Server) handleImageUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	image := r.URL.Query().Get("image")
	if image == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "image is required"})
		return
	}
	info, err := srv.mp.CheckImageUpdate(r.Context(), image)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (srv *Server) handleRegistries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	registries := []map[string]string{
		{"name": "Docker Hub", "provider": "docker.io", "url": "https://hub.docker.com"},
		{"name": "GitHub Container Registry", "provider": "ghcr.io", "url": "https://ghcr.io"},
	}
	writeJSON(w, http.StatusOK, map[string]any{"registries": registries})
}

func (srv *Server) handleVolumes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		vols, err := srv.mp.ListVolumes(r.Context())
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		containers, _ := srv.mp.ListContainers(r.Context())
		volumeContainers := make(map[string][]string)
		for _, c := range containers {
			name := "unknown"
			if len(c.Names) > 0 {
				name = strings.TrimPrefix(c.Names[0], "/")
			}
			for _, m := range c.Mounts {
				if m.Name == "" {
					continue
				}
				volumeContainers[m.Name] = append(volumeContainers[m.Name], name)
			}
		}

		var results []map[string]any
		for _, v := range vols {
			attached := volumeContainers[v.Name]
			if attached == nil {
				attached = []string{}
			}
			entry := map[string]any{
				"name":       v.Name,
				"driver":     v.Driver,
				"mountpoint": v.Mountpoint,
				"scope":      v.Scope,
				"labels":     v.Labels,
				"containers": attached,
			}
			if v.UsageData != nil {
				entry["size"] = v.UsageData.Size
				entry["ref_count"] = v.UsageData.RefCount
			}
			results = append(results, entry)
		}

		writeJSON(w, http.StatusOK, map[string]any{"volumes": results})
		return
	}
	methodNotAllowed(w)
}

func (srv *Server) routeVolumes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/volumes/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	name := parts[0]

	if r.Method == http.MethodDelete {
		if err := srv.mp.RemoveVolume(r.Context(), name); err != nil {
			srv.logAction("volume remove", name, "error", err.Error())
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		srv.logAction("volume remove", name, "ok", "")
		writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
		return
	}
	methodNotAllowed(w)
}

func (srv *Server) handleBuilder(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"})
}

func (srv *Server) handleMachines(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"})
}

func (srv *Server) routeMachines(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"})
}

func (srv *Server) handleContainerProperties(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"})
}

func cloneOptions(m map[string]any) map[string]any {
	if m == nil {
		return make(map[string]any)
	}
	res := make(map[string]any, len(m))
	for k, v := range m {
		res[k] = v
	}
	return res
}
