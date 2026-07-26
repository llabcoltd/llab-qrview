'use strict';
const os = require('os'), fs = require('fs'), path = require('path');

// ── Catch fatal startup errors and write to log before crashing ───────────────
const EARLY_LOG = path.join(os.homedir(), 'qrview-server.log');
function fatalExit(msg) {
  const line = `[${new Date().toISOString()}] [FATAL] ${msg}\n`;
  console.error(line);
  try { fs.appendFileSync(EARLY_LOG, line); } catch (_) {}
  console.error(`\nLog saved to: ${EARLY_LOG}`);
  console.error('This window will close in 15 seconds...');
  setTimeout(() => process.exit(1), 15000);
}
process.on('uncaughtException', e => fatalExit(e.stack || e.message));

let express, cors, SerialPort, setupAutoStart, removeAutoStart;
try {
  express = require('express');
  cors = require('cors');
  ({ SerialPort } = require('serialport'));
  ({ setupAutoStart, removeAutoStart } = require('./autostart'));
} catch (e) {
  fatalExit(`Failed to load module: ${e.message}\n${e.stack}`);
  // prevent rest of file from running while the 15s timer counts down
  throw e;
}

const PORT = 3535, BAUD = 115200;
const FLAG = path.join(os.homedir(), '.qrview_installed');
const LOG = path.join(os.homedir(), 'qrview-server.log');
const CONFIG_FILE = path.join(os.homedir(), '.qrview_config.json');
const MOCK = process.env.QRVIEW_MOCK === '1';

const HOME_SCREEN = 0, PAYMENT_SCREEN = 1;
const DEFAULT_BRIGHTNESS = 200;

