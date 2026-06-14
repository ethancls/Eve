package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/distribution/reference"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	imgtype "github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/volume"
	"github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
)

type Client struct {
	cli           *client.Client
	logger        *slog.Logger
	digestCacheMu sync.Mutex
	digestCache   map[string]*digestCacheEntry
}

type digestCacheEntry struct {
	digests []string
	expiry  int64 // unix timestamp
}

func NewClient(logger *slog.Logger) (*Client, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	return &Client{
		cli:         cli,
		logger:      logger,
		digestCache: make(map[string]*digestCacheEntry),
	}, nil
}

func (c *Client) ListContainers(ctx context.Context) ([]container.Summary, error) {
	return c.cli.ContainerList(ctx, container.ListOptions{All: true, Size: true})
}

func (c *Client) GetContainerInfo(ctx context.Context, id string) (container.InspectResponse, error) {
	return c.cli.ContainerInspect(ctx, id)
}

func (c *Client) StartContainer(ctx context.Context, id string) error {
	return c.cli.ContainerStart(ctx, id, container.StartOptions{})
}

func (c *Client) StopContainer(ctx context.Context, id string) error {
	return c.cli.ContainerStop(ctx, id, container.StopOptions{})
}

func (c *Client) RemoveContainer(ctx context.Context, id string, force bool) error {
	return c.cli.ContainerRemove(ctx, id, container.RemoveOptions{Force: force})
}

func (c *Client) RestartContainer(ctx context.Context, id string) error {
	return c.cli.ContainerRestart(ctx, id, container.StopOptions{})
}

func (c *Client) RecreateContainer(ctx context.Context, id string) error {
	info, err := c.cli.ContainerInspect(ctx, id)
	if err != nil {
		return err
	}
	// pull latest image
	_, _ = c.cli.ImagePull(ctx, info.Config.Image, imgtype.PullOptions{})

	// remove old container
	if err := c.cli.ContainerRemove(ctx, id, container.RemoveOptions{Force: true}); err != nil {
		return err
	}

	// create new container
	name := info.Name
	if len(name) > 0 && name[0] == '/' {
		name = name[1:]
	}

	resp, err := c.cli.ContainerCreate(ctx, info.Config, info.HostConfig, nil, nil, name)
	if err != nil {
		return err
	}

	return c.cli.ContainerStart(ctx, resp.ID, container.StartOptions{})
}

func (c *Client) ListImages(ctx context.Context) ([]imgtype.Summary, error) {
	return c.cli.ImageList(ctx, imgtype.ListOptions{All: true})
}

func (c *Client) ContainerLogs(ctx context.Context, id string) (io.ReadCloser, error) {
	return c.cli.ContainerLogs(ctx, id, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Timestamps: true,
		Tail:       "500",
	})
}

func (c *Client) ContainerStats(ctx context.Context, id string, stream bool) (io.ReadCloser, error) {
	stats, err := c.cli.ContainerStats(ctx, id, stream)
	if err != nil {
		return nil, err
	}
	return stats.Body, nil
}

func (c *Client) ListNetworks(ctx context.Context) ([]network.Summary, error) {
	return c.cli.NetworkList(ctx, network.ListOptions{})
}

func (c *Client) ListVolumes(ctx context.Context) ([]*volume.Volume, error) {
	res, err := c.cli.VolumeList(ctx, volume.ListOptions{})
	if err != nil {
		return nil, err
	}
	return res.Volumes, nil
}

func (c *Client) RemoveVolume(ctx context.Context, name string) error {
	return c.cli.VolumeRemove(ctx, name, true)
}

