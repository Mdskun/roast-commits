import fs from 'node:fs';
import readline from 'node:readline';
import * as cfgMod from './config.js';
import { repoRoot, getCommits, userIdentity } from './git.js';
import { analyzeHistory } from './analyze.js';
import { roastHistory } from './roast.js';
import * as live from './live.js';
import * as ui from './print.js';

const { PROVIDERS, INTENSITIES } = cfgMod;

const BOOL = new Set(['no-ai', 'help', 'follow', 'daemon', 'no-notify', 'version']);
const SHORT = { n: 'count', a: 'author', s: 'since', i: 'intensity', p: 'provider', m: 'model', r: 'repo', h: 'help', f: 'follow', v: 'version' };

function parseArgs(argv) {
  const _ = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let key;
    let val;
    if (a.startsWith('--')) {
      [key, val] = a.slice(2).split(/=(.*)/s);
    } else if (/^-[a-z]$/.test(a)) {
      key = SHORT[a[1]] || a[1];
    } else {
      _.push(a);
      continue;
    }
    if (val === undefined && !BOOL.has(key)) val = argv[++i];
    flags[key] = val === undefined ? true : val;
  }
  return { _, flags };
}

const HELP = `
roast-commits: a CLI that roasts your git commits

USAGE
  roast history [options]        roast recent commits (analyzed locally, then sent to an LLM)
  roast live                     watch this repo in the foreground, roast every new commit
  roast live start               same, but as a background process (desktop notifications + log)
  roast live stop|status|logs    manage the background process for this repo
  roast config <subcommand>      manage API keys and defaults

HISTORY OPTIONS
  -n, --count <num>              number of commits (default 20)
  -a, --author <name|me>         only commits by this author ("me" = git config user)
  -s, --since <when>             e.g. "1 week ago", "2025-01-01"
  --until <when>                 upper date bound

SHARED OPTIONS
  -i, --intensity <level>        mild | medium | savage
  -p, --provider <name>          anthropic | openai | gemini
  -m, --model <id>               override the model
  -r, --repo <path>              repo path (default: current directory)
  --no-ai                        local heuristics only, no API call
  --no-notify                    (live start) disable desktop notifications
  -f, --follow                   (live logs) keep streaming the log

CONFIG
  roast config set-key <provider> [key]   store an API key (prompts if key omitted)
  roast config remove-key <provider>
  roast config set provider <name>
  roast config set intensity <level>
  roast config set model <provider> <id>
  roast config show | path

API keys can also come from ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY.
If several keys exist, the preferred provider is tried first, the others act as fallbacks.
`;

function resolveOpts(flags) {
  const cfg = cfgMod.load();
  const intensity = flags.intensity || cfg.intensity || 'medium';
  if (!INTENSITIES.includes(intensity)) ui.fail(`intensity must be one of: ${INTENSITIES.join(', ')}`);
  if (flags.provider && !PROVIDERS.includes(flags.provider)) ui.fail(`provider must be one of: ${PROVIDERS.join(', ')}`);
  return { intensity, provider: flags.provider, model: flags.model, useAI: !flags['no-ai'] };
}

function needRepo(flags) {
  const root = repoRoot(flags.repo || process.cwd());
  if (!root) ui.fail('Not inside a git repository (use --repo <path>).');
  return root;
}

async function cmdHistory(flags) {
  const root = needRepo(flags);
  const opts = resolveOpts(flags);

  let author = flags.author;
  if (author === 'me') {
    const id = userIdentity(root);
    author = id.email || id.name;
    if (!author) ui.fail('git user.name / user.email not set, cannot resolve "me".');
  }

  const count = Number(flags.count || 20);
  if (!Number.isInteger(count) || count < 1) ui.fail('--count must be a positive integer.');

  const commits = getCommits({ cwd: root, count, author, since: flags.since, until: flags.until });
  if (!commits.length) ui.fail('No commits found for that selection.');

  ui.banner('history mode');
  ui.printAnalysis(analyzeHistory(commits));

  if (opts.useAI && process.stdout.isTTY) process.stdout.write(ui.dim('\nasking the LLM to be mean…'));
  const result = await roastHistory({ commits, ...opts });
  if (opts.useAI && process.stdout.isTTY) process.stdout.write('\r\x1b[K');

  ui.printRoast(result);
}

