// POST /api/interpret
// The AI turns a patient's own words, or a photo of a diagnosis note, into a cancer type to search for.
// ---- helpers (kept in this file so it can be added to GitHub on its own) ----
const MODEL = 'claude-haiku-5-5';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

function getKey() {
  try { if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get('ANTHROPIC_API_KEY'); } catch (e) {}
  return process.env.ANTHROPIC_API_KEY;
}

async function askClaude({ system, content, maxTokens = 1500 }) {
  const key = getKey();
  if (!key) { const e = new Error('no_key'); e.code = 'no_key'; throw e; }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] })
  });
  if (!r.ok) { const e = new Error('ai_' + r.status); e.code = 'ai_error'; throw e; }
  const j = await r.json();
  return (j.content || []).map(b => b.text || '').join('').trim();
}

// Pull the first JSON object or array out of a model reply (tolerates code fences).
function parseJSON(text) {
  const clean = text.replace(/```(json)?/g, '');
  const start = clean.search(/[\[{]/);
  if (start < 0) throw new Error('no_json');
  const open = clean[start], close = open === '[' ? ']' : '}';
  const end = clean.lastIndexOf(close);
  return JSON.parse(clean.slice(start, end + 1));
}

function sameSite(req) {
  // Light protection: only accept calls from this site's own pages.
  const origin = req.headers.get('origin') || '';
  const host = req.headers.get('host') || '';
  return !origin || origin.endsWith('//' + host) || origin.includes('cansearcher.com') || origin.includes('netlify.app') || origin.startsWith('http://localhost');
}
// ---- end helpers ----

const SYSTEM = `You read a cancer patient's own description of their diagnosis, or a photo of a diagnosis note, and work out what to search for on ClinicalTrials.gov.
Reply with JSON only: {"condition": "<short English condition name, e.g. Triple Negative Breast Cancer>", "stage": "new" | "adv" | "unsure"}.
"adv" means the text says the cancer came back, recurred, spread or is metastatic or stage 4. "new" means it clearly has not spread. Otherwise "unsure".
If you cannot tell the cancer type, use "condition": null. Do not include names, dates of birth or any other personal details.`;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!sameSite(req)) return json({ error: 'origin' }, 403);
  let body; try { body = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const text = String(body.text || '').slice(0, 600);
  const img = body.image && typeof body.image.data === 'string' && body.image.data.length < 6_000_000 ? body.image : null;
  if (!text && !img) return json({ condition: null, stage: 'unsure' });
  const content = [];
  if (img) content.push({ type: 'image', source: { type: 'base64', media_type: /^image\/(png|jpeg|gif|webp)$/.test(img.media_type) ? img.media_type : 'image/jpeg', data: img.data } });
  content.push({ type: 'text', text: text ? `Patient's description: "${text}"` : 'See the photo of the diagnosis note.' });
  try {
    const out = parseJSON(await askClaude({ system: SYSTEM, content, maxTokens: 120 }));
    const condition = out && typeof out.condition === 'string' ? out.condition.slice(0, 80) : null;
    const stage = ['new', 'adv', 'unsure'].includes(out && out.stage) ? out.stage : 'unsure';
    return json({ condition, stage });
  } catch (e) {
    return json({ error: e.code || 'ai_error' }, e.code === 'no_key' ? 503 : 502);
  }
};

export const config = { path: '/api/interpret' };
