GO ?= go
NODE_BIN ?= /usr/local/lib/nodejs/current/bin
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
export PATH := $(NODE_BIN):$(PATH)

.PHONY: build web server test test-go test-web run clean

build: web server

web:
	cd web && npm ci --no-audit --no-fund && npm run build

server:
	$(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/chatd ./cmd/chatd

test: test-go test-web

test-go:
	$(GO) vet ./... && $(GO) test -race ./...

test-web:
	cd web && npm run typecheck && npm test -- --run

run: server
	./bin/chatd

clean:
	rm -rf bin web/dist
