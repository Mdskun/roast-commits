import { churn } from './analyze.js';

const trunc = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hashStr = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

const T = {
  lazy: [
    (c) => `"${trunc(c.subject)}" is not a commit message, it's a cry for help.`,
    (c) => `"${trunc(c.subject)}"... bold of you to assume future you will know what that means.`,
  ],
  short: [
    (c) => `"${trunc(c.subject)}" — brevity is the soul of wit, but this is just the soul leaving.`,
    (c) => `"${trunc(c.subject)}" tells us almost nothing. A mystery novel with one word.`,
  ],
  caps: [
    (c) => `"${trunc(c.subject)}" — the caps lock is not a debugger.`,
    (c) => `Why is "${trunc(c.subject)}" screaming? The code can't hear you.`,
  ],
  punct: [
    (c) => `"${trunc(c.subject)}" — that much punctuation never fixed a bug.`,
    (c) => `Those exclamation marks in "${trunc(c.subject)}" are doing more work than the diff.`,
  ],
  swear: [
    (c) => `"${trunc(c.subject)}" — the commit log is not a therapy session. Well, it kind of is.`,
    (c) => `Colorful language in "${trunc(c.subject)}". The code clearly fought back.`,
  ],
  panic: [
    (c) => `"${trunc(c.subject)}" has serious "I pushed to main and I regret it" energy.`,
    (c) => `"${trunc(c.subject)}" — you can almost hear the sweat.`,
  ],
  final: [
    (c) => `"${trunc(c.subject)}" — we both know that was not the final one.`,
    (c) => `Calling it "final" is the fastest way to guarantee three more commits.`,
  ],
  wip: [
    (c) => `"${trunc(c.subject)}" — a work in progress, committed with the confidence of someone who will never finish.`,
    (c) => `WIP commits: because "I'll clean it up later" deserves a hash too.`,
  ],
  night: [
    (c) => `Committed at ${c.date.toTimeString().slice(0, 5)}. Nothing good ever ships at that hour, sleep is not optional.`,
    (c) => `${c.date.toTimeString().slice(0, 5)} commit? The only thing you're pushing is your luck.`,
  ],
  weekend: [
    (c) => `A weekend commit ("${trunc(c.subject, 40)}"). Touch grass, the backlog will survive.`,
    (c) => `Working on a weekend for "${trunc(c.subject, 40)}"? Passion or poor planning, you decide.`,
  ],
  giant: [
    (c) => `${c.files} files and ${churn(c)} changed lines in one commit. Reviewers fear you.`,
    (c) => `"${trunc(c.subject)}" touches ${c.files} files. That's not a commit, that's a migration.`,
  ],
  giantTiny: [
    (c) => `${c.files} files, ${churn(c)} lines changed, and the message is "${trunc(c.subject)}". Incredible restraint in documentation.`,
    (c) => `"${trunc(c.subject)}" for ${churn(c)} changed lines. A tiny label on a huge crime scene.`,
  ],
  novel: [
    (c) => `That subject line is longer than some of my relationships. Put it in the body.`,
    (c) => `Your commit subject is an essay. Git has a body field, it's free.`,
  ],
};

const VERDICTS = [
  [2, 'Verdict: suspiciously clean. Did you squash everything or are you just disciplined?'],
  [5, 'Verdict: not terrible, not great. The git log of a person who means well.'],
  [8, 'Verdict: this history needs an intervention and probably a style guide.'],
  [11, 'Verdict: a masterclass in how not to talk to your future self.'],
];

const verdict = (score) => (VERDICTS.find(([max]) => score <= max) || VERDICTS.at(-1))[1];

const bestFlag = (p) => [...p.flags].sort((a, b) => weight(b) - weight(a))[0];
const WEIGHTS = { giantTiny: 3, lazy: 3, caps: 2, swear: 2, panic: 2, final: 2, wip: 2, giant: 2 };
const weight = (f) => WEIGHTS[f] || 1;

export function localCommitRoast(commit, flags) {
  if (!flags.length) return `"${trunc(commit.subject)}" — annoyingly acceptable. I got nothing. Suspicious.`;
  const lines = [...flags]
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, 2)
    .map((f) => pick(T[f], hashStr(commit.hash + f))(commit));
  return lines.join(' ');
}

export function localHistoryRoast(a) {
  const lines = [];

  const offenders = a.per
    .filter((p) => p.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 4);
  for (const p of offenders) {
    const f = bestFlag(p);
    lines.push(`${p.commit.short}: ${pick(T[f], hashStr(p.commit.hash))(p.commit)}`);
  }

  if (a.counts.night >= 2) lines.push(`${a.counts.night} commits between midnight and 5am. Sleep is a feature worth shipping too.`);
  if (a.counts.weekend >= 2) lines.push(`${a.counts.weekend} weekend commits. Your calendar called, it wants a day off.`);
  if (a.duplicates[0]) lines.push(`"${trunc(a.duplicates[0].subject)}" appears ${a.duplicates[0].count} times. Copy-paste is a lifestyle.`);
  if (a.rapid >= 3) lines.push(`${a.rapid} commits landed within two minutes of the previous one. Commit early, commit often, think never.`);
  if (a.lazyStreak >= 3) lines.push(`Longest streak of lazy messages: ${a.lazyStreak} in a row. Consistency, at least.`);

  if (!lines.length) lines.push('A clean history. Suspiciously clean. Come back when you have sinned.');
  lines.push(verdict(a.score));
  return lines.join('\n');
}
