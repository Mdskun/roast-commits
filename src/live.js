import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from './config.js';
import { getHead, lastReflogAction, getCommits, gitDir } from './git.js';
import { roastLive } from './roast.js';
import * as ui from './print.js';

const LIVE_DIR = path.join(CONFIG_DIR, 'live');
const CLI = fileURLToPath(new URL('../bin/roast.js', import.meta.url));

export function statePaths(root) {
  const id = crypto.createHash('sha1').update(root).digest('hex').slice(0, 10);
  return { pidFile: path.join(LIVE_DIR, `${id}.pid`), logFile: path.join(LIVE_DIR, `${id}.log`) };
}

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function status(root) {
  const paths = statePaths(root);
  const pid = readPid(paths.pidFile);
  return { ...paths, pid, running: Boolean(pid) && alive(pid) };
}

export async function start(root, flags) {
  const s = status(root);
  if (s.running) return { already: true, ...s };

  fs.mkdirSync(LIVE_DIR, { recursive: true });
  const out = fs.openSync(s.logFile, 'a');

  const args = [CLI, 'live', '--daemon', '--repo', root];
  for (const k of ['intensity', 'provider', 'model']) if (flags[k]) args.push(`--${k}`, String(flags[k]));
  for (const k of ['no-ai', 'no-notify']) if (flags[k]) args.push(`--${k}`);

  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', out, out], cwd: root, windowsHide: true });
  child.unref();

  // Wait until the daemon has snapshotted HEAD and written its pid file (max ~5s).
  for (let i = 0; i < 100 && readPid(s.pidFile) !== child.pid; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return { already: false, ...s, pid: child.pid };
}

export function stop(root) {
  const s = status(root);
  try {
    fs.unlinkSync(s.pidFile);
  } catch {}
  if (!s.running) return false;
  process.kill(s.pid, 'SIGTERM');
  return true;
}

export function tailLog(root, { lines = 40, follow = false } = {}) {
  const { logFile } = statePaths(root);
  if (!fs.existsSync(logFile)) return ui.warn('No log yet. Start the watcher with: roast live start');

  const content = fs.readFileSync(logFile, 'utf8');
  process.stdout.write(content.split('\n').slice(-lines - 1).join('\n'));
  if (!follow) return;

  let pos = Buffer.byteLength(content);
  setInterval(() => {
    const size = fs.statSync(logFile).size;
    if (size < pos) pos = 0; // log was truncated
    if (size === pos) return;
    const fd = fs.openSync(logFile, 'r');
    const buf = Buffer.alloc(size - pos);
    fs.readSync(fd, buf, 0, buf.length, pos);
    fs.closeSync(fd);
    pos = size;
    process.stdout.write(buf.toString('utf8'));
  }, 500);
}

function notify(title, body) {
  const text = body.length > 400 ? `${body.slice(0, 399)}…` : body;
  const done = () => {};
  if (process.platform === 'linux') {
    execFile('notify-send', ['-a', 'roast-commits', title, text], done);
  } else if (process.platform === 'darwin') {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execFile('osascript', ['-e', `display notification "${esc(text)}" with title "${esc(title)}"`], done);
  } else if (process.platform === 'win32') {
    // Title/body travel via env vars so commit messages can never be interpreted as PowerShell code.
    const script = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
      "$n = $t.GetElementsByTagName('text')",
      "$n.Item(0).AppendChild($t.CreateTextNode($env:ROAST_TITLE)) | Out-Null",
      "$n.Item(1).AppendChild($t.CreateTextNode($env:ROAST_BODY)) | Out-Null",
      // Borrow the PowerShell app id: toasts from an unregistered app id are dropped on many Windows builds.
      "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($t))",
    ].join('; ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ROAST_TITLE: title, ROAST_BODY: text }, windowsHide: true },
      done,
    );
  }
}

/**
 * Watch a repo and roast every new commit. Runs until killed.
 * daemon=true: write a pid file and send desktop notifications (output goes to the log file).
 */
export function watch({ root, flags, daemon, opts }) {
  const { pidFile } = statePaths(root);

  // Snapshot HEAD first: the pid file below signals "ready", so any commit made after
  // `roast live start` returns is guaranteed to be seen as new.
  let last = getHead(root);

  if (daemon) {
    fs.mkdirSync(LIVE_DIR, { recursive: true });
    fs.writeFileSync(pidFile, String(process.pid));
    const cleanup = () => {
      try {
        if (readPid(pidFile) === process.pid) fs.unlinkSync(pidFile);
      } catch {}
      process.exit(0);
    };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
  } else {
    process.on('SIGINT', () => process.exit(0));
  }

  let busy = false;
  let again = false;

  async function handle(head) {
    const [commit] = getCommits({ cwd: root, count: 1, rev: head, noMerges: false });
    if (!commit) return;
    const context = getCommits({ cwd: root, count: 6 });
    const result = await roastLive({ commit, context, ...opts });
    ui.printLiveRoast(commit, result);
    if (daemon && !flags['no-notify']) notify(`🔥 ${commit.short} ${ui.trunc(commit.subject, 50)}`, result.text);
  }

  async function check() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        const head = getHead(root);
        if (!head || head === last) continue;
        last = head;
        // Only real commits (incl. amend/initial/merge commits), not checkouts, resets, pulls or rebases.
        if (!(lastReflogAction(root) || '').startsWith('commit')) continue;
        await handle(head);
      } while (again);
    } catch (err) {
      console.error(`watcher error: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  try {
    fs.watch(path.join(gitDir(root), 'logs'), (_event, name) => {
      if (!name || name === 'HEAD') check();
    });
  } catch {
    // logs dir may not exist in a brand new repo; the poll below covers it
  }
  setInterval(check, 2000);

  console.log(`${ui.dim(`[${new Date().toLocaleTimeString()}]`)} watching ${root}`);
}