func (c *Client) ServerVersion(ctx context.Context) (*types.Version, error) {
	v, err := c.cli.ServerVersion(ctx)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (c *Client) Ping(ctx context.Context) error {
	_, err := c.cli.Ping(ctx)
	if err != nil {
		return fmt.Errorf("failed to ping docker daemon: %w", err)
	}
	return nil
}

type SystemState struct {
	Installed bool   `json:"installed"`
	Running   bool   `json:"running"`
	Error     string `json:"error"`
}

func (c *Client) SystemState(ctx context.Context) SystemState {
	err := c.Ping(ctx)
	if err != nil {
		return SystemState{Installed: true, Running: false, Error: err.Error()}
	}
	return SystemState{Installed: true, Running: true}
}

func (c *Client) RunJSONChecked(ctx context.Context, cmd string, args []string, opts map[string]any) (any, any, error) {
	return nil, nil, fmt.Errorf("not implemented")
}

func (c *Client) RunChecked(ctx context.Context, cmd string, args []string, opts map[string]any, stdin string) (struct {
	Stdout string
	Stderr string
}, error) {
	return struct {
		Stdout string
		Stderr string
	}{}, fmt.Errorf("not implemented")
}

func (c *Client) Run(ctx context.Context, cmd string, args []string, opts map[string]any, stdin string) (struct {
	Stdout     string
	Stderr     string
	ExitCode   int
	DurationMs int64
}, error) {
	return struct {
		Stdout     string
		Stderr     string
		ExitCode   int
		DurationMs int64
	}{}, fmt.Errorf("not implemented")
}

func (c *Client) GetAllInstancesInfo(ctx context.Context, full bool) ([]map[string]any, error) {
	return nil, fmt.Errorf("not implemented")
}

func (c *Client) GetInstanceInfo(ctx context.Context, name string) (map[string]any, error) {
	return nil, fmt.Errorf("not implemented")
}

func (c *Client) CreateAndStartContainer(ctx context.Context, imageName string, name string, args []string, env map[string]string, ports map[string]string) (string, error) {
	// First pull the image if we don't have it locally
	_, err := c.cli.ImagePull(ctx, imageName, imgtype.PullOptions{})
	if err != nil {
		// Log the error but continue, it might be a local image
	}

	config := &container.Config{
		Image: imageName,
		Cmd:   args,
	}

	if env != nil {
		for k, v := range env {
			config.Env = append(config.Env, fmt.Sprintf("%s=%s", k, v))
		}
	}

	hostConfig := &container.HostConfig{
		PortBindings: make(nat.PortMap),
	}

	if ports != nil {
		for cPort, hPort := range ports {
			p, err := nat.NewPort("tcp", cPort)
			if err == nil {
				hostConfig.PortBindings[p] = []nat.PortBinding{{HostIP: "0.0.0.0", HostPort: hPort}}
			}
		}
	}

	resp, err := c.cli.ContainerCreate(ctx, config, hostConfig, nil, nil, name)
	if err != nil {
		return "", err
	}

	if err := c.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return resp.ID, err
	}

	return resp.ID, nil
}

type ImageUpdateInfo struct {
	Image           string `json:"image"`
	LocalDigest     string `json:"local_digest"`
	RemoteDigest    string `json:"remote_digest"`
	LatestTag       string `json:"latest_tag"`
	UpdateAvailable bool   `json:"update_available"`
	Error           string `json:"error,omitempty"`
}

func (c *Client) CheckImageUpdate(ctx context.Context, imageName string) (*ImageUpdateInfo, error) {
	localInspect, _, err := c.cli.ImageInspectWithRaw(ctx, imageName)
	if err != nil {
		return &ImageUpdateInfo{Image: imageName, Error: "image not found locally"}, nil
	}

	imageRef, err := normalizeTaggedImageReference(imageName)
	if err != nil {
		return &ImageUpdateInfo{Image: imageName, Error: err.Error()}, nil
	}
	repository := normalizedRepositoryName(imageRef)

	localDigests := matchingRepoDigests(localInspect.RepoDigests, repository)
	if len(localDigests) == 0 {
		return &ImageUpdateInfo{
			Image: imageName,
			Error: "local repository digest unavailable",
		}, nil
	}
	localDigest := localDigests[0]

	remoteDigests := c.fetchRemoteDigests(ctx, imageRef)
	updateAvailable, remoteDigest := imageUpdateAvailable(localDigests, remoteDigests)

	return &ImageUpdateInfo{
		Image:           imageName,
		LocalDigest:     localDigest,
		RemoteDigest:    remoteDigest,
		UpdateAvailable: updateAvailable,
	}, nil
}

func normalizeTaggedImageReference(imageName string) (reference.Named, error) {
	named, err := reference.ParseNormalizedNamed(imageName)
	if err != nil {
		return nil, fmt.Errorf("invalid image reference")
	}
	if _, digested := named.(reference.Digested); digested {
		if _, tagged := named.(reference.Tagged); !tagged {
			return nil, fmt.Errorf("digest-pinned image cannot be checked for tag updates")
		}
	}
	return reference.TagNameOnly(named), nil
}

func normalizedRepositoryName(named reference.Named) string {
	trimmed := reference.TrimNamed(named)
	return reference.Domain(trimmed) + "/" + reference.Path(trimmed)
}

func matchingRepoDigests(repoDigests []string, repository string) []string {
	var digests []string
	for _, repoDigest := range repoDigests {
		named, err := reference.ParseNormalizedNamed(repoDigest)
		if err != nil {
			continue
		}
		if normalizedRepositoryName(named) != repository {
			continue
		}
		digested, ok := named.(reference.Digested)
		if !ok {
			continue
		}
		digests = appendUniqueDigest(digests, digested.Digest().String())
	}
	return digests
}

