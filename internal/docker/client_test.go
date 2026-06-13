package docker

import (
	"testing"
)

func TestNormalizeTaggedImageReference(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "implicit docker hub latest", in: "nginx", want: "docker.io/library/nginx:latest"},
		{name: "explicit tag", in: "nginx:1.27", want: "docker.io/library/nginx:1.27"},
		{name: "custom registry", in: "ghcr.io/acme/app:v1", want: "ghcr.io/acme/app:v1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeTaggedImageReference(tt.in)
			if err != nil {
				t.Fatalf("normalizeTaggedImageReference() error = %v", err)
			}
			if got.String() != tt.want {
				t.Fatalf("normalizeTaggedImageReference() = %q, want %q", got.String(), tt.want)
			}
		})
	}
}

func TestNormalizeTaggedImageReferenceRejectsDigestOnly(t *testing.T) {
	_, err := normalizeTaggedImageReference("nginx@sha256:608a100c71651bf5b773c89083b4a1ad7ef4b2bd05d7a7e552271e03123692ad")
	if err == nil {
		t.Fatal("normalizeTaggedImageReference() error = nil, want error")
	}
}

func TestMatchingRepoDigestsUsesRequestedRepository(t *testing.T) {
	ref, err := normalizeTaggedImageReference("nginx:latest")
	if err != nil {
		t.Fatalf("normalizeTaggedImageReference() error = %v", err)
	}

	got := matchingRepoDigests([]string{
		"docker.io/library/redis@sha256:1111111111111111111111111111111111111111111111111111111111111111",
		"nginx@sha256:2222222222222222222222222222222222222222222222222222222222222222",
		"docker.io/library/nginx@sha256:2222222222222222222222222222222222222222222222222222222222222222",
	}, normalizedRepositoryName(ref))

	if len(got) != 1 {
		t.Fatalf("matchingRepoDigests() returned %d digests, want 1: %#v", len(got), got)
	}
	if got[0] != "sha256:2222222222222222222222222222222222222222222222222222222222222222" {
		t.Fatalf("matchingRepoDigests()[0] = %q", got[0])
	}
}

func TestImageUpdateAvailable(t *testing.T) {
	tests := []struct {
		name       string
		local      []string
		remote     []string
		wantUpdate bool
		wantRemote string
	}{
		{
			name:       "matching tag digest",
			local:      []string{"sha256:aaa"},
			remote:     []string{"sha256:aaa", "sha256:bbb"},
			wantRemote: "sha256:aaa",
		},
		{
			name:       "matching platform digest",
			local:      []string{"sha256:bbb"},
			remote:     []string{"sha256:aaa", "sha256:bbb"},
			wantRemote: "sha256:bbb",
		},
		{
			name:       "remote differs",
			local:      []string{"sha256:old"},
			remote:     []string{"sha256:new"},
			wantUpdate: true,
			wantRemote: "sha256:new",
		},
		{
			name:       "remote unavailable",
			local:      []string{"sha256:old"},
			remote:     nil,
			wantRemote: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotUpdate, gotRemote := imageUpdateAvailable(tt.local, tt.remote)
			if gotUpdate != tt.wantUpdate {
				t.Fatalf("imageUpdateAvailable() update = %v, want %v", gotUpdate, tt.wantUpdate)
			}
			if gotRemote != tt.wantRemote {
				t.Fatalf("imageUpdateAvailable() remote = %q, want %q", gotRemote, tt.wantRemote)
			}
		})
	}
}
