import { FLAG_INFO } from './analyze.js';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const bold = paint('1');
export const dim = paint('2');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const cyan = paint('36');

export const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function wrap(text, width = 78) {
  return text
    .split('\n')
    .map((line) => {
      if (line.length <= width) return line;
      const out = [];
      let cur = '';
      for (const w of line.split(' ')) {
        if (cur && `${cur} ${w}`.length > width) {
          out.push(cur);
          cur = w;
        } else cur = cur ? `${cur} ${w}` : w;
      }
      if (cur) out.push(cur);
      return out.join('\n');
    })
    .join('\n');
}

const indent = (text) =>
  wrap(text)
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');

export function meter(score) {
  const bar = '█'.repeat(score) + '░'.repeat(10 - score);
  const col = score >= 7 ? red : score >= 4 ? yellow : green;
  return `${col(bar)} ${bold(`${score}/10`)}`;
}

export function banner(title) {
  console.log(`\n${bold('🔥 roast-commits')} ${dim(`· ${title}`)}\n`);
}

export function printAnalysis(a) {
  console.log(`${dim('commits analyzed')} ${a.total}    ${dim('shame score')} ${meter(a.score)}`);
  const flags = Object.entries(a.counts)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${FLAG_INFO[k].label}: ${v}`)
    .join(' · ');
  if (flags) console.log(dim(flags));
  if (a.duplicates[0]) console.log(dim(`most repeated message: "${trunc(a.duplicates[0].subject, 40)}" x${a.duplicates[0].count}`));
  if (a.worst) {
    const why = a.worst.flags.map((f) => FLAG_INFO[f].label).join(', ');
    console.log(`${dim('worst offender')} ${bold(a.worst.commit.short)} "${trunc(a.worst.commit.subject, 50)}" ${dim(`(${why})`)}`);
  }
}

export function printRoast(result) {
  if (result.warning) console.error(yellow(`! ${result.warning}`));
  console.log(`\n${indent(result.text)}\n`);
  console.log(dim(`  — ${result.source}`));
}

export function printLiveRoast(commit, result) {
  const t = new Date().toLocaleTimeString();
  console.log(`${dim(`[${t}]`)} ${bold(commit.short)} ${cyan(`"${trunc(commit.subject, 70)}"`)}`);
  if (result.warning) console.log(yellow(`! ${result.warning.split('\n')[0]}`));
  console.log(indent(result.text));
  console.log(dim(`  — ${result.source}`));
  console.log('');
}

export const warn = (m) => console.error(yellow(`! ${m}`));
export const fail = (m) => {
  console.error(red(`✖ ${m}`));
  process.exit(1);
};
