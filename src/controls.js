// Control panel: builds the UI from a schema and owns the state.
//
// Settings survive a refresh via localStorage; Reset (per section or global)
// snaps back to the schema defaults and drops the stored copy. Stored values are
// re-validated against the schema on load, so a stale store from an older build
// can never brick the panel — anything that doesn't fit is silently dropped.
const STORE_KEY = 'paperimgshuffle.settings.v1';

const listeners = {};
const anyListeners = [];
const state = {};
const defaults = {};
const specs = {};
const els = {};
const sections = [];          // [{ label, keys: [] }]
const extra = {};             // non-schema state (canvas size)
let loading = false;

function readStore(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
let saveTimer = null;
function persist(){
  if (loading) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: state, x: extra })); }
    catch { /* private mode / quota — settings just won't persist */ }
  }, 250);
}
function clearStore(){
  clearTimeout(saveTimer);
  try { localStorage.removeItem(STORE_KEY); } catch {}
}

// A stored value is only accepted if it still fits its spec.
function coerce(spec, v){
  switch (spec.type){
    case 'slider': case 'number':
      // strict: Number(null) is 0 and Number(true) is 1, both of which would
      // sail through a bare isFinite check and silently become real settings
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.max(spec.min, Math.min(spec.max, v));
    case 'toggle':
      return typeof v === 'boolean' ? v : undefined;
    case 'select': case 'segmented':
      return spec.options.some(o => o.id === v) ? v : undefined;
    default:
      return undefined;
  }
}

export function getExtra(k){ return extra[k]; }
export function setExtra(k, v){ extra[k] = v; persist(); }
export function snapshot(){ return { ...state }; }
export function restore(snap){ for (const k in snap) set(k, snap[k]); }

export function get(k){ return state[k]; }
export function set(k, v, silent){
  if (state[k] === v) return;
  state[k] = v;
  if (els[k] && els[k].sync) els[k].sync(v);
  anyListeners.forEach(fn => fn(k, v));
  if (!silent && listeners[k]) listeners[k].forEach(fn => fn(v));
  persist();
}
export function onChange(k, fn){ (listeners[k] ||= []).push(fn); }
// Fires for every control — the render loop uses it to know the frame is stale.
export function onAny(fn){ anyListeners.push(fn); }

// Force a control to an effective value and stop it being edited, without
// destroying what the user had set. Used where one mode makes another control
// meaningless — locking says so out loud instead of silently ignoring it.
export function setLocked(key, on, shown, reason){
  const e = els[key];
  if (e && e.setLocked) e.setLocked(on, shown, reason);
}
export function all(){ return { ...state }; }
// Reset always goes to the schema defaults — the original, very first values —
// never to whatever was last stored.
export function resetAll(){
  clearStore();
  for (const k in defaults) set(k, defaults[k]);
}
export function resetSection(label){
  const sec = sections.find(s => s.label === label);
  if (!sec) return;
  for (const k of sec.keys) set(k, defaults[k]);
}
export function sectionKeys(label){
  const sec = sections.find(s => s.label === label);
  return sec ? sec.keys.slice() : [];
}

const fmt = (v, step) => {
  if (step >= 1) return String(Math.round(v));
  const d = String(step).split('.')[1]?.length || 2;
  return v.toFixed(d);
};

