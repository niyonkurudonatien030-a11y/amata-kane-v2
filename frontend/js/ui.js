// UI helpers: safe HTML templates, icons, formatting, toasts, bottom sheets and a small form builder.
import { liveCapture, liveCameraSupported } from './camera.js';

// ---- safe templating: every ${value} is HTML-escaped unless it is itself a template made with html`` ----
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v == null || v === false ? '' : esc(v));
export const html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? val(vals[i]) : ''), ''));
export const setHtml = (el, tpl) => { el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); };

// ---- icons (simple line icons) ----
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>', market: '<path d="M4 7h16l-1.5 5H5.5z"/><path d="M5 12v8h14v-8"/><path d="M9 20v-5h6v5"/>',
  deals: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7"/>', bell: '<path d="M6 17V11a6 6 0 1112 0v6l2 2H4z"/><path d="M10 21h4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="14" r="4"/>', truck: '<path d="M2 6h12v10H2zM14 10h4l4 3v3h-8"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  drop: '<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/>', phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', wallet: '<path d="M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M3 7V6a2 2 0 012-2h11"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>', pin: '<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M16 4.5a3.5 3.5 0 010 7M18 14c2.5.6 4 2.4 4 6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>', logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>', filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`);

// ---- formatting ----
export const rwf = (n) => (n == null ? '-' : `${Number(n).toLocaleString('en-US')} RWF`);
export const litres = (n) => (n == null ? '-' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} L`);
export const fmtDate = (s) => (s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
export const fmtDay = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const sg = (n) => (n == null ? '-' : Number(n).toFixed(3));

export const DISTRICTS = ['Gasabo', 'Kicukiro', 'Nyarugenge', 'Burera', 'Gakenke', 'Gicumbi', 'Musanze', 'Rulindo', 'Gisagara', 'Huye', 'Kamonyi', 'Muhanga', 'Nyamagabe', 'Nyanza', 'Nyaruguru', 'Ruhango', 'Bugesera', 'Gatsibo', 'Kayonza', 'Kirehe', 'Ngoma', 'Nyagatare', 'Rwamagana', 'Karongi', 'Ngororero', 'Nyabihu', 'Nyamasheke', 'Rubavu', 'Rusizi', 'Rutsiro'];

export const STATUS = {
  REQUESTED: ['Waiting for confirmation', 'gold'], AGREED: ['Agreed - arrange pickup', 'green'], IN_TRANSIT: ['On the way', 'green'],
  DELIVERED: ['Arrived - buyer to check', 'gold'], ACCEPTED: ['Accepted - payment stage', 'green'], COMPLETED: ['Completed', 'green'],
  DISPUTED: ['Disputed', 'red'], EXPIRED: ['Expired', ''], DECLINED: ['Declined', ''], CANCELLED: ['Cancelled', ''],
};
export const PAYSTATUS = { UNCONFIRMED: ['Unconfirmed', 'gold'], PAYMENT_REPORTED: ['Payment reported', 'gold'], CONFIRMED_BY_BOTH: ['Confirmed by both', 'green'], DISPUTED: ['Disputed', 'red'] };
export const PAYITEM = { REQUESTED: ['Waiting for payment', 'gold'], REPORTED: ['Reported as paid', 'gold'], CONFIRMED: ['Receipt confirmed', 'green'], REJECTED: ['Rejected', 'red'] };
export const RESULT = { WITHIN_AGREED_RANGE: ['Inside agreed range', 'green'], OUTSIDE_AGREED_RANGE: ['Outside agreed range', 'red'], NO_AGREED_RANGE: ['No range agreed', 'gold'], REDO_REQUIRED: ['Redo the photo', 'gold'] };
export const pill = (pair) => html`<span class="pill ${pair[1]}">${pair[0]}</span>`;
export const ROLE_LABEL = { farmer: 'Farmer', buyer: 'Buyer', driver: 'Driver / rider', collector: 'Supplier / collector', coop_admin: 'Cooperative admin', admin: 'System admin' };
export const EVIDENCE_LABEL = { quality_measurement: 'Quality measurement', lactometer_photo: 'Lactometer photo', delivery_photo: 'Delivery photo', collection_receipt: 'Collection-centre receipt', payment_receipt: 'Payment receipt', other_document: 'Other document' };
export const ACTION_LABEL = {
  TX_REQUESTED: 'Booking requested', TX_CONFIRMED: 'Deal confirmed by the other party', TX_EXPIRED: 'Booking expired', TX_DECLINED: 'Booking declined', TX_CANCELLED: 'Deal cancelled',
  TRANSPORT_SELF: 'Self-transport chosen', JOB_POSTED: 'Driver job posted', JOB_APPLICATION: 'Driver applied', JOB_DRIVER_SELECTED: 'Driver chosen', JOB_ACCEPTED: 'Driver accepted', JOB_DRIVER_DECLINED: 'Driver declined', JOB_CANCELLED: 'Job cancelled',
  DRIVER_AT_FARM: 'Driver at the farm', EVIDENCE_ADDED: 'Evidence added', QUALITY_RECORDED: 'Quality check recorded', QUALITY_WAIVED_BY_BUYER: 'Buyer accepted an out-of-range reading',
  DELIVERY_RELEASED: 'Delivery allowed', DELIVERY_ARRIVED: 'Milk arrived', BUYER_ACCEPTED_DELIVERY: 'Buyer accepted the delivery', BUYER_REJECTED_DELIVERY: 'Buyer rejected the delivery',
  PAYMENT_REPORTED: 'Payment reported', PAYMENT_CONFIRMED: 'Payment receipt confirmed', PAYMENT_REJECTED: 'Payment rejected', TX_COMPLETED: 'Deal completed',
  DISPUTE_OPENED: 'Dispute opened', DISPUTE_COMMENT: 'Dispute comment', DISPUTE_PROPOSAL: 'Resolution proposed', DISPUTE_EVIDENCE: 'Dispute evidence attached',
  DISPUTE_PROPOSAL_ACCEPTED: 'Proposal accepted', DISPUTE_PROPOSAL_REJECTED: 'Proposal rejected', DISPUTE_RESOLVED: 'Dispute resolved', DISPUTE_WITHDRAWN: 'Dispute withdrawn',
  AI_EXTRACTION_SUGGESTED: 'AI suggestion created', AI_SUGGESTION_CONFIRMED: 'AI suggestion confirmed by a person', AI_SUGGESTION_REJECTED: 'AI suggestion rejected', AI_SUMMARY_GENERATED: 'AI summary generated',
};

// ---- toast ----
export function toast(message, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' err' : '');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---- forms ----
function fieldHtml(f) {
  const req = f.required ? 'required' : '';
  const hint = f.hint ? html`<div class="hint">${f.hint}</div>` : '';
  if (f.type === 'checkbox') return html`<label class="check"><input type="checkbox" name="${f.name}" ${f.value ? raw('checked') : ''}> <span>${f.label}</span></label>${hint}`;
  let control;
  if (f.type === 'select') {
    const opts = (f.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
    control = html`<select name="${f.name}" ${req}>${opts.map((o) => html`<option value="${o.value}" ${String(o.value) === String(f.value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}</select>`;
  } else if (f.type === 'textarea') {
    control = html`<textarea name="${f.name}" ${req} maxlength="${f.maxlength || 1000}" placeholder="${f.placeholder || ''}">${f.value ?? ''}</textarea>`;
  } else if (f.type === 'photo') {
    control = html`<div class="photo-field" data-photo="${f.name}"><div class="btn-row">
      <button type="button" class="btn ghost small" data-ph="native">${icon('camera', 'sm')} Take photo</button>
      ${liveCameraSupported() ? html`<button type="button" class="btn ghost small" data-ph="live">${icon('camera', 'sm')} Live camera</button>` : ''}
      <button type="button" class="btn ghost small" data-ph="pick">${icon('file', 'sm')} Choose file</button></div>
      <div class="hint" data-ph="label">No file chosen</div><img class="hidden photo-preview" data-ph="preview" alt="Preview" ></div>`;
  } else {
    const attrs = ['min', 'max', 'step', 'placeholder', 'autocomplete', 'inputmode', 'maxlength'].filter((k) => f[k] !== undefined).map((k) => `${k}="${esc(f[k])}"`).join(' ');
    control = html`<input type="${f.type || 'text'}" name="${f.name}" value="${f.value ?? ''}" ${raw(attrs)} ${req}>`;
  }
  return html`<label>${f.label}${f.required ? ' *' : ''}</label>${control}${hint}`;
}

function bindPhoto(box) {
  const mk = (capture) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*,application/pdf'; i.className = 'hidden';
    if (capture) i.setAttribute('capture', 'environment');
    box.appendChild(i);
    i.addEventListener('change', () => i.files[0] && setFile(i.files[0]));
    return i;
  };
  const nativeInput = mk(true), pickInput = mk(false);
  const setFile = (file) => {
    box._file = file;
    box.querySelector('[data-ph="label"]').textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
    const img = box.querySelector('[data-ph="preview"]');
    if (file.type.startsWith('image/')) { img.src = URL.createObjectURL(file); img.classList.remove('hidden'); } else img.classList.add('hidden');
  };
  box.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-ph]')?.dataset.ph;
    if (act === 'native') nativeInput.click();
    if (act === 'pick') pickInput.click();
    if (act === 'live') { try { const f = await liveCapture(); if (f) setFile(f); } catch (err) { toast(err.message, true); } }
  });
}

export function makeForm(fields) {
  return {
    html: html`${fields.map(fieldHtml)}`,
    bind(root) { root.querySelectorAll('[data-photo]').forEach(bindPhoto); },
    values(root) {
      const out = {};
      for (const f of fields) {
        if (f.type === 'photo') { out[f.name] = root.querySelector(`[data-photo="${f.name}"]`)._file || null; continue; }
        const el = root.querySelector(`[name="${f.name}"]`);
        if (!el) continue;
        if (f.type === 'checkbox') out[f.name] = el.checked;
        else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
        else if (f.type === 'datetime-local') out[f.name] = el.value ? new Date(el.value).toISOString() : null;
        else out[f.name] = el.value.trim();
      }
      return out;
    },
    validate(root) {
      for (const f of fields) if (f.type === 'photo' && f.required && !root.querySelector(`[data-photo="${f.name}"]`)._file) return `Please add: ${f.label}`;
      return null;
    },
  };
}

// Bottom sheet containing a form. onSubmit(values) may throw; the message is shown inside the sheet.
export function formSheet({ title, intro, fields, submitLabel = 'Save', danger = false, onSubmit }) {
  const form = makeForm(fields);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  setHtml(overlay, html`<div class="sheet" role="dialog" aria-label="${title}"><h2>${title}</h2>${intro ? html`<p class="muted">${intro}</p>` : ''}
    <form novalidate>${form.html}<div class="err hidden" data-err></div>
    <div class="btn-row mt14"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn ${danger ? 'danger' : ''}">${submitLabel}</button></div></form></div>`);
  document.body.appendChild(overlay);
  const formEl = overlay.querySelector('form');
  form.bind(formEl);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.dataset.close !== undefined) close(); });
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = formEl.querySelector('[data-err]');
    errBox.classList.add('hidden');
    if (!formEl.reportValidity()) return;
    const bad = form.validate(formEl);
    if (bad) { errBox.textContent = bad; errBox.classList.remove('hidden'); return; }
    const btn = formEl.querySelector('button[type=submit]');
    btn.disabled = true;
    try { await onSubmit(form.values(formEl)); close(); }
    catch (err) { errBox.textContent = err.message || 'Something went wrong'; errBox.classList.remove('hidden'); btn.disabled = false; }
  });
  return { close, el: overlay };
}

export function infoSheet(title, bodyTpl) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  setHtml(overlay, html`<div class="sheet"><h2>${title}</h2>${bodyTpl}<button class="btn block mt12" data-close>Close</button></div>`);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.dataset.close !== undefined) overlay.remove(); });
  return overlay;
}

export const confirmSheet = (title, text, label, onYes, danger = false) =>
  formSheet({ title, intro: text, fields: [], submitLabel: label, danger, onSubmit: onYes });

// Contact links use the phone's own apps: call, SMS and WhatsApp need no provider integration.
export function contactLinks(phone) {
  if (!phone) return html`<span class="muted small">Phone hidden until the deal is agreed</span>`;
  const digits = phone.replace(/\D/g, '');
  return html`<div class="btn-row"><a class="btn small ghost" href="tel:${phone}">${icon('phone', 'sm')} Call</a><a class="btn small ghost" href="sms:${phone}">${icon('chat', 'sm')} SMS</a><a class="btn small ghost" href="https://wa.me/${digits}" rel="noopener" target="_blank">WhatsApp</a></div>`;
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: +p.coords.latitude.toFixed(5), longitude: +p.coords.longitude.toFixed(5) }), () => reject(new Error('Location permission denied')), { timeout: 10000 });
  });
}