func appendUniqueDigest(digests []string, digest string) []string {
	if digest == "" {
		return digests
	}
	for _, existing := range digests {
		if existing == digest {
			return digests
		}
	}
	return append(digests, digest)
}

func imageUpdateAvailable(localDigests, remoteDigests []string) (bool, string) {
	if len(remoteDigests) == 0 {
		return false, ""
	}
	remoteDigest := remoteDigests[0]
	for _, localDigest := range localDigests {
		for _, digest := range remoteDigests {
			if localDigest == digest {
				return false, digest
			}
		}
	}
	return true, remoteDigest
}

func (c *Client) fetchRemoteDigests(ctx context.Context, imageRef reference.Named) []string {
	cacheKey := imageRef.String()
	now := time.Now().Unix()

	c.digestCacheMu.Lock()
	if entry, ok := c.digestCache[cacheKey]; ok && entry.expiry > now {
		digests := append([]string(nil), entry.digests...)
		c.digestCacheMu.Unlock()
		return digests
	}
	c.digestCacheMu.Unlock()

	var digests []string
	if dist, err := c.cli.DistributionInspect(ctx, imageRef.String(), ""); err == nil {
		digests = appendUniqueDigest(digests, dist.Descriptor.Digest.String())
	} else {
		c.logger.Warn("registry digest inspect failed", "image", imageRef.String(), "error", err)
	}

	for _, digest := range c.fetchDockerHubDigests(ctx, imageRef) {
		digests = appendUniqueDigest(digests, digest)
	}

	c.digestCacheMu.Lock()
	c.digestCache[cacheKey] = &digestCacheEntry{digests: append([]string(nil), digests...), expiry: now + 1800}
	c.digestCacheMu.Unlock()

	return digests
}

// fetchDockerHubDigests returns the tag digest and platform-specific digests for a Docker Hub tag.
func (c *Client) fetchDockerHubDigests(ctx context.Context, imageRef reference.Named) []string {
	if reference.Domain(imageRef) != "docker.io" {
		return nil
	}

	tagged, ok := imageRef.(reference.Tagged)
	if !ok {
		return nil
	}

	pathParts := strings.SplitN(reference.Path(imageRef), "/", 2)
	if len(pathParts) != 2 {
		return nil
	}
	namespace := pathParts[0]
	repo := pathParts[1]
	tag := tagged.Tag()

	url := fmt.Sprintf("https://hub.docker.com/v2/repositories/%s/%s/tags/%s", namespace, repo, tag)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		c.logger.Warn("docker hub digest request failed", "image", imageRef.String(), "error", err)
		return nil
	}
	req.Header.Set("User-Agent", "Eve/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.logger.Warn("docker hub digest fetch failed", "image", imageRef.String(), "error", err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		c.logger.Warn("docker hub digest non-200", "image", imageRef.String(), "status", resp.StatusCode)
		return nil
	}

	var tagInfo struct {
		Digest string `json:"digest"`
		Images []struct {
			Digest string `json:"digest"`
		} `json:"images"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tagInfo); err != nil {
		c.logger.Warn("docker hub digest parse failed", "image", imageRef.String(), "error", err)
		return nil
	}

	var digests []string
	digests = appendUniqueDigest(digests, tagInfo.Digest)
	for _, img := range tagInfo.Images {
		digests = appendUniqueDigest(digests, img.Digest)
	}

	return digests
}

func (c *Client) PullImage(ctx context.Context, imageName string) error {
	_, err := c.cli.ImagePull(ctx, imageName, imgtype.PullOptions{})
	return err
}

func (c *Client) RemoveImage(ctx context.Context, imageName string, force bool) error {
	_, err := c.cli.ImageRemove(ctx, imageName, imgtype.RemoveOptions{Force: force})
	return err
}

func (c *Client) InvalidateCache() {}

func (c *Client) PruneSystem(ctx context.Context) error {
	pruneFilters := filters.NewArgs()

	if _, err := c.cli.ContainersPrune(ctx, pruneFilters); err != nil {
		c.logger.Error("failed to prune containers", "error", err)
	}
	if _, err := c.cli.ImagesPrune(ctx, pruneFilters); err != nil {
		c.logger.Error("failed to prune images", "error", err)
	}
	if _, err := c.cli.VolumesPrune(ctx, pruneFilters); err != nil {
		c.logger.Error("failed to prune volumes", "error", err)
	}
	if _, err := c.cli.NetworksPrune(ctx, pruneFilters); err != nil {
		c.logger.Error("failed to prune networks", "error", err)
	}

	return nil
}
