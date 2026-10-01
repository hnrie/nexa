#!/usr/bin/env bash
#
# Sets up Cloudflare WARP as a local SOCKS5 proxy for chatd: the requests a
# person can point the server at (link previews, the media proxy, the YouTube
# player) go out through it, so the sites they name see Cloudflare's address
# and never this machine's. The rest of the machine's traffic goes out as
# usual: WARP runs in proxy mode, not as a tunnel for everything.
#
# Installs the WARP client first when it is missing (apt or dnf on Linux,
# Homebrew or Cloudflare's package on macOS), registers it, switches it to
# proxy mode on WARP_PROXY_PORT (40000 unless chatd.env says otherwise) and
# connects. chatd does the last three itself at start; this is for a machine
# that has never had WARP, and for `make run`. Safe to run again.
#
#   bash deploy/warp-proxy.sh            install if needed, then set up
#   bash deploy/warp-proxy.sh --check    say what is there, change nothing
#
# Turning WARP into a proxy also ends any whole-machine WARP tunnel this
# machine had, which is the point on a server. On a laptop that used WARP as
# its VPN, switch back with `warp-cli mode warp` when done testing.
set -euo pipefail

CHECK=0
for a in "$@"; do case "$a" in --check) CHECK=1;; *) echo "unknown option $a" >&2; exit 2;; esac; done

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -t 1 ]; then G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else G=; Y=; R=; N=; fi
ok()   { echo "${G}ok${N}    $*"; }
todo() { echo "${Y}todo${N}  $*"; }
die()  { echo "${R}error${N} $*" >&2; exit 1; }

env_get() { local k="$1" d="$2"; local v; v="$(grep -E "^${k}=" "$ROOT/chatd.env" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"; echo "${v:-$d}"; }
MODE="$(env_get EGRESS_PROXY warp)"
PORT="$(env_get WARP_PROXY_PORT 40000)"
if [ "$MODE" != warp ]; then
  ok "EGRESS_PROXY=$MODE in chatd.env, so WARP is not needed"
  exit 0
fi

find_cli() {
  command -v warp-cli 2>/dev/null && return
  for p in /usr/bin/warp-cli /usr/local/bin/warp-cli /opt/homebrew/bin/warp-cli "/Applications/Cloudflare WARP.app/Contents/Resources/warp-cli"; do
    [ -x "$p" ] && { echo "$p"; return; }
  done
}

install_linux() {
  if command -v apt-get >/dev/null; then
    local codename
    codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
    [ -n "$codename" ] || codename="$(lsb_release -cs 2>/dev/null || true)"
    [ -n "$codename" ] || die "could not tell which Debian or Ubuntu release this is"
    curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $codename main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list >/dev/null
    sudo apt-get update -qq
    sudo apt-get install -y cloudflare-warp
  elif command -v dnf >/dev/null || command -v yum >/dev/null; then
    curl -fsSL https://pkg.cloudflareclient.com/cloudflare-warp-ascii.repo | sudo tee /etc/yum.repos.d/cloudflare-warp.repo >/dev/null
    if command -v dnf >/dev/null; then sudo dnf install -y cloudflare-warp; else sudo yum install -y cloudflare-warp; fi
  else
    die "no apt or dnf here; install the WARP client by hand: https://pkg.cloudflareclient.com/"
  fi
  sudo systemctl enable --now warp-svc
}

install_mac() {
  if command -v brew >/dev/null; then
    brew install --cask cloudflare-warp
  else
    local pkg
    pkg="$(mktemp -d)/Cloudflare_WARP.pkg"
    curl -fL --progress-bar -o "$pkg" https://downloads.cloudflareclient.com/v1/download/macos/ga
    sudo installer -pkg "$pkg" -target /
    rm -f "$pkg"
  fi
}

CLI="$(find_cli || true)"
if [ -z "$CLI" ]; then
  if [ "$CHECK" = 1 ]; then todo "WARP client not installed (this would install it)"; exit 0; fi
  echo "Installing the Cloudflare WARP client (asks for your password)..."
  case "$(uname -s)" in
    Linux) install_linux ;;
    Darwin) install_mac ;;
    *) die "install the WARP client by hand on $(uname -s): https://developers.cloudflare.com/warp-client/" ;;
  esac
  # the daemon takes a moment to come up after installing
  for _ in $(seq 1 20); do CLI="$(find_cli || true)"; [ -n "$CLI" ] && "$CLI" --accept-tos status >/dev/null 2>&1 && break; sleep 1; done
  [ -n "$CLI" ] || die "the WARP client installed, but warp-cli is nowhere to be found"
fi
ok "warp-cli at $CLI"

warp() { "$CLI" --accept-tos "$@"; }

if [ "$CHECK" = 1 ]; then
  warp status | sed 's/^/      /'
  warp settings | grep -E "Mode:" | grep -v Protocol | sed 's/^/      /'
  exit 0
fi

if warp status 2>&1 | grep -qi "registration missing"; then
  warp registration new >/dev/null
  ok "registered this machine with WARP"
fi
warp proxy port "$PORT" >/dev/null
warp mode proxy >/dev/null
warp connect >/dev/null
for _ in $(seq 1 30); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    ok "WARP proxy on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 1
done
die "WARP is in proxy mode but 127.0.0.1:$PORT is not answering; see: $CLI status"
