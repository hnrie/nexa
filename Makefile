GO ?= go
NODE_BIN ?= /usr/local/lib/nodejs/current/bin
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
# The Android build needs a JDK 17+ and the SDK; override these if yours live elsewhere.
ANDROID_JAVA_HOME ?= $(HOME)/.local/toolchain/jdk-21.0.12.1+1/Contents/Home
ANDROID_SDK ?= /usr/local/share/android-commandlinetools
GRADLE ?= $(HOME)/.local/toolchain/gradle-9.7.1/bin/gradle
export PATH := $(NODE_BIN):$(PATH)

.PHONY: build web server test test-go test-web test-desktop test-android desktop publish-desktop android publish-android licenses run clean

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

# the Android app's own tests: the crypto against the web client's own output,
# the markdown parser, invite links and mentions
test-android:
	cd android && JAVA_HOME=$(ANDROID_JAVA_HOME) ANDROID_HOME=$(ANDROID_SDK) $(GRADLE) --no-daemon :app:testDebugUnitTest

# the desktop app's installers for every platform, into desktop/dist (runs on macOS)
desktop:
	cd desktop && npm ci --no-audit --no-fund && npm run build && npx electron-builder --mac --win --linux --publish never

# copies desktop/dist into DESKTOP_DIR, where chatd serves downloads and updates
publish-desktop:
	python3 tools/publish_desktop.py desktop/dist

# the signed Android app (android/keystore.properties and android/release.jks)
android:
	cd android && JAVA_HOME=$(ANDROID_JAVA_HOME) ANDROID_HOME=$(ANDROID_SDK) $(GRADLE) --no-daemon :app:assembleRelease

# copies the APK into ANDROID_DIR, where chatd serves it to the download page
publish-android:
	ANDROID_HOME=$(ANDROID_SDK) python3 tools/publish_android.py

# what Settings → Licenses shows, read back out of the lockfiles. Run it after any
# dependency changes, in any of the four builds.
licenses:
	JAVA_HOME=$(ANDROID_JAVA_HOME) ANDROID_HOME=$(ANDROID_SDK) PATH="$(dir $(GRADLE)):$$PATH" python3 tools/licenses.py

run: server
	./bin/chatd

clean:
	rm -rf bin web/dist android/app/build android/build
