import { execFileSync } from 'node:child_process';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function repoRoot(cwd = process.cwd()) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd).trim();
  } catch {
    return null;
  }
}

export function gitDir(cwd) {
  return git(['rev-parse', '--absolute-git-dir'], cwd).trim();
}

export function getHead(cwd) {
  try {
    return git(['rev-parse', 'HEAD'], cwd).trim();
  } catch {
    return null; // repo with no commits yet
  }
}

export function lastReflogAction(cwd) {
  try {
    return git(['reflog', '-1', '--format=%gs', 'HEAD'], cwd).trim();
  } catch {
    return '';
  }
}

export function userIdentity(cwd) {
  const read = (key) => {
    try {
      return git(['config', key], cwd).trim();
    } catch {
      return '';
    }
  };
  return { name: read('user.name'), email: read('user.email') };
}

/**
 * Fetch commits (newest first) with file/line stats.
 * Output format per commit: \x1e hash \x1f author \x1f email \x1f iso-date \x1f subject \x1f body \x1f numstat
 */
export function getCommits({ cwd, count = 20, author, since, until, rev, noMerges = true } = {}) {
  const args = ['log', `-n${count}`, '--numstat', '--pretty=format:%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f'];
  if (noMerges) args.push('--no-merges');
  if (author) args.push('--fixed-strings', `--author=${author}`);
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);
  if (rev) args.push(rev);

  let out;
  try {
    out = git(args, cwd);
  } catch (err) {
    const msg = String(err.stderr || err.message);
    if (/does not have any commits|unknown revision|bad default revision/i.test(msg)) return [];
    throw new Error(msg.trim());
  }

  return out
    .split('\x1e')
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [hash, authorName, email, iso, subject, body = '', numstat = ''] = chunk.split('\x1f');
      let files = 0;
      let insertions = 0;
      let deletions = 0;
      for (const line of numstat.split('\n')) {
        const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
        if (!m) continue;
        files += 1;
        if (m[1] !== '-') insertions += Number(m[1]);
        if (m[2] !== '-') deletions += Number(m[2]);
      }
      const h = hash.trim();
      return {
        hash: h,
        short: h.slice(0, 7),
        author: authorName,
        email,
        date: new Date(iso),
        subject: (subject || '').trim(),
        body: body.trim(),
        files,
        insertions,
        deletions,
      };
    });
}
