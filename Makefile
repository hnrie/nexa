GO ?= go
NODE_BIN ?= /usr/local/lib/nodejs/current/bin
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
export PATH := $(NODE_BIN):$(PATH)

.PHONY: build web server test test-go test-web test-desktop desktop publish-desktop run clean

build: web server

web:
	cd web && npm ci --no-audit --no-fund && npm run build

server:
	$(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/chatd ./cmd/chatd

test: test-go test-web test-desktop

test-go:
	$(GO) vet ./... && $(GO) test -race ./...

test-web:
	cd web && npm run typecheck && npm test -- --run

test-desktop:
	cd desktop && npm run typecheck && npm test

# the desktop app's installers for every platform, into desktop/dist (runs on macOS)
desktop:
	cd desktop && npm ci --no-audit --no-fund && npm run build && npx electron-builder --mac --win --linux --publish never

# copies desktop/dist into DESKTOP_DIR, where chatd serves downloads and updates
publish-desktop:
	python3 tools/publish_desktop.py desktop/dist

run: server
	./bin/chatd

clean:
	rm -rf bin web/dist
