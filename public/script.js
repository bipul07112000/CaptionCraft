const $ = s => document.querySelector(s);
let tab = 'photo', tone = 'Aesthetic', imgDataUrl = null;
const tones = ['Aesthetic','Funny','Inspirational','Professional','Romantic','Witty','Minimal'];
const ideas = ['sunset','travel','food','fitness','nature','fashion','wedding','street','coffee','festival','pets','business'];

$('#tones').innerHTML = tones.map(t => `<button class="chip${t === tone ? ' on' : ''}">${t}</button>`).join('');
$('#tones').onclick = e => {
  if (!e.target.classList.contains('chip')) return;
  tone = e.target.textContent;
  [...$('#tones').children].forEach(c => c.classList.toggle('on', c === e.target));
};
$('#ideas').innerHTML = ideas.map(t => `<button class="chip">${t}</button>`).join('');
$('#ideas').onclick = e => {
  if (!e.target.classList.contains('chip')) return;
  const v = $('#kw').value.trim();
  $('#kw').value = v ? v + ', ' + e.target.textContent : e.target.textContent;
};
$('#tabs').onclick = e => {
  const b = e.target.closest('.tab'); if (!b) return;
  tab = b.dataset.t;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  ['photo','kw','idea'].forEach(k => $('#p-' + k).classList.toggle('hide', k !== tab));
};

// Photo upload: downscale in the browser to keep requests small
const drop = $('#drop'), file = $('#file');
drop.onclick = () => file.click();
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
file.onchange = () => file.files[0] && load(file.files[0]);
function load(f) {
  if (!f.type.startsWith('image/')) return;
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => {
    const m = 1024, s = Math.min(1, m / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    imgDataUrl = c.toDataURL('image/jpeg', 0.82);
    drop.innerHTML = '';
    const p = document.createElement('img'); p.src = url; p.alt = 'Selected photo'; drop.appendChild(p);
  };
  img.src = url;
}

function buildPrompt() {
  const base = `You write social media copy. Platform: ${$('#plat').value}. Language: ${$('#lang').value}. Tone: ${tone}.
Return ONLY JSON: {"captions":[5 distinct captions, varied length, emojis where natural],"hashtags":[20 relevant hashtags without spaces, each starting with #, mixing popular and niche]}.`;
  if (tab === 'photo') return base + `\nWrite them for the attached photo based on what you actually see. Extra context: ${$('#photoNote').value || 'none'}.`;
  if (tab === 'kw') return base + `\nKeywords: ${$('#kw').value}.`;
  return base + `\nPost description: ${$('#idea').value}.`;
}

function fallback() {
  const words = ($('#kw').value || $('#idea').value || $('#photoNote').value || 'moment').toLowerCase()
    .split(/[^a-z0-9\u0980-\u09ff\u0900-\u097f]+/).filter(w => w.length > 2).slice(0, 5);
  const k = words[0] || 'moment';
  const captions = [`Chasing ${k} and good vibes ✨`, `Some days are just made for ${k}.`, `${k[0].toUpperCase() + k.slice(1)} state of mind 🌿`, `Collecting moments, one ${k} at a time.`, `Keep it simple. Keep it ${k}. 💫`];
  const hashtags = [...new Set(words.flatMap(w => ['#' + w, '#' + w + 'lover', '#' + w + 'vibes', '#' + w + 'gram'])
    .concat(['#photooftheday','#instagood','#explore','#love','#trending','#viral','#aesthetic','#dailyinspo']))].slice(0, 20);
  return { captions, hashtags };
}

function show(r) {
  $('#out').classList.remove('hide');
  $('#caps').innerHTML = ''; $('#tags').innerHTML = '';
  (r.captions || []).forEach(t => {
    const d = document.createElement('div'); d.className = 'cap';
    const p = document.createElement('p'); p.textContent = t;
    const b = document.createElement('button'); b.className = 'cp'; b.textContent = 'Copy'; b.onclick = () => cp(t, b);
    d.append(p, b); $('#caps').appendChild(d);
  });
  (r.hashtags || []).forEach(h => {
    h = h.startsWith('#') ? h : '#' + h;
    const b = document.createElement('button'); b.className = 'chip tag'; b.textContent = h; b.onclick = () => cp(h, b);
    $('#tags').appendChild(b);
  });
  $('#out').scrollIntoView({ behavior: 'smooth' });
}

async function cp(t, b) {
  const o = b.textContent;
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (_) {} a.remove(); }
  b.textContent = 'Copied ✓'; setTimeout(() => b.textContent = o, 1200);
}
$('#cpTags').onclick = e => cp([...$('#tags').children].map(c => c.textContent).join(' '), e.target);

$('#go').onclick = async () => {
  const st = $('#status'), btn = $('#go'); st.textContent = '';
  if (tab === 'photo' && !imgDataUrl) { st.textContent = 'Please upload a photo first.'; return; }
  if (tab === 'kw' && !$('#kw').value.trim()) { st.textContent = 'Add at least one keyword.'; return; }
  if (tab === 'idea' && !$('#idea').value.trim()) { st.textContent = 'Describe your post first.'; return; }
  btn.disabled = true; btn.textContent = 'Generating…';
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildPrompt(), image: tab === 'photo' ? imgDataUrl : null })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const out = await res.json(); show(out);
    if (out._model) st.textContent = 'Generated with ' + out._model;
  } catch (e) {
    console.error('Generate error:', e.message);
    const all = /^All AI models/.test(e.message);
    const quota = !all && /quota|429|rate limit|resource.?exhausted/i.test(e.message);
    const busy = !all && /high demand|overloaded|503|unavailable/i.test(e.message);
    const msg = quota ? 'Daily/minute AI limit reached. Wait a bit or check your API plan.'
      : busy ? 'The AI is busy right now, please try again in a moment.'
      : e.message;
    if (tab !== 'photo') { show(fallback()); st.textContent = 'AI is unavailable (' + msg + ') These are simple template suggestions.'; }
    else st.textContent = 'Could not analyse the photo: ' + msg + (msg !== e.message ? ' (' + e.message + ')' : '');
  }
  btn.disabled = false; btn.textContent = '✨ Generate';
};
