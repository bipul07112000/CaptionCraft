// Netlify serverless function: calls the Gemini API so your key stays secret.
// Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in Netlify: Site configuration > Environment variables.
const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

// Models are tried in this order. If one is busy, over quota, or not available to your key, the next one is used automatically.
// Override with GEMINI_MODELS="model-a,model-b,..." (comma-separated), or put one first with GEMINI_MODEL.
const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-4-argon'];
function modelList() {
  const env = (process.env.GEMINI_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  const list = env.length ? env : [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL].filter(Boolean).concat(DEFAULT_MODELS);
  return [...new Set(list)];
}
// Returns { r, model } on success (or a non-retryable error), or { r: null, status, message, tried } if every model failed.
async function callGemini(KEY, body, budgetMs) {
  const start = Date.now(), tried = [];
  let status = 503, message = '';
  for (const m of modelList()) {
    if (tried.length && Date.now() - start > budgetMs) break;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body
      });
      // 404 not available, 403 no access, 429 quota, 5xx busy -> try the next model
      if (r.status === 404 || r.status === 403 || r.status === 429 || r.status >= 500) {
        const d = await r.json().catch(() => ({}));
        tried.push(m + ': ' + r.status); status = r.status; message = d.error?.message || '';
        continue;
      }
      return { r, model: m };
    } catch (e) { tried.push(m + ': ' + e.message); }
  }
  return { r: null, status, message: 'All AI models are busy or at their limit right now. Please try again shortly.', tried, detail: message };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const KEY = process.env.GEMINI_API_KEY;
    if (!KEY) return json(500, { error: 'GEMINI_API_KEY is not set' });

    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
    const { prompt, image } = JSON.parse(raw || '{}');
    if (!prompt) return json(400, { error: 'Missing prompt' });

    const parts = [];
    if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: String(image).split(',')[1] } });
    parts.push({ text: String(prompt).slice(0, 4000) });

    const g = await callGemini(KEY, JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.9 }
      }), 8000); // Netlify stops functions after ~10s
    if (!g.r) return json(g.status, { error: g.message + ' [tried: ' + g.tried.join(', ') + ']' });
    const r = g.r;
    const data = await r.json();
    if (!r.ok) return json(r.status, { error: (data.error?.message || 'Gemini API error') + ' [' + r.status + ', model: ' + g.model + ']' });

    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
      .replace(/```json|```/g, '').trim();
    if (!text) return json(502, { error: data.promptFeedback?.blockReason ? 'Blocked: ' + data.promptFeedback.blockReason : 'Empty response from Gemini' });
    return json(200, Object.assign(JSON.parse(text), { _model: g.model }));
  } catch (e) {
    return json(500, { error: e.message });
  }
};
