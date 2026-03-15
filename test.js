'use strict';
/**
 * QR-VIEW Manual Test Script
 * Usage: node test.js
 */

const http = require('http');

const BASE = 'http://localhost:3535';

// Sample raw EMVCo QR string (this is a test value — replace with one from your backend)
const SAMPLE_QR_CODE = '00020101021238560010A000000727012600069704220113012345678901520400005303704540615000055802VN62180814ORDER_TEST0016304ABCD';

const TEST_DATA = {
  // /payment endpoint — uses raw EMVCo QR string from VietQR generate API
  qrCode: SAMPLE_QR_CODE,
  bankCode: 'MBBANK',
  maskedAccountNo: '****6789',
  amount: 150000,           // VND integer — server auto-formats for display

  // Individual command tests
  sampleQrCode: SAMPLE_QR_CODE,
  bankName: 'MBBANK',
  accountDisplay: '****6789',
};

// ── HTTP helper ───────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const get  = path       => request('GET',  path);
const post = (path, body) => request('POST', path, body);
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Display helpers ───────────────────────────────────────────────────────────

const GREEN  = s => `\x1b[32m${s}\x1b[0m`;
const RED    = s => `\x1b[31m${s}\x1b[0m`;
const YELLOW = s => `\x1b[33m${s}\x1b[0m`;
const BOLD   = s => `\x1b[1m${s}\x1b[0m`;
const DIM    = s => `\x1b[2m${s}\x1b[0m`;

