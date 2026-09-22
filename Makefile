GO ?= go
NODE_BIN ?= /usr/local/lib/nodejs/current/bin
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
# The Android build needs a JDK 17+ and the SDK; override these if yours live elsewhere.
ANDROID_JAVA_HOME ?= $(HOME)/.local/toolchain/jdk-21.0.12.1+1/Contents/Home
ANDROID_SDK ?= /usr/local/share/android-commandlinetools
GRADLE ?= $(HOME)/.local/toolchain/gradle-9.7.1/bin/gradle
export PATH := $(NODE_BIN):$(PATH)

.PHONY: build web server test test-go test-web test-desktop test-android desktop publish-desktop android publish-android licenses run clean

# A build runs the typechecker (inside the web build) but not the test
# suites unless asked with `make build TEST=1`. The suites are timing
# sensitive under load and slow machines trip them; `make test` is still the
# way to run the whole thing on purpose.
ifeq ($(TEST),1)
BUILD_DEPS := test-web test-go web server
else
BUILD_DEPS := web server
endif
build: $(BUILD_DEPS)

# `web/dist` is what chatd serves, so this target *is* the deploy. DEPLOY=1 is
# how the build says it knows that; see web/scripts/deploy-guard.mjs.
web:
	cd web && npm ci --no-audit --no-fund && DEPLOY=1 npm run build

# `bin/chatd` is the file launchd starts, so writing it is the deploy — a
# reboot after any `go build -o bin/chatd` starts whatever was left there. The
# build goes to a scratch name and is moved into place in one step, keeping the
# one it replaces as bin/chatd.prev to roll back to.
server:
	$(GO) build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/chatd.next ./cmd/chatd
	@if [ -f bin/chatd ]; then cp -f bin/chatd bin/chatd.prev; fi
	@mv -f bin/chatd.next bin/chatd
	@echo "  bin/chatd is now $(VERSION); the one it replaced is bin/chatd.prev"

test: test-go test-web test-desktop

# -race makes the api package take about three minutes on an idle machine and
# rather more on a busy one; Go's default is ten per package, which this has
# hit while other things were building.
test-go:
	$(GO) vet ./... && $(GO) test -race -timeout 20m ./...

test-web:
	cd web && npm run typecheck && npm test -- --run

test-desktop:
	cd desktop && npm run typecheck && npm test

# the Android app's own tests: the crypto against the web client's own output,
# the markdown parser, invite links and mentions
test-android:
	cd android && JAVA_HOME=$(ANDROID_JAVA_HOME) ANDROID_HOME=$(ANDROID_SDK) $(GRADLE) --no-daemon :app:testDebugUnitTest

# the desktop app's installers for every platform, into desktop/dist (runs on macOS)
desktop: test-desktop
	cd desktop && npm ci --no-audit --no-fund && npm run build && npx electron-builder --mac --win --linux --publish never

# copies desktop/dist into DESKTOP_DIR, where chatd serves downloads and updates
publish-desktop:
	python3 tools/publish_desktop.py desktop/dist

# the signed Android app (android/keystore.properties and android/release.jks)
android: test-android
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
