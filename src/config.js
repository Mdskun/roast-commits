import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR =
  process.env.ROAST_HOME ||
  path.join(
    process.env.XDG_CONFIG_HOME ||
      (process.platform === 'win32' ? process.env.APPDATA : '') ||
      path.join(os.homedir(), '.config'),
    'roast-commits',
  );

const FILE = path.join(CONFIG_DIR, 'config.json');

export const PROVIDERS = ['anthropic', 'openai', 'gemini'];
export const INTENSITIES = ['mild', 'medium', 'savage'];
export const ENV_KEYS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

const DEFAULTS = { provider: null, intensity: 'medium', models: {}, keys: {} };

export function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...raw, models: raw.models || {}, keys: raw.keys || {} };
  } catch {
    return { ...DEFAULTS, models: {}, keys: {} };
  }
}

export function save(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function configPath() {
  return FILE;
}

// Environment variables win over the config file.
export function getKey(provider, cfg = load()) {
  return process.env[ENV_KEYS[provider]] || cfg.keys?.[provider] || null;
}

export function configuredProviders(cfg = load()) {
  return PROVIDERS.filter((p) => getKey(p, cfg));
}

// Preferred provider first, then every other provider that has a key (used as fallbacks).
export function providerChain(cfg = load()) {
  const available = configuredProviders(cfg);
  if (!available.length) return [];
  const primary = cfg.provider && available.includes(cfg.provider) ? cfg.provider : available[0];
  return [primary, ...available.filter((p) => p !== primary)];
}

export function maskKey(key) {
  if (!key) return '(not set)';
  if (key.length <= 10) return '*'.repeat(key.length);
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}
