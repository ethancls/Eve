SHELL := /usr/bin/env bash
GO_GOBIN := $(shell go env GOBIN 2>/dev/null)
GO_GOPATH := $(shell go env GOPATH 2>/dev/null)
GO_BIN := $(strip $(if $(GO_GOBIN),$(GO_GOBIN),$(GO_GOPATH)/bin))
PATH_EXT := $(GO_BIN)
SERVICE_USER ?= $(shell id -un)

.PHONY: dev build run macos-app install uninstall service-status logs

## Hot reload: Go backend (air) + frontend Vite HMR en parallèle
dev:
	@mkdir -p tmp
	@export PATH="$(PATH_EXT):$$PATH"; \
	export EVE_BIND=0.0.0.0:8100; \
	trap 'kill 0' SIGINT SIGTERM; \
	if command -v air >/dev/null 2>&1; then \
		air & \
	else \
		echo "air not found, starting backend without hot reload"; \
		go run . & \
	fi; \
	npm run dev --prefix frontend & \
	wait

## Build production (frontend embarqué dans le binaire Go)
build:
	@export PATH="$(PATH_EXT):$$PATH"; \
	npm run build --prefix frontend && \
	CGO_ENABLED=0 go build -ldflags="-s -w" -o eve . && \
	echo "→ ./eve ($$(du -sh eve | cut -f1))"

## Lance le binaire de prod
run: build
	./eve

macos-app:
	./scripts/package-macos.sh

install:
	@if command -v systemctl >/dev/null 2>&1; then \
		./deploy/install.sh; \
	else \
		echo "install target is Linux/systemd-only. On macOS, use: make build && ./eve"; \
	fi

uninstall:
	@if command -v systemctl >/dev/null 2>&1; then \
		sudo ./deploy/uninstall.sh; \
	else \
		echo "uninstall target is Linux/systemd-only."; \
	fi

service-status:
	@if command -v systemctl >/dev/null 2>&1; then \
		systemctl --no-pager status "eve@$(SERVICE_USER)"; \
	else \
		echo "service-status is Linux/systemd-only."; \
	fi

logs:
	@if command -v systemctl >/dev/null 2>&1; then \
		journalctl -u "eve@$(SERVICE_USER)" -f; \
	else \
		echo "logs target is Linux/systemd-only."; \
	fi
