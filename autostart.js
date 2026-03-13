'use strict';
const os = require('os'), fs = require('fs'), path = require('path');
const { execSync } = require('child_process');

function setupAutoStart(execPath) {
  const p = os.platform();
  console.log(`[AutoStart] OS: ${p} | arch: ${os.arch()}`);
  try {
    if (p === 'win32')       setupWindows(execPath);
    else if (p === 'darwin') setupMacOS(execPath);
    else                     setupLinux(execPath);
  } catch (e) { console.error('[AutoStart] Error:', e.message); }
}

function removeAutoStart() {
  const p = os.platform();
  try {
    if (p === 'win32') {
      execSync('schtasks /delete /tn "QRViewServer" /f', { stdio: 'ignore' });
    } else if (p === 'darwin') {
      const pl = path.join(os.homedir(),'Library','LaunchAgents','com.qrview.server.plist');
      execSync(`launchctl unload -w "${pl}"`, { stdio: 'ignore' });
      if (fs.existsSync(pl)) fs.unlinkSync(pl);
    } else {
      execSync('systemctl --user disable qrview-server.service', { stdio: 'ignore' });
      execSync('systemctl --user stop qrview-server.service', { stdio: 'ignore' });
      const s = path.join(os.homedir(),'.config','systemd','user','qrview-server.service');
      if (fs.existsSync(s)) fs.unlinkSync(s);
    }
  } catch (e) { console.error('[AutoStart] Remove error:', e.message); }
}

function setupWindows(execPath) {
  const xp = path.join(os.tmpdir(), 'qrview-task.xml');
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>QR-VIEW Serial Background Agent</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
    <BootTrigger><Enabled>true</Enabled></BootTrigger>
  </Triggers>
  <Principals><Principal id="Author">
    <LogonType>InteractiveToken</LogonType>
    <RunLevel>HighestAvailable</RunLevel>
  </Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions><Exec>
    <Command>${execPath.replace(/\\/g,'\\\\')}</Command>
  </Exec></Actions>
</Task>`;
  fs.writeFileSync(xp, xml, 'utf-16le');
  execSync(`schtasks /create /tn "QRViewServer" /xml "${xp}" /f`, { windowsHide:true, stdio:'ignore' });
  fs.unlinkSync(xp);
  console.log('[AutoStart] Windows Task Scheduler entry created. Auto-starts on every logon.');
}

function setupMacOS(execPath) {
  const label = 'com.qrview.server';
  const dir   = path.join(os.homedir(),'Library','LaunchAgents');
  const logs  = path.join(os.homedir(),'Library','Logs');
  fs.mkdirSync(dir, { recursive:true }); fs.mkdirSync(logs, { recursive:true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key>             <string>${label}</string>
  <key>ProgramArguments</key>  <array><string>${execPath}</string></array>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>${path.join(logs,'qrview-server.log')}</string>
  <key>StandardErrorPath</key> <string>${path.join(logs,'qrview-server-err.log')}</string>
  <key>ProcessType</key>       <string>Background</string>
</dict></plist>`;
  const pp = path.join(dir, `${label}.plist`);
  fs.writeFileSync(pp, plist, 'utf-8');
  execSync(`launchctl load -w "${pp}"`, { stdio:'ignore' });
  console.log(`[AutoStart] macOS LaunchAgent registered: ${pp}`);
}

function setupLinux(execPath) {
  const dir = path.join(os.homedir(),'.config','systemd','user');
  fs.mkdirSync(dir, { recursive:true });
  const svc = `[Unit]\nDescription=QRView Serial Background Agent\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${execPath}\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
  fs.writeFileSync(path.join(dir,'qrview-server.service'), svc);
  execSync('systemctl --user daemon-reload', { stdio:'ignore' });
  execSync('systemctl --user enable qrview-server.service', { stdio:'ignore' });
  execSync('systemctl --user start  qrview-server.service', { stdio:'ignore' });
  try { execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio:'ignore' }); } catch(_){}
  console.log('[AutoStart] Linux systemd user service registered.');
}

module.exports = { setupAutoStart, removeAutoStart };
