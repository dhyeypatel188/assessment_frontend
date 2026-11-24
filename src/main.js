import './style.css';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
// WebSocket base: derived from API_URL when set (production), else current host (dev proxy)
const WS_BASE = API_URL
  ? API_URL.replace(/^http/, 'ws')
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
const $ = (s) => document.querySelector(s);
const recBtn = $('#recBtn'), statusEl = $('#status'), liveEl = $('#live');
const tbody = $('#table tbody'), emptyEl = $('#empty'), table = $('#table');
const dlg = $('#dlg'), dlgText = $('#dlgText'), dlgTitle = $('#dlgTitle');

const PLACEHOLDER = 'Your transcription will appear here as you speak…';

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(API_URL + '/api/transcriptions' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.status === 204 ? null : res.json();
}

/* ---------------- Dashboard (CRUD) ---------------- */
let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadList, 250);
});

async function loadList() {
  const q = $('#search').value.trim();
  const rows = await api(q ? `?q=${encodeURIComponent(q)}` : '');
  tbody.innerHTML = '';
  emptyEl.classList.toggle('hidden', rows.length > 0);
  table.classList.toggle('hidden', rows.length === 0);
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.id}</td><td class="text"></td><td>${new Date(r.created_at).toLocaleString()}</td>
      <td class="actions"><button data-a="edit">Edit</button><button data-a="del" class="danger">Delete</button></td>`;
    tr.querySelector('.text').textContent = r.text; // textContent => no XSS
    tr.querySelector('[data-a=edit]').onclick = () => openDialog('Edit transcription', r.text, (t) => api(`/${r.id}`, { method: 'PUT', body: JSON.stringify({ text: t }) }));
    tr.querySelector('[data-a=del]').onclick = async () => {
      if (confirm(`Delete transcription #${r.id}?`)) { await api(`/${r.id}`, { method: 'DELETE' }); loadList(); }
    };
    tbody.appendChild(tr);
  }
}

$('#addBtn').onclick = () => openDialog('Add transcription', '', (t) => api('', { method: 'POST', body: JSON.stringify({ text: t }) }));

function openDialog(title, value, onSave) {
  dlgTitle.textContent = title;
  dlgText.value = value;
  dlg.returnValue = '';
  dlg.onclose = async () => {
    if (dlg.returnValue === 'ok' && dlgText.value.trim()) {
      try { await onSave(dlgText.value.trim()); loadList(); } catch (e) { alert(e.message); }
    }
  };
  dlg.showModal();
}
$('#dlgCancel').onclick = () => dlg.close('cancel');

/* ---------------- Live transcription ---------------- */
let ws, ctx, stream, node, recording = false;
let wsReady = false;
let pending = []; // audio captured while the Gemini session is still connecting

function setStatus(t) { statusEl.textContent = t; }
function setLive(t) { liveEl.textContent = t || PLACEHOLDER; liveEl.classList.toggle('empty', !t); }

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    return alert('Microphone access denied: ' + e.message);
  }
  setLive(''); setStatus('Connecting…');
  ws = new WebSocket(`${WS_BASE}/ws/transcribe`);
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'ready') {
      wsReady = true;
      setStatus('Listening…');
      for (const chunk of pending) ws.send(chunk); // flush audio captured during connect
      pending = [];
    }
    else if (m.type === 'transcript') setLive(m.full);
    else if (m.type === 'saved') { setStatus(m.record ? `Saved as #${m.record.id}` : 'Nothing to save'); loadList(); }
    else if (m.type === 'error') { setStatus('Error: ' + m.message); stopCapture(); }
  };
  ws.onclose = () => { stopCapture(); if (!/Saved|Nothing|Error/.test(statusEl.textContent)) setStatus('Idle'); };
  ws.onerror = () => setStatus('Connection error');

  recording = true;
  wsReady = false;
  pending = [];
  beginCapture(); // start the mic immediately, in parallel with the server connecting to Gemini
  recBtn.textContent = '■ Stop & save';
  recBtn.classList.add('recording');
}

async function beginCapture() {
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule(import.meta.env.BASE_URL + 'pcm-worklet.js');
  const src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, 'pcm-worklet');
  node.port.onmessage = (e) => {
    if (wsReady && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    else if (pending.length < 600) pending.push(e.data); // cap ~18 s of buffered audio
  };
  src.connect(node);
}

function stopCapture() {
  recording = false;
  recBtn.textContent = '● Start recording';
  recBtn.classList.remove('recording');
  if (node) { node.disconnect(); node = null; }
  if (ctx) { ctx.close(); ctx = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

function stop() {
  setStatus('Finishing…');
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  stopCapture(); // stops mic; socket stays open until the server confirms the save
}

recBtn.onclick = () => (recording ? stop() : start());

loadList().catch((e) => setStatus('Failed to load history: ' + e.message));
