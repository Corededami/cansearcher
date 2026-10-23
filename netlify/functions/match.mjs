// POST /api/match
// The AI reads each nearby trial's eligibility criteria and judges how well it fits the patient's answers.
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

const SYSTEM = `You help cancer patients find clinical trials. You read each trial's official eligibility criteria and compare them with what the patient told us.
Rules:
- Judge only from the patient's answers and the trial text. Never invent facts about the patient.
- "good": nothing in the criteria rules the patient out and the trial is aimed at someone like them.
- "maybe": it could fit, but it depends on details the patient wasn't asked (biomarkers, test results, specific past drugs) or the criteria are unclear.
- "unlikely": the criteria clearly point elsewhere (for example cancer that has spread when theirs has not, or previous treatment when they have had none).
- Never say the patient qualifies or give medical advice. The trial team decides.
- Write for someone with no medical background, at about a 6th-grade reading level, in the requested language.
Reply with JSON only.`;

const STAGE = { new: 'newly diagnosed, has not spread', adv: 'came back or has spread', unsure: 'not sure' };
const TREAT = { none: 'has not had treatment yet', in: 'is in treatment now', done: 'has finished treatment' };

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!sameSite(req)) return json({ error: 'origin' }, 403);
  let body; try { body = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const p = body.patient || {};
  const lang = p.lang === 'es' ? 'Spanish' : 'English';
  const trials = (Array.isArray(body.trials) ? body.trials : []).slice(0, 20).map(t => ({
    id: String(t.id || '').slice(0, 20),
    title: String(t.title || '').slice(0, 300),
    summary: String(t.summary || '').slice(0, 900),
    eligibility: String(t.eligibility || '').slice(0, 2500)
  })).filter(t => t.id);
  if (!trials.length) return json({ results: [] });

  const patient = `Age ${Number(p.age) || 'unknown'}; sex ${p.sex === 'MALE' ? 'male' : 'female'}; cancer: ${String(p.cancer || '').slice(0, 120)}; stage: ${STAGE[p.stage] || 'not sure'}; treatment: ${TREAT[p.treat] || 'not sure'}.`;
  const content = `Patient: ${patient}
Language for "reason" and "plain": ${lang}.

For EACH trial below return an object with:
- "id": the trial id
- "fit": "good", "maybe" or "unlikely"
- "reason": one short sentence (max 22 words) on why, based on the criteria
- "plain": two short sentences: what the study tests, and who it is for

Return a JSON array in the same order.

Trials:
${JSON.stringify(trials)}`;

  try {
    const text = await askClaude({ system: SYSTEM, content, maxTokens: 4000 });
    const arr = parseJSON(text);
    const ok = new Set(trials.map(t => t.id));
    const results = (Array.isArray(arr) ? arr : []).filter(r => r && ok.has(String(r.id))).map(r => ({
      id: String(r.id),
      fit: ['good', 'maybe', 'unlikely'].includes(r.fit) ? r.fit : 'maybe',
      reason: String(r.reason || '').slice(0, 240),
      plain: String(r.plain || '').slice(0, 500)
    }));
    return json({ results });
  } catch (e) {
    return json({ error: e.code || 'ai_error' }, e.code === 'no_key' ? 503 : 502);
  }
};

export const config = { path: '/api/match' };
