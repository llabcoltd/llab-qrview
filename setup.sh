#!/usr/bin/env bash
# QR-VIEW Agent Setup — macOS / Linux
# Run once: bash setup.sh
# After this the server auto-starts with your OS — never run again.
set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}==>${NC} $*"; }
success() { echo -e "${GREEN}✓${NC}  $*"; }
warn()    { echo -e "${YELLOW}!${NC}   $*"; }
die()     { echo -e "${RED}ERROR:${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.qrview"
PORT=3535
OS="$(uname -s)"; ARCH="$(uname -m)"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     QR-VIEW Agent Setup — macOS/Linux    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Already running?
if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
  success "QR-VIEW Agent is already running on http://localhost:${PORT}"
  echo ""; exit 0
fi

# Node.js check
command -v node &>/dev/null || die "Node.js not found. Install from https://nodejs.org then re-run."
success "Node.js $(node -e 'process.stdout.write(process.version)') found."

# Detect pkg target for this exact machine
if   [[ "$OS" == "Darwin" && "$ARCH" == "arm64" ]]; then PKG_TARGET="node18-mac-arm64"
elif [[ "$OS" == "Darwin" ]];                        then PKG_TARGET="node18-mac-x64"
elif [[ "$ARCH" == "aarch64" ]];                     then PKG_TARGET="node18-linux-arm64"
else                                                      PKG_TARGET="node18-linux-x64"
fi
info "Platform: $OS / $ARCH → target: $PKG_TARGET"

cd "$SCRIPT_DIR"
info "Installing dependencies..."; npm install --silent; success "Dependencies ready."

info "Compiling binary (1-2 min first time)..."
mkdir -p "$INSTALL_DIR"
npx pkg . --target "$PKG_TARGET" --output "$INSTALL_DIR/qrview-server" 2>&1 \
  | grep -Ev "^$|DeprecationWarning|punycode" || true
chmod +x "$INSTALL_DIR/qrview-server"
success "Binary → $INSTALL_DIR/qrview-server"

info "Copying serialport native bindings..."
PREBUILDS="$SCRIPT_DIR/node_modules/@serialport/bindings-cpp/prebuilds"
[[ -d "$PREBUILDS" ]] && cp -r "$PREBUILDS" "$INSTALL_DIR/prebuilds" && success "Bindings copied." \
  || warn "prebuilds not found — serial port may not work."

info "Starting agent..."
"$INSTALL_DIR/qrview-server" >> "$HOME/qrview-server.log" 2>&1 &

STARTED=false
for i in $(seq 1 10); do
  sleep 1
  curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1 && STARTED=true && break
done

echo ""
if $STARTED; then
  echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  ✓  QR-VIEW Agent is running!            ║${NC}"
  echo -e "${GREEN}║     http://localhost:${PORT}                ║${NC}"
  echo -e "${GREEN}║     Auto-starts on every reboot. Done.   ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
else
  warn "Started but health check timed out. Check: $HOME/qrview-server.log"
fi
echo ""
