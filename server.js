// Minimal Node 18+ server: serves the website and calls the Gemini API so your key stays secret.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY;
// Use ./public if it exists, otherwise the same folder as server.js
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

function readBody(req) {
  return new Promise((ok, no) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 6e6) { req.destroy(); no(new Error('Too large')); } });
    req.on('end', () => ok(d)); req.on('error', no);
  });
}
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
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/generate') {
    try {
      if (!KEY) return send(res, 500, { error: 'GEMINI_API_KEY is not set' });
      const { prompt, image } = JSON.parse(await readBody(req));
      const parts = [];
      if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image.split(',')[1] } });
      parts.push({ text: String(prompt).slice(0, 4000) });
      const g = await callGemini(KEY, JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.9 }
        }), 60000);
      if (!g.r) return send(res, g.status, { error: g.message + ' [tried: ' + g.tried.join(', ') + ']' });
      const r = g.r;
      const data = await r.json();
      if (!r.ok) return send(res, r.status, { error: (data.error?.message || 'Gemini API error') + ' [' + r.status + ', model: ' + g.model + ']' });
      const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
        .replace(/```json|```/g, '').trim();
      if (!text) return send(res, 502, { error: data.promptFeedback?.blockReason ? 'Blocked: ' + data.promptFeedback.blockReason : 'Empty response from Gemini' });
      return send(res, 200, Object.assign(JSON.parse(text), { _model: g.model }));
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const f = path.join(PUB, path.normalize(urlPath));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath + ' (looking in ' + PUB + ')'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(buf);
  });
}).listen(PORT, () => console.log(`CaptionCraft running at http://localhost:${PORT}\nServing files from: ${PUB}`));