async function cmdLive(sub, flags) {
  const root = needRepo(flags);

  if (flags.daemon) {
    live.watch({ root, flags, daemon: true, opts: resolveOpts(flags) });
    return;
  }

  switch (sub) {
    case undefined: {
      ui.banner('live mode (foreground, Ctrl+C to quit)');
      live.watch({ root, flags, daemon: false, opts: resolveOpts(flags) });
      return;
    }
    case 'start': {
      resolveOpts(flags); // validate flags before spawning
      const r = await live.start(root, flags);
      if (r.already) return console.log(`Already running (pid ${r.pid}) for ${root}`);
      console.log(`Started background watcher (pid ${r.pid}) for ${root}`);
      console.log(ui.dim(`log: ${r.logFile}`));
      if (!cfgMod.configuredProviders().length && !flags['no-ai']) {
        ui.warn('No API key found, roasts will use local heuristics. Add one: roast config set-key <provider>');
      }
      return;
    }
    case 'stop':
      return console.log(live.stop(root) ? 'Stopped the background watcher.' : 'Not running.');
    case 'status': {
      const s = live.status(root);
      console.log(s.running ? `running (pid ${s.pid})` : 'not running');
      console.log(ui.dim(`log: ${s.logFile}`));
      return;
    }
    case 'logs':
      return live.tailLog(root, { follow: Boolean(flags.follow) });
    default:
      ui.fail(`Unknown live subcommand "${sub}". Try: start | stop | status | logs`);
  }
}

function promptSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s === question) process.stdout.write(s);
      else if (/[\r\n]/.test(s)) process.stdout.write('\n');
      else process.stdout.write('*');
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function checkProvider(p) {
  if (!PROVIDERS.includes(p)) ui.fail(`provider must be one of: ${PROVIDERS.join(', ')}`);
}

async function cmdConfig(args) {
  const [sub, a, b] = args;
  const cfg = cfgMod.load();

  switch (sub) {
    case 'set-key': {
      checkProvider(a);
      const key = b || (await promptSecret(`${a} API key: `));
      if (!key) ui.fail('No key given.');
      cfg.keys[a] = key;
      if (!cfg.provider) cfg.provider = a;
      cfgMod.save(cfg);
      return console.log(`Saved ${a} key (${cfgMod.maskKey(key)}). Stored in ${cfgMod.configPath()}`);
    }
    case 'remove-key': {
      checkProvider(a);
      delete cfg.keys[a];
      if (cfg.provider === a) cfg.provider = null;
      cfgMod.save(cfg);
      return console.log(`Removed ${a} key.`);
    }
    case 'set': {
      if (a === 'provider') {
        checkProvider(b);
        cfg.provider = b;
      } else if (a === 'intensity') {
        if (!INTENSITIES.includes(b)) ui.fail(`intensity must be one of: ${INTENSITIES.join(', ')}`);
        cfg.intensity = b;
      } else if (a === 'model') {
        checkProvider(b);
        const model = args[3];
        if (!model) ui.fail('Usage: roast config set model <provider> <model-id>');
        cfg.models[b] = model;
      } else ui.fail('Usage: roast config set <provider|intensity|model> ...');
      cfgMod.save(cfg);
      return console.log('Saved.');
    }
    case 'show': {
      console.log(`provider:  ${cfg.provider || '(auto)'}`);
      console.log(`intensity: ${cfg.intensity}`);
      for (const p of PROVIDERS) {
        const key = cfgMod.getKey(p, cfg);
        const src = process.env[cfgMod.ENV_KEYS[p]] ? 'env' : 'config';
        console.log(`${p.padEnd(10)} key: ${cfgMod.maskKey(key)}${key ? ` (${src})` : ''}   model: ${cfg.models[p] || 'default'}`);
      }
      return;
    }
    case 'path':
      return console.log(cfgMod.configPath());
    default:
      ui.fail('Usage: roast config <set-key|remove-key|set|show|path>');
  }
}

export async function main(argv) {
  const { _, flags } = parseArgs(argv);
  const [cmd, ...rest] = _;

  if (flags.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version);
  }
  if (!cmd || flags.help || cmd === 'help') return console.log(HELP);

  switch (cmd) {
    case 'history':
    case 'h':
      return cmdHistory(flags);
    case 'live':
      return cmdLive(rest[0], flags);
    case 'config':
      return cmdConfig(rest);
    default:
      ui.fail(`Unknown command "${cmd}". Run: roast --help`);
  }
}