function log(msg, lvl = 'INFO') {
  const line = `[${new Date().toISOString()}] [${lvl}] ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 5 * 1024 * 1024) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, line + '\n');
  } catch (_) { }
}

// ── Timing config ─────────────────────────────────────────────────────────────
// Resolution order per key: env var > ~/.qrview_config.json > default. The file
// matters more than it looks: autostart.js registers a bare exe path in the
// Windows HKCU Run key with no environment, so on a shop PC the env vars are
// unreachable and the file is the only way to retune without a rebuild.
const CONFIG_DEFAULTS = {
  idleSleepMs: 30000,      // home/success screen -> backlight off
  paymentIdleMs: 180000,   // payment screen -> backlight off
  paymentExpireMs: 600000, // payment screen -> back to home (clears a stale QR)
};
const ENV_KEYS = {
  idleSleepMs: 'QRVIEW_IDLE_SLEEP_MS',
  paymentIdleMs: 'QRVIEW_PAYMENT_IDLE_MS',
  paymentExpireMs: 'QRVIEW_PAYMENT_EXPIRE_MS',
};

function readConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    log(`Config ${CONFIG_FILE} unreadable (${e.message}) — using defaults`, 'WARN');
    return {};
  }
}

// A key is only overridden by a value that parses to a non-negative integer;
// anything else falls through to the default rather than silently becoming NaN
// (NaN would make setTimeout fire immediately — i.e. never sleep off).
function loadConfig() {
  const file = readConfigFile();
  const cfg = {};
  for (const [key, fallback] of Object.entries(CONFIG_DEFAULTS)) {
    const raw = process.env[ENV_KEYS[key]] != null ? process.env[ENV_KEYS[key]] : file[key];
    const n = raw != null ? parseInt(raw, 10) : NaN;
    if (raw != null && !(Number.isFinite(n) && n >= 0)) {
      log(`Config ${key}="${raw}" is not a non-negative integer — using ${fallback}`, 'WARN');
    }
    cfg[key] = Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  const b = parseInt(process.env.QRVIEW_BRIGHTNESS != null ? process.env.QRVIEW_BRIGHTNESS : file.brightness, 10);
  cfg.brightness = Number.isFinite(b) && b >= 1 && b <= 255 ? b : DEFAULT_BRIGHTNESS;
  return cfg;
}

const CONFIG = loadConfig();

// ── Idle sleep ────────────────────────────────────────────────────────────────
// The QR-VIEW protocol has no native sleep command, so "sleep" = backlight off
// (BL(0);). Sleep deliberately does NOT change screens — wake is then a pure
// backlight restore and whatever the operator put on screen survives. (It used
// to JUMP(0) on sleep while wake() only restored brightness, so a woken display
// showed the logo instead of the QR that was there before.)
//
// Two tiers, because the screens have opposite needs: home/logo should dim fast,
// but the payment screen has to outlast a real bank transfer — open app -> auth
// -> scan -> confirm -> OTP is routinely 60-120s, and the old flat 30s killed
// the QR mid-transfer. A separate expiry then sends the payment screen home so a
// customer's QR isn't still sitting on the counter hours later.
//
// Any value of 0 disables that timer.

let sp = null, connectedPort = null, connecting = false, retryTimer = null;
let asleep = false, idleTimer = null, expireTimer = null;
let currentBrightness = CONFIG.brightness;
let currentScreen = HOME_SCREEN;

// ── Mock-safe port list ───────────────────────────────────────────────────────
const listPorts = () => {
  if (MOCK) return Promise.resolve([]);
  return SerialPort.list();
};

function openPort(p) {
  return new Promise((res, rej) => {
    const s = new SerialPort({ path: p, baudRate: BAUD, autoOpen: false });
    s.open(err => {
      if (err) return rej(err);
      s.on('error', e => { log(`Serial error: ${e.message}`, 'ERROR'); sp = null; connectedPort = null; resetSleep(); retry(); });
      s.on('close', () => { log(`Port ${p} closed`); sp = null; connectedPort = null; resetSleep(); retry(); });
      res(s);
    });
  });
}

function retry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; scan(); }, 5000);
}

async function scan() {
  if (connecting || (sp && sp.isOpen)) return;
  connecting = true;
  try {
    const ports = await listPorts();
    log(`Scanning: ${ports.map(p => p.path).join(', ') || 'none'}`);
    for (let i = ports.length - 1; i >= 0; i--) {
      const p = ports[i];
      if (!(p.vendorId || /usb|com\d|ttyusb|ttyacm|usbserial/i.test(p.path))) continue;
      try { sp = await openPort(p.path); connectedPort = p.path; log(`Connected: ${p.path}`); scheduleSleep(); break; }
      catch (e) { log(`Skip ${p.path}: ${e.message}`, 'WARN'); }
    }
    if (!connectedPort) { log('No device — retry in 5s', 'WARN'); retry(); }
  } catch (e) { log(`Scan error: ${e.message}`, 'ERROR'); retry(); }
  finally { connecting = false; }
}

// ── Mock-safe raw write ─────────────────────────────────────────────────────
function writeCmd(cmd) {
  return new Promise((res, rej) => {
    if (MOCK) {
      log(`[MOCK] → ${cmd}`);
      return res();
    }
    if (!sp || !sp.isOpen) return rej(new Error('QR-VIEW not connected'));
    sp.write(`${cmd}\r\n`, 'ascii', err => { if (err) return rej(err); log(`→ ${cmd}`); res(); });
  });
}

// ── Idle sleep / auto-wake ───────────────────────────────────────────────────
// Re-arm the countdowns after every user command. Which timeout applies depends
// on the screen we're currently showing.
function scheduleSleep() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }

  const onPayment = currentScreen === PAYMENT_SCREEN;
  const sleepAfter = onPayment ? CONFIG.paymentIdleMs : CONFIG.idleSleepMs;

  if (sleepAfter > 0) {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      goToSleep(sleepAfter).catch(e => log(`Sleep failed: ${e.message}`, 'ERROR'));
    }, sleepAfter);
  }

  if (onPayment && CONFIG.paymentExpireMs > 0) {
    expireTimer = setTimeout(() => {
      expireTimer = null;
      expirePaymentScreen().catch(e => log(`Payment expiry failed: ${e.message}`, 'ERROR'));
    }, CONFIG.paymentExpireMs);
  }
}

// Cancel any pending timers and forget the display state (used when the port
// drops or a new one is opened — the device comes up on the home screen).
function resetSleep() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
  asleep = false;
  currentScreen = HOME_SCREEN;
}

// Dim the backlight. The screen is left exactly as it was so wake() can restore
// it with nothing more than a brightness command.
async function goToSleep(after) {
  if (asleep) return;
  if (!MOCK && !(sp && sp.isOpen)) return;   // nothing connected — nothing to sleep
  asleep = true;
  log(`Idle ${after}ms on screen ${currentScreen} — sleeping display (BL(0);)`);
  await writeCmd('BL(0);');
}

// Restore the last brightness so the next command is visible.
async function wake() {
  if (!asleep) return;
  asleep = false;
  log(`Waking display (BL(${currentBrightness});)`);
  await writeCmd(`BL(${currentBrightness});`);
}

// A payment QR is customer data — don't leave it on the counter indefinitely.
// Uses writeCmd so an already-sleeping display goes home while staying dark
// rather than lighting itself up unprompted.
async function expirePaymentScreen() {
  if (currentScreen !== PAYMENT_SCREEN) return;
  if (!MOCK && !(sp && sp.isOpen)) return;
  log(`Payment screen up ${CONFIG.paymentExpireMs}ms — returning home (JUMP(${HOME_SCREEN});)`);
  currentScreen = HOME_SCREEN;
  await writeCmd(`JUMP(${HOME_SCREEN});`);
}

// ── User-level send ──────────────────────────────────────────────────────────
// Every API-issued command goes through here: auto-wake first, track the screen
// the command leaves us on, then re-arm the idle countdown. Internal sleep/wake
// writes use writeCmd() to avoid recursion.
async function send(cmd) {
  await wake();
  await writeCmd(cmd);
  const jump = /^JUMP\((\d)\)/.exec(cmd);
  if (jump) currentScreen = parseInt(jump[1], 10);
  scheduleSleep();
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const ok = (r, cmd) => r.json({ success: true, command: cmd });
const fail = (r, e, s = 500) => r.status(s).json({ success: false, error: e.message });

function formatVND(amount) {
  return Number(amount).toLocaleString('vi-VN');
}

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use((req, _, next) => { log(`${req.method} ${req.path}`); next(); });

app.get('/health', async (_, res) => {
  const ports = await listPorts().catch(() => []);
  res.json({
    status: 'ok', mock: MOCK, os: os.platform(), arch: os.arch(),
    serverVersion: '1.2.0', uptime: Math.floor(process.uptime()),
    isConnected: MOCK ? false : !!(sp && sp.isOpen),
    connectedPort: MOCK ? null : connectedPort,
    availablePorts: ports.map(p => ({ path: p.path, vendorId: p.vendorId, manufacturer: p.manufacturer })),
    autoStartRegistered: fs.existsSync(FLAG),
    asleep, screen: currentScreen, brightness: currentBrightness,
    config: CONFIG, configFile: CONFIG_FILE,
    logFile: LOG
  });
});

app.get('/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOG)) return res.json({ success: true, content: '', logFile: LOG });
    const lines = parseInt(req.query.lines, 10) || 200;
    const raw = fs.readFileSync(LOG, 'utf-8');
    const allLines = raw.split('\n');
    const content = allLines.slice(-lines).join('\n');
    res.json({ success: true, content, logFile: LOG, totalLines: allLines.length });
  } catch (e) { fail(res, e); }
});

app.get('/ports', async (_, res) => {
  try { res.json({ success: true, ports: await listPorts() }); } catch (e) { fail(res, e); }
});

app.post('/connect', async (req, res) => {
  if (MOCK) return res.json({ success: true, port: 'mock', mock: true });
  const { port } = req.body; if (!port) return res.status(400).json({ error: 'port required' });
  try { if (sp && sp.isOpen) sp.close(); sp = await openPort(port); connectedPort = port; resetSleep(); scheduleSleep(); res.json({ success: true, port }); }
  catch (e) { fail(res, e); }
});

app.post('/disconnect', (_, res) => {
  if (MOCK) return res.json({ success: true, mock: true });
  if (sp && sp.isOpen) { resetSleep(); sp.close(); res.json({ success: true }); }
  else res.json({ success: false, error: 'No port open' });
});

app.post('/jump/:s', async (req, res) => {
  const s = req.params.s;
  if (!['0', '1', '2'].includes(s)) return res.status(400).json({ error: 'screen must be 0/1/2' });
  try { await send(`JUMP(${s});`); ok(res, `JUMP(${s});`); } catch (e) { fail(res, e); }
});

app.post('/qbar', async (req, res) => {
  const { url } = req.body; if (!url) return res.status(400).json({ error: 'url required' });
  try { await send(`QBAR(0,${url});`); ok(res, `QBAR(0,${url});`); } catch (e) { fail(res, e); }
});

app.post('/settxt/bank', async (req, res) => {
  const { name } = req.body; if (!name) return res.status(400).json({ error: 'name required' });
  try { await send(`SET_TXT(0,${name});`); ok(res, `SET_TXT(0,${name});`); } catch (e) { fail(res, e); }
});

app.post('/settxt/account', async (req, res) => {
  const { number } = req.body; if (!number) return res.status(400).json({ error: 'number required' });
  try { await send(`SET_TXT(1,${number});`); ok(res, `SET_TXT(1,${number});`); } catch (e) { fail(res, e); }
});

app.post('/settxt/amount', async (req, res) => {
  const { amount } = req.body; if (!amount) return res.status(400).json({ error: 'amount required' });
  try { await send(`SET_TXT(2,${amount});`); ok(res, `SET_TXT(2,${amount});`); } catch (e) { fail(res, e); }
});

app.post('/brightness/:lvl', async (req, res) => {
  const lvl = parseInt(req.params.lvl, 10);
  if (isNaN(lvl) || lvl < 0 || lvl > 255) return res.status(400).json({ error: 'level must be 0-255' });
  try { await send(`BL(${lvl});`); if (lvl > 0) currentBrightness = lvl; ok(res, `BL(${lvl});`); } catch (e) { fail(res, e); }
});

app.post('/clear', async (_, res) => { try { await send('CLRF'); ok(res, 'CLRF'); } catch (e) { fail(res, e); } });
app.post('/reset', async (_, res) => { try { await send('JUMP(0);'); ok(res, 'JUMP(0);'); } catch (e) { fail(res, e); } });
app.post('/payment-success', async (_, res) => { try { await send('JUMP(2);'); ok(res, 'JUMP(2);'); } catch (e) { fail(res, e); } });

app.post('/payment', async (req, res) => {
  const { qrCode, bankCode, maskedAccountNo, amount } = req.body;

  if (!qrCode || !bankCode || !maskedAccountNo || amount == null)
    return res.status(400).json({ error: 'qrCode, bankCode, maskedAccountNo, amount are required' });

  try {
    const amountDisplay = formatVND(amount);
    const seq = [
      `JUMP(1);`,
      `QBAR(0,${qrCode});`,
      `SET_TXT(0,${bankCode});`,
      `SET_TXT(1,STK: ${maskedAccountNo});`,
      `SET_TXT(2,${amountDisplay});`,
      `CLRF`,
    ];
    for (const cmd of seq) { await send(cmd); await wait(100); }
    res.json({ success: true, sequence: seq });
  } catch (e) { fail(res, e); }
});

app.post('/uninstall', (_, res) => {
  try { removeAutoStart(); if (fs.existsSync(FLAG)) fs.unlinkSync(FLAG); res.json({ success: true }); }
  catch (e) { fail(res, e); }
});

async function main() {
  log(`QR-VIEW Server v1.2.0 | ${os.platform()} ${os.arch()} | Node: ${process.version}`);
  log(`Timing: idle=${CONFIG.idleSleepMs}ms payment=${CONFIG.paymentIdleMs}ms expire=${CONFIG.paymentExpireMs}ms brightness=${CONFIG.brightness} (${fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : 'defaults'})`);
  if (MOCK) {
    log('⚠️  MOCK MODE — serial port fully bypassed, all commands succeed silently');
    scheduleSleep();
  } else {
    if (!fs.existsSync(FLAG)) {
      log('First run — registering autostart...');
      const ok = setupAutoStart(process.execPath);
      if (ok) {
        fs.writeFileSync(FLAG, JSON.stringify({
          installedAt: new Date().toISOString(),
          os: os.platform(), arch: os.arch(), path: process.execPath
        }));
        log('Autostart registered. Will start on every reboot from now on.');
      } else {
        log('Autostart registration FAILED — server runs now but will NOT auto-start on reboot. Check log for details.', 'WARN');
      }
    } else {
      const m = JSON.parse(fs.readFileSync(FLAG, 'utf-8'));
      log(`Autostart already registered (installed: ${m.installedAt})`);
    }
    await scan();
  }
  app.listen(PORT, '127.0.0.1', () => { log(`✓ Ready on http://localhost:${PORT}`); });
}
main().catch(e => { log(`Fatal: ${e.message}`, 'ERROR'); process.exit(1); });
