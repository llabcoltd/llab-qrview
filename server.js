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
const MOCK = process.env.QRVIEW_MOCK === '1';

function log(msg, lvl = 'INFO') {
  const line = `[${new Date().toISOString()}] [${lvl}] ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 5 * 1024 * 1024) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, line + '\n');
  } catch (_) { }
}

let sp = null, connectedPort = null, connecting = false, retryTimer = null;

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
      s.on('error', e => { log(`Serial error: ${e.message}`, 'ERROR'); sp = null; connectedPort = null; retry(); });
      s.on('close', () => { log(`Port ${p} closed`); sp = null; connectedPort = null; retry(); });
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
    for (const p of ports) {
      if (!(p.vendorId || /usb|com\d|ttyusb|ttyacm|usbserial/i.test(p.path))) continue;
      try { sp = await openPort(p.path); connectedPort = p.path; log(`Connected: ${p.path}`); break; }
      catch (e) { log(`Skip ${p.path}: ${e.message}`, 'WARN'); }
    }
    if (!connectedPort) { log('No device — retry in 5s', 'WARN'); retry(); }
  } catch (e) { log(`Scan error: ${e.message}`, 'ERROR'); retry(); }
  finally { connecting = false; }
}

// ── Mock-safe send ────────────────────────────────────────────────────────────
function send(cmd) {
  return new Promise((res, rej) => {
    if (MOCK) {
      log(`[MOCK] → ${cmd}`);
      return res();
    }
    if (!sp || !sp.isOpen) return rej(new Error('QR-VIEW not connected'));
    sp.write(`${cmd}\r\n`, 'ascii', err => { if (err) return rej(err); log(`→ ${cmd}`); res(); });
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const ok = (r, cmd) => r.json({ success: true, command: cmd });
const fail = (r, e, s = 500) => r.status(s).json({ success: false, error: e.message });

function formatVND(amount) {
  return Number(amount).toLocaleString('en-US') + ' VND';
}

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use((req, _, next) => { log(`${req.method} ${req.path}`); next(); });

app.get('/health', async (_, res) => {
  const ports = await listPorts().catch(() => []);
  res.json({
    status: 'ok', mock: MOCK, os: os.platform(), arch: os.arch(),
    serverVersion: '1.0.0', uptime: Math.floor(process.uptime()),
    isConnected: MOCK ? false : !!(sp && sp.isOpen),
    connectedPort: MOCK ? null : connectedPort,
    availablePorts: ports.map(p => ({ path: p.path, vendorId: p.vendorId, manufacturer: p.manufacturer })),
    autoStartRegistered: fs.existsSync(FLAG),
    logFile: LOG
  });
});

app.get('/ports', async (_, res) => {
  try { res.json({ success: true, ports: await listPorts() }); } catch (e) { fail(res, e); }
});

app.post('/connect', async (req, res) => {
  if (MOCK) return res.json({ success: true, port: 'mock', mock: true });
  const { port } = req.body; if (!port) return res.status(400).json({ error: 'port required' });
  try { if (sp && sp.isOpen) sp.close(); sp = await openPort(port); connectedPort = port; res.json({ success: true, port }); }
  catch (e) { fail(res, e); }
});

app.post('/disconnect', (_, res) => {
  if (MOCK) return res.json({ success: true, mock: true });
  if (sp && sp.isOpen) { sp.close(); res.json({ success: true }); }
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
  try { await send(`BL(${lvl});`); ok(res, `BL(${lvl});`); } catch (e) { fail(res, e); }
});

app.post('/clear', async (_, res) => { try { await send('CLRF'); ok(res, 'CLRF'); } catch (e) { fail(res, e); } });
app.post('/reset', async (_, res) => { try { await send('JUMP(0);'); ok(res, 'JUMP(0);'); } catch (e) { fail(res, e); } });
app.post('/payment-success', async (_, res) => { try { await send('JUMP(2);'); ok(res, 'JUMP(2);'); } catch (e) { fail(res, e); } });

app.post('/payment', async (req, res) => {
  // qrCode        — raw EMVCo QR string from VietQR generate API
  // bankCode      — VietQR bank ID, e.g. "MBBANK", "VCB"
  // maskedAccountNo — masked account number, e.g. "****6789"
  // amount        — integer in VND, e.g. 150000
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
  log(`QR-VIEW Server v1.0.0 | ${os.platform()} ${os.arch()} | Node: ${process.version}`);
  if (MOCK) {
    log('⚠️  MOCK MODE — serial port fully bypassed, all commands succeed silently');
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
