import { load, getKey, providerChain } from './config.js';

export const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 529]);

// Pull a short, readable message out of a provider's JSON error body.
function brief(text) {
  try {
    const j = JSON.parse(text);
    return String(j.error?.message || j.message || text).split('\n')[0].slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

// POST with up to 2 retries on rate limits / overload (429, 5xx).
async function post(url, headers, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (attempt < 2 && RETRYABLE.has(res.status)) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${brief(text)}`);
  }
}

const adapters = {
  async anthropic({ key, model, system, user }) {
    const d = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: 1000, system, messages: [{ role: 'user', content: user }] },
    );
    return d.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  },

  async openai({ key, model, system, user }) {
    const d = await post(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${key}` },
      {
        model,
        max_tokens: 1000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
    );
    return d.choices?.[0]?.message?.content || '';
  },

  async gemini({ key, model, system, user }) {
    // Gemini 2.5 "thinking" tokens count against maxOutputTokens, which truncated roasts mid-sentence.
    const generationConfig = { maxOutputTokens: 2048 };
    if (/gemini-2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    const d = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': key },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig,
      },
    );
    return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  },
};

/**
 * Try the requested provider (or the configured chain of providers that have keys).
 * Falls through to the next provider on failure.
 */
export async function generate({ system, user, provider, model }) {
  const cfg = load();
  const chain = provider ? [provider] : providerChain(cfg);

  if (!chain.length) {
    const err = new Error('No API key configured. Run: roast config set-key <anthropic|openai|gemini>');
    err.code = 'NO_KEY';
    throw err;
  }

  const errors = [];
  for (const p of chain) {
    const key = getKey(p, cfg);
    if (!key) {
      errors.push(`${p}: no API key`);
      continue;
    }
    const m = (p === chain[0] && model) || cfg.models?.[p] || DEFAULT_MODELS[p];
    try {
      const text = await adapters[p]({ key, model: m, system, user });
      if (!text.trim()) throw new Error('empty response');
      return { text: text.trim(), provider: p, model: m };
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  throw new Error(errors.join('\n'));
}
