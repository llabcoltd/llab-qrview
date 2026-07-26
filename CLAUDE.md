# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-process Node.js background agent that drives a **QR-VIEW USB serial display**
(2.4" screen, 115200 baud) and exposes it as a local HTTP API on
`http://localhost:3535`. A POS/backend calls the HTTP API; this agent translates calls
into the device's serial command protocol. It installs itself to auto-start on login
and is shipped as a standalone packaged binary (no Node install on the target machine).

The device protocol is the spec — see `docs/Hướng dẫn lập trình QR VIEW.pdf` (Vietnamese
programming guide) and the vendor's `testqr_saveCOM_V2.html` Web Serial reference. They
are the source of truth for the command set and behaviour.

## Commands

```bash
npm start                       # run the server (node server.js)
QRVIEW_MOCK=1 npm start         # run with serial fully bypassed (no hardware needed)
QRVIEW_IDLE_SLEEP_MS=10000 npm start   # override the 30s idle-sleep timeout (0 disables)

npm run build:win               # → qrview-server-win.exe   (pkg, node18-win-x64)
npm run build:mac               # → qrview-server-macos-arm64
npm run build:mac-intel         # → qrview-server-macos-x64

node test.js                    # interactive manual test (NOT automated CI tests)
```

There is no lint step and no automated test suite. `test.js` is an **interactive**
walkthrough that hits the running server's endpoints and prompts for visual
confirmation on the physical device — start the server first (real device, or
`QRVIEW_MOCK=1`), then run it. To smoke-test a code change without hardware, run the
server in mock mode and `curl` the endpoints.

## Architecture

Two files hold all the logic:

- **`server.js`** — the whole runtime: serial connection management, the device command
  layer, the Express HTTP API, and idle-sleep. Logs to `~/qrview-server.log` (rotates at
  5 MB).
- **`autostart.js`** — cross-platform auto-start registration only (Windows HKCU Run key,
  macOS LaunchAgent plist, Linux systemd user unit). No admin rights required on any OS.

### Serial connection lifecycle

`scan()` lists ports and auto-connects to the first plausible USB serial device
(scanned **newest-first** — most recently attached wins, see git history). On
error/close it nulls the handle and `retry()`s every 5 s. The connected port handle is
the module-global `sp`. `QRVIEW_MOCK=1` bypasses the serial layer entirely — every
command "succeeds" and is logged, so all behaviour is testable without hardware.

### Device command layer — three levels, do not collapse them

1. `writeCmd(cmd)` — raw write of one command to the port (or mock log).
2. `wake()` / `goToSleep()` / `scheduleSleep()` / `resetSleep()` / `expirePaymentScreen()`
   — idle-sleep machinery, built **only** from documented commands because the protocol
   has no power command. Sleep = `BL(0);` **and nothing else**; wake =
   `BL(<lastBrightness>);`. These call `writeCmd` directly to avoid recursion.
3. `send(cmd)` — the user-level entry point every HTTP handler uses: auto-wakes the
   display, writes, records the screen if the command was a `JUMP`, then re-arms the
   idle countdown.

**Invariant:** HTTP handlers call `send()`; the sleep/wake internals call `writeCmd()`.
Routing a handler through `writeCmd` (or sleep logic through `send`) breaks auto-wake or
causes recursion.

**Sleep must not change screens.** It used to also `JUMP(0);` while `wake()` only
restored brightness — so any single command after a sleep lit up the *home* screen
instead of the QR that was there, and only `/payment` recovered because its sequence
re-issues `JUMP(1)`. Keeping sleep to backlight-only is what makes wake a pure restore.
`expirePaymentScreen()` is the deliberate exception: a much longer timer that sends the
payment screen home so a customer's QR doesn't sit on the counter — it uses `writeCmd`
so a sleeping display stays dark.

**Screen tracking:** `send()` parses `JUMP(n)` to maintain `currentScreen`, which
selects the timeout (`paymentIdleMs` on screen 1, `idleSleepMs` otherwise). A new route
that changes screens by any means other than a `JUMP(n);` string passed to `send()` must
update `currentScreen` itself, or it will get the wrong timeout.

### Timing config

`CONFIG` is resolved once at boot: **env var → `~/.qrview_config.json` → `CONFIG_DEFAULTS`**.
The file exists because `autostart.js` registers a bare exe path in the Windows HKCU Run
key with **no environment** — on a shop PC env vars are unreachable, so without the file
every timing change would need a rebuild and a reinstall on every machine. Non-integer or
negative values are rejected with a `WARN` and fall back to the default (a `NaN` timeout
fires immediately, which would silently mean "never sleep off"). Values are surfaced in
`/health` under `config`.

### Device protocol (from the PDF)

Three screens: `0` home/logo (default), `1` QR/payment, `2` success. Commands:
`JUMP(n);` (switch screen), `QBAR(0,<data>);` (show QR), `SET_TXT(0|1|2,<text>);`
(bank name / account / amount), `BL(0..255);` (backlight). Every command is terminated
with `\r\n` — `writeCmd()` appends this automatically. The vendor demo chains several
commands in a single write (`JUMP(1);QBAR(0,oxu.vn);`); this server sends them as
separate writes with ~100 ms gaps. Both work.

`POST /payment` is the composite endpoint that runs the full sequence
(`JUMP(1)` → `QBAR` → three `SET_TXT` → `CLRF`) with ~100 ms gaps between writes.

**Do not remove the literal `CLRF` token** sent by `/clear` and at the end of the
`/payment` sequence. The PDF lists "CLRF" as the *end command* and the V2 HTML calls the
terminator `\r\n` (CRLF) — strongly implying "CLRF" is just CRLF and the literal token is
redundant. **But it is not:** git history shows the payment sequence was empirically
broken on real hardware when the literal `CLRF` was removed and had to be restored
(`92ea3d6`). Trust the hardware over the doc here; leave it unless you can retest on a
physical device.

## Conventions that matter

- **Money** arrives as a VND **integer** and is formatted for display with
  `toLocaleString('vi-VN')` (e.g. `150000` → `150.000`). The currency symbol is
  deliberately omitted — the device renders it wrong (see git history). Don't re-add `₫`.
- The `/payment` QR field (`qrCode`) is a **raw EMVCo QR string**, passed verbatim to
  `QBAR` — not a URL the server builds. (The README's VietQR-URL example is older;
  `server.js` is authoritative.)
- First successful run writes `~/.qrview_installed` and registers auto-start. Delete that
  flag (or `POST /uninstall`) to force re-registration / pick a different COM port.
- `pkg` bundles the native serialport prebuilds via the `pkg.assets` glob in
  `package.json` — keep that entry when changing the serialport dependency, or the packaged
  binary loses its native bindings. Always build via `npm run build:*` (runs `npm install`
  first) rather than `npx pkg` directly.