function pass(label, detail = '') {
  console.log(`  ${GREEN('✓')} ${label} ${detail ? DIM(detail) : ''}`);
}
function fail(label, detail = '') {
  console.log(`  ${RED('✗')} ${label} ${detail ? RED(detail) : ''}`);
}
function info(msg) {
  console.log(`  ${YELLOW('→')} ${msg}`);
}
function section(title) {
  console.log(`\n${BOLD(title)}`);
  console.log('  ' + '─'.repeat(44));
}
function prompt(msg) {
  return new Promise(resolve => {
    process.stdout.write(`\n  ${YELLOW('?')} ${msg} ${DIM('[press Enter]')} `);
    process.stdin.once('data', () => resolve());
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testHealth() {
  section('1. Health Check');
  const r = await get('/health');
  if (r.status !== 200) { fail('Server not reachable', `HTTP ${r.status}`); process.exit(1); }

  const b = r.body;
  pass('Server is running', `uptime ${b.uptime}s`);
  info(`OS: ${b.os} ${b.arch}  |  version: ${b.serverVersion}`);
  info(`Mock mode: ${b.mock}`);
  info(`Auto-start registered: ${b.autoStartRegistered}`);
  info(`Log file: ${b.logFile}`);

  if (b.isConnected) {
    pass('Device connected', `port: ${b.connectedPort}`);
  } else {
    fail('Device NOT connected');
    info('Available ports:');
    if (b.availablePorts.length === 0) {
      console.log(`    ${DIM('(none)')}`);
    } else {
      b.availablePorts.forEach(p => {
        console.log(`    ${DIM('•')} ${p.path}  vendor:${p.vendorId || 'n/a'}  ${p.manufacturer || ''}`);
      });
    }
    console.log(`\n  ${RED('Cannot run device tests — plug in the QR-VIEW and restart the server.')}`);
    process.exit(1);
  }
}

async function testPorts() {
  section('2. Port List');
  const r = await get('/ports');
  if (!r.body.success) { fail('GET /ports failed'); return; }
  pass(`Found ${r.body.ports.length} port(s)`);
  r.body.ports.forEach(p => {
    console.log(`    ${DIM('•')} ${p.path}  vendor:${p.vendorId || 'n/a'}  ${p.manufacturer || ''}`);
  });
}

async function testScreens() {
  section('3. Screen Switching');

  let r = await post('/jump/0');
  r.body.success ? pass('JUMP(0) — home screen') : fail('JUMP(0) failed', r.body.error);
  await wait(1000);

  r = await post('/jump/1');
  r.body.success ? pass('JUMP(1) — payment screen') : fail('JUMP(1) failed', r.body.error);
  await wait(1000);

  r = await post('/jump/2');
  r.body.success ? pass('JUMP(2) — success screen') : fail('JUMP(2) failed', r.body.error);
  await wait(1000);

  r = await post('/jump/0');
  r.body.success ? pass('JUMP(0) — back to home') : fail('JUMP(0) failed', r.body.error);
}

async function testBrightness() {
  section('4. Brightness');

  for (const lvl of [50, 150, 255, 128]) {
    const r = await post(`/brightness/${lvl}`);
    r.body.success ? pass(`BL(${lvl})`) : fail(`BL(${lvl}) failed`, r.body.error);
    await wait(500);
  }
}

async function testIndividualCommands() {
  section('5. Individual Commands');

  // Switch to payment screen first
  await post('/jump/1');
  await wait(300);

  let r = await post('/qbar', { url: TEST_DATA.sampleQrCode });
  r.body.success ? pass('QBAR — QR code displayed') : fail('QBAR failed', r.body.error);
  await wait(500);

  r = await post('/settxt/bank', { name: TEST_DATA.bankName });
  r.body.success ? pass('SET_TXT(0) — bank name', TEST_DATA.bankName) : fail('SET_TXT(0) failed', r.body.error);
  await wait(500);

  r = await post('/settxt/account', { number: TEST_DATA.accountDisplay });
  r.body.success ? pass('SET_TXT(1) — account', TEST_DATA.accountDisplay) : fail('SET_TXT(1) failed', r.body.error);
  await wait(500);

  r = await post('/settxt/amount', { amount: TEST_DATA.amount });
  r.body.success ? pass('SET_TXT(2) — amount', TEST_DATA.amount) : fail('SET_TXT(2) failed', r.body.error);
  await wait(500);

  r = await post('/clear');
  r.body.success ? pass('CLRF — flush sent') : fail('CLRF failed', r.body.error);
}

async function testFullPayment() {
  section('6. Full /payment Sequence (raw EMVCo QR)');
  info(`Bank:    ${TEST_DATA.bankCode}`);
  info(`Account: ${TEST_DATA.maskedAccountNo}`);
  info(`Amount:  ${TEST_DATA.amount.toLocaleString('vi-VN')} ₫`);
  info(`QR:      ${TEST_DATA.qrCode.slice(0, 40)}...`);

  const r = await post('/payment', {
    qrCode: TEST_DATA.qrCode,
    bankCode: TEST_DATA.bankCode,
    maskedAccountNo: TEST_DATA.maskedAccountNo,
    amount: TEST_DATA.amount,
  });
  if (r.body.success) {
    pass('Full payment sequence sent');
    console.log(`    ${DIM('Sequence: ' + r.body.sequence.join(' → '))}`);
  } else {
    fail('Payment sequence failed', r.body.error);
  }
}

async function testPaymentSuccess() {
  section('7. Payment Success Screen');
  await prompt('When ready, press Enter to trigger payment-success screen...');

  const r = await post('/payment-success');
  r.body.success ? pass('JUMP(2) — success screen shown') : fail('Failed', r.body.error);
  await wait(2000);
}

async function testReset() {
  section('8. Reset to Home');
  const r = await post('/reset');
  r.body.success ? pass('Reset to screen 0 (home)') : fail('Reset failed', r.body.error);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(BOLD('\n╔══════════════════════════════════════════════╗'));
  console.log(BOLD(  '║       QR-VIEW Server — Manual Test           ║'));
  console.log(BOLD(  '╚══════════════════════════════════════════════╝'));

  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  try {
    await testHealth();
    await testPorts();
    await testScreens();
    await testBrightness();
    await testIndividualCommands();

    await prompt('Individual commands done. Press Enter to run the full /payment sequence...');
    await testFullPayment();
    await testPaymentSuccess();
    await testReset();

    section('Done');
    pass('All tests completed');
    console.log(`\n  Check the log if anything looked wrong on the device:`);
    console.log(`  ${DIM('Windows: %USERPROFILE%\\qrview-server.log')}`);
    console.log(`  ${DIM('macOS:   ~/qrview-server.log')}\n`);
  } catch (e) {
    console.log(`\n  ${RED('Error:')} ${e.message}`);
    console.log(`  ${DIM('Is the server running? Start it first, then run this script.')}\n`);
  }

  process.stdin.pause();
}

main();
