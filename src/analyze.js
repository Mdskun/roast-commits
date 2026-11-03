export const FLAG_INFO = {
  lazy: { label: 'lazy message', weight: 3 },
  short: { label: 'tiny message', weight: 1 },
  caps: { label: 'SHOUTING', weight: 2 },
  punct: { label: 'excessive punctuation', weight: 1 },
  swear: { label: 'profanity', weight: 2 },
  panic: { label: 'panic energy', weight: 2 },
  final: { label: '"final" (it was not)', weight: 2 },
  wip: { label: 'WIP', weight: 2 },
  night: { label: 'late night (0-5am)', weight: 1 },
  weekend: { label: 'weekend', weight: 1 },
  giant: { label: 'giant diff', weight: 2 },
  giantTiny: { label: 'giant diff, tiny message', weight: 3 },
  novel: { label: 'essay in subject line', weight: 1 },
};

const LAZY_RE =
  /^(fix(es|ed)?|update[sd]?|wip|tests?|testing|asdf\w*|stuff|things?|changes?|misc|temp|tmp|commit|done|final|ok|okay|oops|minor|cleanup|save|more|again|lol|idk|\.+|-+|x+|\d+|\w{1,3})[.!]*$/i;
const SWEAR_RE = /\b(shit\w*|fuck\w*|damn\w*|crap|wtf|bullshit|ffs|hell)\b/i;
const PANIC_RE = /\b(oops|whoops|typo|forgot|again|actually|finally|hopefully|please work|pls work|why|idk|i hate|sorry)\b/i;
const FINAL_RE = /final.*(final|v\d|real|last|\d)|\b(really|actually) (fix|final)/i;
const CONVENTIONAL_RE = /^(feat|fix|docs|chore|refactor|test|style|perf|build|ci|revert)(\(.+\))?!?:/i;

export const churn = (c) => c.insertions + c.deletions;

export function analyzeCommit(c) {
  const s = c.subject.trim();
  const flags = [];

  const lazy = LAZY_RE.test(s);
  if (lazy) flags.push('lazy');
  else if (s.length < 12) flags.push('short');

  const letters = s.replace(/[^a-z]/gi, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) flags.push('caps');
  if (/[!?]{2,}/.test(s)) flags.push('punct');
  if (SWEAR_RE.test(s)) flags.push('swear');
  if (PANIC_RE.test(s)) flags.push('panic');
  if (FINAL_RE.test(s)) flags.push('final');
  if (!lazy && /\bwip\b/i.test(s)) flags.push('wip');

  const hour = c.date.getHours();
  const day = c.date.getDay();
  if (hour < 5) flags.push('night');
  if (day === 0 || day === 6) flags.push('weekend');

  if (c.files >= 25 || churn(c) >= 800) flags.push(s.length < 20 ? 'giantTiny' : 'giant');
  if (s.length > 100) flags.push('novel');

  const score = flags.reduce((n, f) => n + FLAG_INFO[f].weight, 0);
  return { flags, score };
}

export function analyzeHistory(commits) {
  const per = commits.map((commit) => ({ commit, ...analyzeCommit(commit) }));
  const total = commits.length;

  const counts = {};
  for (const p of per) for (const f of p.flags) counts[f] = (counts[f] || 0) + 1;

  const bySubject = new Map();
  for (const c of commits) {
    const key = c.subject.trim().toLowerCase();
    bySubject.set(key, (bySubject.get(key) || 0) + 1);
  }
  const duplicates = [...bySubject]
    .filter(([, n]) => n > 1)
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count);
  const dupExtra = duplicates.reduce((n, d) => n + d.count - 1, 0);

  const chrono = [...per].sort((a, b) => a.commit.date - b.commit.date);
  let rapid = 0;
  let streak = 0;
  let lazyStreak = 0;
  chrono.forEach((p, i) => {
    if (i > 0 && p.commit.date - chrono[i - 1].commit.date < 120_000) rapid += 1;
    if (p.flags.includes('lazy')) {
      streak += 1;
      lazyStreak = Math.max(lazyStreak, streak);
    } else streak = 0;
  });

  const hours = new Array(24).fill(0);
  for (const c of commits) hours[c.date.getHours()] += 1;
  const busiestHour = hours.indexOf(Math.max(...hours));

  const avgLen = Math.round(commits.reduce((n, c) => n + c.subject.length, 0) / Math.max(total, 1));
  const conventionalPct = Math.round(
    (commits.filter((c) => CONVENTIONAL_RE.test(c.subject)).length / Math.max(total, 1)) * 100,
  );

  const worst = [...per].sort((a, b) => b.score - a.score || churn(b.commit) - churn(a.commit))[0];
  const biggest = [...commits].sort((a, b) => churn(b) - churn(a))[0];

  const weightSum = per.reduce((n, p) => n + p.score, 0);
  const score = Math.max(0, Math.min(10, Math.round((weightSum / Math.max(total, 1)) * 3 + (dupExtra / Math.max(total, 1)) * 6)));

  return {
    total,
    per,
    counts,
    duplicates,
    rapid,
    lazyStreak,
    busiestHour,
    avgLen,
    conventionalPct,
    worst: worst && worst.score > 0 ? worst : null,
    biggest,
    score,
  };
}