function sliderRow(spec){
  const wrap = document.createElement('div');
  wrap.className = 'row';
  wrap.innerHTML =
    `<div class="slider"><div class="fill"></div>
       <span class="lab">${spec.label}</span><span class="val"></span></div>`;
  const el = wrap.firstElementChild;
  const fill = el.querySelector('.fill');
  const val = el.querySelector('.val');
  const { min, max, step } = spec;

  // A locked control displays the value actually in force, not the stored one.
  // The stored value is untouched, so leaving the locking mode restores it.
  let lockedTo = null;
  const sync = (v) => {
    const d = lockedTo !== null ? lockedTo : v;
    fill.style.width = ((d - min) / (max - min) * 100) + '%';
    val.textContent = fmt(d, step) + (spec.unit || '');
  };
  els[spec.key] = {
    sync,
    setLocked(on, shown, reason){
      lockedTo = on ? shown : null;
      el.classList.toggle('locked', !!on);
      if (on) el.title = reason || ''; else el.removeAttribute('title');
      sync(state[spec.key]);
    }
  };

  // Scrub anywhere on the row — the whole row is the track.
  let dragging = false;
  const fromX = (clientX) => {
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const raw = min + t * (max - min);
    return Math.round(raw / step) * step;
  };
  el.addEventListener('pointerdown', (e) => {
    if (lockedTo !== null) return;
    dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('dragging');
    set(spec.key, fromX(e.clientX));
  });
  el.addEventListener('pointermove', (e) => {
    if (dragging && lockedTo === null) set(spec.key, fromX(e.clientX));
  });
  const end = () => { dragging = false; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return wrap;
}

function numRow(spec){
  const wrap = document.createElement('div');
  wrap.className = 'row';
  wrap.innerHTML = `<div class="num"><label>${spec.label}</label>
    <input type="number" min="${spec.min}" max="${spec.max}" step="${spec.step || 1}"></div>`;
  const input = wrap.querySelector('input');
  let lockedTo = null;
  els[spec.key] = {
    sync: (v) => {
      if (document.activeElement !== input) input.value = lockedTo !== null ? lockedTo : v;
    },
    setLocked(on, shown, reason){
      lockedTo = on ? shown : null;
      input.disabled = !!on;
      wrap.querySelector('.num').classList.toggle('locked', !!on);
      if (on) wrap.querySelector('.num').title = reason || '';
      else wrap.querySelector('.num').removeAttribute('title');
      els[spec.key].sync(state[spec.key]);
    }
  };
  const commit = () => {
    if (lockedTo !== null) return;
    let v = parseFloat(input.value);
    if (!isFinite(v)) v = defaults[spec.key];
    v = Math.max(spec.min, Math.min(spec.max, v));
    input.value = v;
    set(spec.key, v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  return wrap;
}

function togRow(spec){
  const wrap = document.createElement('div');
  wrap.className = 'row';
  wrap.innerHTML = `<label class="tog"><input type="checkbox"><span>${spec.label}</span></label>`;
  const input = wrap.querySelector('input');
  els[spec.key] = { sync: (v) => { input.checked = !!v; } };
  input.addEventListener('change', () => set(spec.key, input.checked));
  return wrap;
}

function segRow(spec){
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const g = spec.options.map(o => `<button data-v="${o.id}">${o.label}</button>`).join('');
  wrap.innerHTML = `<div class="seg"><span>${spec.label}</span><div class="seg-group">${g}</div></div>`;
  const btns = [...wrap.querySelectorAll('button')];
  let lockedTo = null;
  els[spec.key] = {
    sync: (v) => {
      const d = lockedTo !== null ? lockedTo : v;
      btns.forEach(b => b.classList.toggle('on', b.dataset.v === d));
    },
    setLocked(on, shown, reason){
      lockedTo = on ? shown : null;
      const g = wrap.querySelector('.seg');
      g.classList.toggle('locked', !!on);
      if (on) g.title = reason || ''; else g.removeAttribute('title');
      els[spec.key].sync(state[spec.key]);
    }
  };
  btns.forEach(b => b.addEventListener('click', () => {
    if (lockedTo !== null) return;
    set(spec.key, b.dataset.v);
  }));
  return wrap;
}

function selRow(spec){
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const opts = spec.options.map(o => `<option value="${o.id}">${o.label}</option>`).join('');
  wrap.innerHTML = `<div class="sel"><label>${spec.label}</label><select>${opts}</select></div>`;
  const sel = wrap.querySelector('select');
  let lockedTo = null;
  els[spec.key] = {
    sync: (v) => { sel.value = lockedTo !== null ? lockedTo : v; },
    setLocked(on, shown, reason){
      lockedTo = on ? shown : null;
      sel.disabled = !!on;
      wrap.querySelector('.sel').classList.toggle('locked', !!on);
      if (on) wrap.querySelector('.sel').title = reason || '';
      else wrap.querySelector('.sel').removeAttribute('title');
      els[spec.key].sync(state[spec.key]);
    }
  };
  sel.addEventListener('change', () => { if (lockedTo === null) set(spec.key, sel.value); });
  return wrap;
}

function btnRow(spec){
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const b = spec.buttons.map(x =>
    `<button data-k="${x.key}" class="${x.danger ? 'danger' : ''}">${x.label}</button>`).join('');
  wrap.innerHTML = `<div class="btnrow">${b}</div>`;
  wrap.querySelectorAll('button').forEach(btn =>
    btn.addEventListener('click', () => (listeners[btn.dataset.k] || []).forEach(fn => fn())));
  return wrap;
}

function customRow(spec){
  const wrap = document.createElement('div');
  wrap.className = 'row';
  wrap.appendChild(spec.render());
  return wrap;
}

function hintRow(spec){
  const wrap = document.createElement('div');
  wrap.className = 'hint';
  wrap.textContent = spec.text;
  return wrap;
}

const builders = { slider: sliderRow, number: numRow, toggle: togRow,
  segmented: segRow, select: selRow, buttons: btnRow, custom: customRow, hint: hintRow };

export function build(schema, root){
  let body = null, current = null;
  for (const spec of schema){
    if (spec.type === 'section'){
      current = { label: spec.label, keys: [] };
      sections.push(current);
      // `sec` must be a per-iteration binding: a shared outer `let` would leave
      // every header's listener closing over the LAST section, so all of them
      // toggle the same panel.
      const sec = document.createElement('div');
      sec.className = 'section' + (spec.collapsed ? '' : ' open');
      // One button spans the whole row so the entire header is the hit target;
      // the reset floats over it on the right. Splitting the row into separate
      // buttons left dead zones between them.
      sec.innerHTML =
        `<div class="section-head">
           <button class="section-toggle"><span>${spec.label}</span><i class="chev"></i></button>
           <button class="section-reset" title="Reset ${spec.label}" aria-label="Reset ${spec.label}">&#8635;</button>
         </div>
         <div class="section-body"></div>`;
      body = sec.querySelector('.section-body');
      const toggle = sec.querySelector('.section-toggle');
      toggle.setAttribute('aria-expanded', String(!spec.collapsed));
      toggle.addEventListener('click', () => {
        const open = sec.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      const label = spec.label;
      sec.querySelector('.section-reset').addEventListener('click', (e) => {
        e.stopPropagation();
        const before = snapshot();
        resetSection(label);
        resetNotify(label, before);
      });
      root.appendChild(sec);
      continue;
    }
    if (spec.key !== undefined && spec.default !== undefined){
      defaults[spec.key] = spec.default;
      state[spec.key] = spec.default;
      specs[spec.key] = spec;
      if (current) current.keys.push(spec.key);
    }
    const node = (builders[spec.type] || (() => document.createElement('div')))(spec);
    if (spec.cls) node.classList.add(spec.cls);
    (body || root).appendChild(node);
    if (spec.key && els[spec.key]) els[spec.key].sync(state[spec.key]);
  }

  // Apply anything stored from a previous visit. Runs before app.js registers
  // its listeners, which is what we want at boot — nothing to invalidate yet.
  const stored = readStore();
  loading = true;
  for (const k in (stored.v || {})){
    const spec = specs[k];
    if (!spec) continue;
    const v = coerce(spec, stored.v[k]);
    if (v !== undefined) set(k, v);
  }
  Object.assign(extra, stored.x || {});
  loading = false;
}

// Reset is instant and non-blocking, with an undo rather than a confirmation.
let notify = () => {};
export function onReset(fn){ notify = fn; }
function resetNotify(label, before){ notify(label, before); }
