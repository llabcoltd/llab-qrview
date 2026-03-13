# QR-VIEW Server

Background agent that controls the QR-VIEW USB display via SerialPort, exposed as a local HTTP API on `http://localhost:3535`.

---

## Building Executables

### Prerequisites

Install [Node.js 18+](https://nodejs.org) and then install dependencies:

```bash
npm install
```

---

### Windows (x64)

Run on a **Windows machine** or cross-compile from any OS:

```bash
npx pkg . --target node18-win-x64 --output qrview-server-win.exe
```

Output: `qrview-server-win.exe`

---

### macOS (Apple Silicon — M1/M2/M3)

Run on a **macOS arm64 machine**:

```bash
npx pkg . --target node18-mac-arm64 --output qrview-server-macos-arm64
```

Output: `qrview-server-macos-arm64`

After building on macOS, make it executable:

```bash
chmod +x qrview-server-macos-arm64
```

---

### macOS (Intel)

```bash
npx pkg . --target node18-mac-x64 --output qrview-server-macos-x64
```

---

## Installation

### Windows

1. Place `qrview-server-win.exe` and `setup.bat` in the same folder
2. Double-click `setup.bat`

The agent installs to `%APPDATA%\QRViewAgent\` and auto-starts on every login via registry.

### macOS

Double-click or run the binary directly:

```bash
./qrview-server-macos-arm64
```

On first run it registers a LaunchAgent so it auto-starts on every login.

> If macOS blocks the binary: **System Settings → Privacy & Security → Allow Anyway**

---

## Updating from an older version

### Windows

1. Place the new `qrview-server-win.exe` and `update.bat` in the same folder
2. Double-click `update.bat`

### macOS

```bash
# Stop the running agent
launchctl unload ~/Library/LaunchAgents/com.qrview.server.plist

# Replace the binary
cp qrview-server-macos-arm64 /usr/local/bin/qrview-server-macos-arm64
chmod +x /usr/local/bin/qrview-server-macos-arm64

# Delete install flag so autostart re-registers
rm -f ~/.qrview_installed

# Run the new binary (re-registers LaunchAgent automatically)
./qrview-server-macos-arm64
```

---

## API Reference

Base URL: `http://localhost:3535`

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/health` | — | Server status, connected port, available ports |
| GET | `/ports` | — | List all serial ports |
| POST | `/connect` | `{ "port": "COM4" }` | Manually connect to a port |
| POST | `/disconnect` | — | Disconnect current port |
| POST | `/jump/0` | — | Switch to screen 0 (home) |
| POST | `/jump/1` | — | Switch to screen 1 (payment QR) |
| POST | `/jump/2` | — | Switch to screen 2 (success) |
| POST | `/qbar` | `{ "url": "https://..." }` | Display QR code |
| POST | `/settxt/bank` | `{ "name": "AGRIBANK" }` | Set bank name |
| POST | `/settxt/account` | `{ "number": "0123456789" }` | Set account number |
| POST | `/settxt/amount` | `{ "amount": "230.000" }` | Set amount |
| POST | `/brightness/:lvl` | — | Set brightness 0–255 |
| POST | `/clear` | — | Send CLRF flush command |
| POST | `/reset` | — | Go to screen 0 |
| POST | `/payment` | `{ bank, account, amount, qrUrl }` | Full payment sequence |
| POST | `/payment-success` | — | Go to screen 2 (success) |
| POST | `/uninstall` | — | Remove autostart registration |

### `/payment` — full sequence in one call

```bash
curl -X POST http://localhost:3535/payment \
  -H "Content-Type: application/json" \
  -d '{
    "bank": "AGRIBANK",
    "account": "0123456789",
    "amount": "230.000",
    "qrUrl": "https://oxu.vn/pay/abc123"
  }'
```

This sends: `JUMP(1);` → `QBAR(0,url);` → `SET_TXT(0,bank);` → `SET_TXT(1,account);` → `SET_TXT(2,amount);` → `CLRF`

---

## Debugging

**Check server status and which COM port is connected:**
```bash
curl http://localhost:3535/health
```

**Log file locations:**
- Windows: `%USERPROFILE%\qrview-server.log`
- macOS: `~/qrview-server.log`

**Wrong COM port connected?** Delete the install flag and restart:
- Windows: `del %USERPROFILE%\.qrview_installed`
- macOS: `rm ~/.qrview_installed`

**Mock mode** (test without hardware):
```bash
QRVIEW_MOCK=1 ./qrview-server-macos-arm64
```
