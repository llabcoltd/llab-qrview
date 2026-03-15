# QR-VIEW Server

Background agent that controls the QR-VIEW USB display via SerialPort, exposed as a local HTTP API on `http://localhost:3535`.

---

## Building Executables

### Prerequisites

Install [Node.js 18+](https://nodejs.org). That's it — the build scripts handle `npm install` automatically.

> **Important:** always use `npm run build:*` instead of running `npx pkg` directly.
> The build scripts run `npm install` first to ensure all platform-specific native
> bindings (including Windows) are downloaded before packaging.

---

### Windows (x64)

```bash
npm run build:win
```

Output: `qrview-server-win.exe`

---

### macOS (Apple Silicon — M1/M2/M3)

```bash
npm run build:mac
```

Output: `qrview-server-macos-arm64`

After building, make it executable:

```bash
chmod +x qrview-server-macos-arm64
```

---

### macOS (Intel)

```bash
npm run build:mac-intel
```

Output: `qrview-server-macos-x64`

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

### `/payment` — full VietQR sequence in one call

```bash
curl -X POST http://localhost:3535/payment \
  -H "Content-Type: application/json" \
  -d '{
    "bankCode": "MBBANK",
    "accountNo": "0123456789",
    "amount": 150000,
    "addInfo": "ORDER_12345",
    "accountName": "NGUYEN VAN A",
    "template": "compact"
  }'
```

| Field | Required | Description |
|---|---|---|
| `bankCode` | Yes | VietQR bank ID — e.g. `MBBANK`, `VCB`, `TCB`, `AGRIBANK` |
| `accountNo` | Yes | Receiver account number |
| `amount` | Yes | Amount in VND as integer — e.g. `150000` |
| `addInfo` | Yes | Payment reference embedded in QR — e.g. `ORDER_12345`. Your backend matches incoming transfers on this. |
| `accountName` | No | Recipient name shown inside the QR image |
| `template` | No | QR image style: `compact` (default), `compact2`, `qr_only`, `print` |

The server builds this VietQR URL automatically:
```
https://img.vietqr.io/image/MBBANK-0123456789-compact.png?amount=150000&addInfo=ORDER_12345&accountName=NGUYEN+VAN+A
```

Then sends: `JUMP(1);` → `QBAR(0,<vietqr_url>);` → `SET_TXT(0,MBBANK);` → `SET_TXT(1,STK: 0123456789);` → `SET_TXT(2,150.000 ₫);` → `CLRF`

The `addInfo` reference is invisible to the customer but gets embedded in their transfer note when they scan and pay — use it to match confirmed payments in your backend.

**Manual override** — pass `qrUrl` directly if you built the URL yourself:
```bash
curl -X POST http://localhost:3535/payment \
  -H "Content-Type: application/json" \
  -d '{
    "qrUrl": "https://img.vietqr.io/image/...",
    "bank": "MBBANK",
    "account": "0123456789",
    "amountDisplay": "150.000 ₫"
  }'
```

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
