// App shell: boot, router, navigation, dashboard, market, listings, deals list.
import { api } from './api.js';
import { S, go, isBuyer, isSeller, canTrade } from './state.js';
import { DISTRICTS, ROLE_LABEL, makeForm, STATUS, PAYSTATUS, formSheet, getPosition, html, icon, litres, fmtDate, fmtDay, pill, raw, rwf, setHtml, sg, toast } from './ui.js';
import * as deal from './deal.js';
import * as misc from './misc.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');

// ---------- navigation ----------
function navItems() {
  const r = S.user.role;
  if (r === 'driver') return [['#/dashboard', 'home', 'Home'], ['#/jobs', 'truck', 'Jobs'], ['#/deals', 'deals', 'My deals'], ['#/me', 'user', 'Me']];
  if (r === 'admin') return [['#/dashboard', 'home', 'Home'], ['#/admin', 'shield', 'Admin'], ['#/deals', 'deals', 'Deals'], ['#/disputes', 'alert', 'Disputes'], ['#/me', 'user', 'Me']];
  return [['#/dashboard', 'home', 'Home'], ['#/market', 'market', 'Market'], ['#/deals', 'deals', 'Deals'], ['#/disputes', 'alert', 'Disputes'], ['#/me', 'user', 'Me']];
}
function drawNav() {
  const cur = location.hash || '#/dashboard';
  setHtml(nav, html`${navItems().map(([h, ic, label]) => html`<a href="${h}" class="${cur.startsWith(h) || (h === '#/deals' && cur.startsWith('#/transaction')) || (h === '#/disputes' && cur.startsWith('#/dispute')) ? 'active' : ''}">${icon(ic)}<span>${label}</span></a>`)}`);
}

// ---------- router ----------
const routes = [
  [/^#\/dashboard$/, dashboardView], [/^#\/market$/, marketView], [/^#\/listing\/new$/, newListingView], [/^#\/listing\/(L-[0-9A-F]+)$/, listingView],
  [/^#\/deals$/, dealsView], [/^#\/transaction\/(AS-[0-9A-F]+)(?:\/(\w+))?$/, (id, tab) => deal.dealView(main, id, tab)],
  [/^#\/jobs$/, () => misc.jobsView(main)], [/^#\/disputes$/, () => misc.disputesView(main)], [/^#\/dispute\/(D-[0-9A-F]+)$/, (id) => misc.disputeView(main, id)],
  [/^#\/me$/, () => misc.profileView(main)], [/^#\/admin$/, () => misc.adminView(main)], [/^#\/notifications$/, () => misc.notificationsView(main)],
];

async function render() {
  S.timers.splice(0).forEach(clearInterval);
  const hash = location.hash || '#/dashboard';
  drawNav();
  window.scrollTo(0, 0);
  setHtml(main, html`<div class="spinner" role="status" aria-label="Loading"></div>`);
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await fn(...m.slice(1)); }
      catch (e) { setHtml(main, html`<div class="card"><h3>Something went wrong</h3><div class="err">${e.message}</div><button class="btn" data-act="reload">Try again</button></div>`); }
      return;
    }
  }
  go('#/dashboard');
}
S.rerender = render;

// ---------- global click handling (one listener for every data-act button) ----------
const ACTIONS = { reload: () => render(), ...deal.actions, ...misc.actions, marketTab, marketFilter, bookListing, cancelListing, listingFilterDeals, logout };
document.addEventListener('change', async (e) => {          // <select data-act=...> fires on change, not click
  const el = e.target.closest('select[data-act]');
  if (el && ACTIONS[el.dataset.act]) { try { await ACTIONS[el.dataset.act](el); } catch (err) { toast(err.message, true); } }
});
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || !ACTIONS[el.dataset.act]) return;
  e.preventDefault();
  try { await ACTIONS[el.dataset.act](el); } catch (err) { toast(err.message, true); }
});

async function logout() { await api.post('/auth/logout'); location.href = '/login.html'; }

// ---------- dashboard ----------
async function dashboardView() {
  const d = await api.get('/dashboard');
  const s = d.stats;
  const role = S.user.role;
  const quick = canTrade()
    ? html`<div class="btn-row">${isSeller() ? html`<a class="btn gold" href="#/listing/new">${icon('plus', 'sm')} Sell milk</a>` : ''}${isBuyer() ? html`<a class="btn gold" href="#/market">${icon('market', 'sm')} Find milk</a>` : html`<a class="btn light" href="#/market">Buy requests</a>`}</div>`
    : role === 'driver' ? html`<a class="btn gold block" href="#/jobs">${icon('truck', 'sm')} Find delivery jobs (${d.driver.open_jobs})</a>` : '';
  setHtml(main, html`
    <div class="hero"><h1>Hello, ${d.name.split(' ')[0]}</h1><p>${ROLE_LABEL[role]}${S.user.is_verified ? ' - verified' : ''} - ${S.user.district || 'Rwanda'}</p>${quick}</div>
    ${d.todo.length ? html`<div class="card"><h3>${icon('clock')} Needs your attention</h3>${d.todo.map((t) => html`<a class="list-item" href="${t.tx ? '#/transaction/' + t.tx : '#/deals'}">${t.text}</a>`)}</div>` : ''}
    ${d.admin ? html`<div class="grid2">${Object.entries(d.admin).map(([k, v]) => html`<div class="stat navy"><b>${v}</b><span>${k.replace(/_/g, ' ')}</span></div>`)}</div><div class="spacer"></div>` : ''}
    <div class="grid2 wide">
      <div class="stat"><b>${s.active}</b><span>Active deals</span></div>
      <div class="stat gold"><b>${s.pending_acceptance}</b><span>Waiting for my acceptance</span></div>
      <div class="stat"><b>${s.pending_delivery}</b><span>Pickup / on the way</span></div>
      <div class="stat gold"><b>${s.payments_unconfirmed}</b><span>Payments unconfirmed</span></div>
      <div class="stat red"><b>${s.disputed}</b><span>Disputes</span></div>
      <div class="stat navy"><b>${s.completed}</b><span>Completed</span></div>
      ${role === 'driver' ? html`<div class="stat"><b>${d.driver.my_active_jobs}</b><span>My active jobs</span></div><div class="stat navy"><b>${d.driver.completed_jobs}</b><span>Jobs completed</span></div>` : html`<div class="stat"><b>${litres(s.completed_litres)}</b><span>Litres completed</span></div><div class="stat navy"><b>${rwf(s.completed_value_rwf)}</b><span>Value completed</span></div>`}
    </div>
    <div class="card mt12"><div class="row between"><h3>Recent deals</h3><a href="#/deals">See all</a></div>
      ${d.recent.length ? d.recent.map(dealRow) : html`<div class="empty">No deals yet. ${canTrade() ? 'Post milk or find a buyer to start.' : ''}</div>`}</div>
    <p class="muted small center">AmataShield records deals and evidence. It does not hold money or certify milk quality.</p>`);
}

export const dealRow = (t) => html`<a class="list-item" href="#/transaction/${t.id}"><div class="row between"><b>${t.id}</b>${pill(STATUS[t.status])}</div>
  <div class="muted small">${t.seller_name} to ${t.buyer_name}</div><div>${litres(t.litres)} at ${rwf(t.price_per_litre)}/L - <b>${rwf(t.total_value)}</b></div>
  ${t.status === 'ACCEPTED' || t.status === 'COMPLETED' ? html`<div class="small">Payment: ${pill(PAYSTATUS[t.payment_status])}</div>` : ''}</a>`;

// ---------- deals list ----------
let dealFilter = '';
async function dealsView() {
  const list = await api.get('/transactions' + (dealFilter ? `?status=${dealFilter}` : ''));
  const chips = [['', 'All'], ['REQUESTED', 'Waiting'], ['AGREED', 'Agreed'], ['IN_TRANSIT', 'On the way'], ['DELIVERED', 'Arrived'], ['ACCEPTED', 'Payment'], ['COMPLETED', 'Completed'], ['DISPUTED', 'Disputed'], ['EXPIRED', 'Expired']];
  setHtml(main, html`<h1>${S.user.role === 'driver' ? 'My deals' : 'Deals'}</h1><div class="chips">${chips.map(([v, l]) => html`<button class="chip ${dealFilter === v ? 'on' : ''}" data-act="listingFilterDeals" data-v="${v}">${l}</button>`)}</div>
    <div class="card">${list.length ? list.map(dealRow) : html`<div class="empty">No deals here yet.</div>`}</div>`);
}
function listingFilterDeals(el) { dealFilter = el.dataset.v; render(); }

// ---------- market ----------
const market = { type: null, filters: {} };
function defaultType() { return isBuyer() && !isSeller() ? 'SELL' : isSeller() && !isBuyer() ? 'BUY' : 'SELL'; }
function marketTab(el) { market.type = el.dataset.type; render(); }

async function marketView() {
  if (S.user.role === 'driver') return go('#/jobs');
  if (!market.type) market.type = defaultType();
  const qs = new URLSearchParams({ type: market.type, ...market.filters });
  const [items, mine] = await Promise.all([api.get('/listings?' + qs), api.get('/listings?mine=1')]);
  const f = market.filters;
  const active = Object.keys(f).length;
  setHtml(main, html`<div class="row between"><h1>Market</h1><a class="btn small gold" href="#/listing/new">${icon('plus', 'sm')} ${market.type === 'SELL' && isSeller() || market.type === 'BUY' && !isBuyer() ? 'Sell milk' : 'Request milk'}</a></div>
    <div class="chips"><button class="chip ${market.type === 'SELL' ? 'on' : ''}" data-act="marketTab" data-type="SELL">Milk for sale</button><button class="chip ${market.type === 'BUY' ? 'on' : ''}" data-act="marketTab" data-type="BUY">Buy requests</button>
      <button class="chip" data-act="marketFilter">${icon('filter', 'sm')} Filter${active ? ` (${active})` : ''}</button></div>
    ${items.length ? items.map(listingCard) : html`<div class="card empty">No matching listings. Try removing filters.</div>`}
    ${mine.length ? html`<h3 class="mt18">My listings</h3>${mine.map(listingCard)}` : ''}`);
}

const listingCard = (l) => html`<a class="card card-link" href="#/listing/${l.id}">
  <div class="row between"><b>${litres(l.litres_remaining)} <span class="muted">of ${litres(l.litres_total)}</span></b><span class="pill ${l.listing_type === 'SELL' ? 'green' : 'gold'}">${l.listing_type === 'SELL' ? 'For sale' : 'Wanted'}</span></div>
  <div class="price">${rwf(l.price_per_litre)}<span class="muted small"> / litre</span></div>
  <div class="muted small">${icon('pin', 'sm')} ${l.location_name}${l.district ? ', ' + l.district : ''}${l.distance_km != null ? ` - ${l.distance_km} km away` : ''}</div>
  <div class="small">${l.owner.name} ${l.owner.is_verified ? pill(['Verified', 'green']) : ''} ${l.mine ? pill(['Mine', '']) : ''} ${l.status !== 'OPEN' ? pill([l.status, 'red']) : ''}</div></a>`;

function marketFilter() {
  const f = market.filters;
  formSheet({
    title: 'Filter listings', submitLabel: 'Apply',
    fields: [
      { name: 'min_litres', label: 'At least how many litres?', type: 'number', min: 0, value: f.min_litres },
      { name: market.type === 'SELL' ? 'max_price' : 'min_price', label: market.type === 'SELL' ? 'Highest price per litre (RWF)' : 'Lowest price per litre (RWF)', type: 'number', min: 0, value: f.max_price ?? f.min_price },
      { name: 'district', label: 'District', type: 'select', options: [{ value: '', label: 'Any district' }, ...DISTRICTS], value: f.district || '' },
      { name: 'sort', label: 'Sort by', type: 'select', value: f.sort || 'newest', options: [{ value: 'newest', label: 'Newest' }, { value: 'price_asc', label: 'Cheapest first' }, { value: 'price_desc', label: 'Highest price first' }, { value: 'litres', label: 'Most litres' }, { value: 'nearest', label: 'Nearest to me' }] },
      { name: 'use_location', label: 'Use my location for distance', type: 'checkbox', value: !!f.near_lat },
    ],
    onSubmit: async (v) => {
      const nf = {};
      for (const k of ['min_litres', 'max_price', 'min_price', 'district', 'sort']) if (v[k] !== null && v[k] !== '' && !(k === 'sort' && v[k] === 'newest')) nf[k] = v[k];
      if (v.use_location || v.sort === 'nearest') { const p = await getPosition(); nf.near_lat = p.latitude; nf.near_lng = p.longitude; }
      market.filters = nf; render();
    },
  });
}

// ---------- listing detail + booking ----------
async function listingView(id) {
  const l = await api.get('/listings/' + id);
  const q = l.quality_requirements;
  const hasQ = q.min_lactometer != null || q.max_lactometer != null || q.max_temperature_c != null;
  setHtml(main, html`<a href="#/market">&larr; Market</a><div class="card mt8">
    <div class="row between"><h2>${l.listing_type === 'SELL' ? 'Milk for sale' : 'Milk wanted'}</h2><span class="pill ${l.status === 'OPEN' ? 'green' : 'red'}">${l.status}</span></div>
    <div class="price big">${rwf(l.price_per_litre)} <span class="muted small">per litre</span></div>
    <dl class="kv"><dt>Available</dt><dd>${litres(l.litres_remaining)} of ${litres(l.litres_total)}</dd><dt>Location</dt><dd>${l.location_name}${l.district ? ', ' + l.district : ''}</dd>
      <dt>From</dt><dd>${fmtDate(l.available_from)}</dd><dt>Until</dt><dd>${l.available_until ? fmtDate(l.available_until) : 'Not set'}</dd>
      <dt>Posted by</dt><dd>${l.owner.name} (${ROLE_LABEL[l.owner.role] || l.owner.role}) ${l.owner.is_verified ? pill(['Verified', 'green']) : ''}</dd>
      <dt>Quality terms</dt><dd>${hasQ ? html`Lactometer ${sg(q.min_lactometer)} to ${sg(q.max_lactometer)}${q.max_temperature_c != null ? `, max ${q.max_temperature_c} C` : ''}` : 'None written'}</dd>
      <dt>Longest trip</dt><dd>${q.max_transit_minutes ? q.max_transit_minutes + ' min from pickup to arrival' : 'Not set'}</dd>
      <dt>Other terms</dt><dd>${l.terms || '-'}</dd></dl>
    ${hasQ ? html`<div class="notice info small">These numbers were written by the person who posted the listing. They are the deal's own agreed range, not a food-safety standard.</div>` : ''}
    ${l.can_book ? html`<button class="btn gold block" data-act="bookListing" data-id="${l.id}" data-max="${l.litres_remaining}" data-type="${l.listing_type}">${l.listing_type === 'SELL' ? 'Book this milk' : 'Offer to supply'}</button>
      <p class="hint center">The other person must confirm within a short time or the booking expires and you can try again.</p>` : ''}
    ${l.mine && l.status === 'OPEN' ? html`<button class="btn ghost block" data-act="cancelListing" data-id="${l.id}">Cancel this listing</button>` : ''}</div>`);
}
function bookListing(el) {
  const max = Number(el.dataset.max), id = el.dataset.id;
  formSheet({
    title: 'How many litres?', submitLabel: 'Send booking', intro: 'Your booking counts as your acceptance of the listed price and terms.',
    fields: [{ name: 'litres', label: 'Litres', type: 'number', required: true, min: 0.5, max, step: '0.5', value: max, inputmode: 'decimal' },
      { name: 'delivery_at', label: 'Preferred pickup time (optional)', type: 'datetime-local' }],
    onSubmit: async (v) => { const tx = await api.post(`/listings/${id}/book`, { litres: v.litres, ...(v.delivery_at ? { delivery_at: v.delivery_at } : {}) }); toast('Booking sent'); go('#/transaction/' + tx.id); },
  });
}
async function cancelListing(el) { await api.post(`/listings/${el.dataset.id}/cancel`); toast('Listing cancelled'); go('#/market'); }

// ---------- new listing ----------
async function newListingView() {
  const types = [...(isSeller() ? [{ value: 'SELL', label: 'I have milk to sell' }] : []), ...(isBuyer() ? [{ value: 'BUY', label: 'I want to buy milk' }] : [])];
  if (!types.length) return go('#/dashboard');
  setHtml(main, html`<a href="#/market">&larr; Market</a><div class="card mt8"><h2>New listing</h2><form id="lform" novalidate><div class="err hidden" data-err></div><button class="btn gold block mt14" type="submit">Post listing</button></form></div>`);
  const form = makeForm([
    { name: 'listing_type', label: 'Type', type: 'select', options: types, value: types[0].value },
    { name: 'litres', label: 'Litres', type: 'number', required: true, min: 1, step: '0.5', inputmode: 'decimal' },
    { name: 'price_per_litre', label: 'Price per litre (RWF)', type: 'number', required: true, min: 1, step: '1', inputmode: 'numeric' },
    { name: 'location_name', label: 'Collection point / place', type: 'text', required: true, placeholder: 'e.g. Mukamira road junction', maxlength: 120 },
    { name: 'district', label: 'District', type: 'select', options: [{ value: '', label: 'Choose district' }, ...DISTRICTS], value: S.user.district || '' },
    { name: 'available_from', label: 'Available from', type: 'datetime-local' },
    { name: 'available_until', label: 'Available until (optional)', type: 'date' },
    { name: 'min_lactometer', label: 'Lowest lactometer reading agreed (optional)', type: 'number', step: '0.001', min: 1, max: 1.1, placeholder: 'e.g. 1.026', hint: 'Both parties decide these numbers. AmataShield only compares readings with them.' },
    { name: 'max_lactometer', label: 'Highest lactometer reading agreed (optional)', type: 'number', step: '0.001', min: 1, max: 1.1, placeholder: 'e.g. 1.034' },
    { name: 'max_temperature_c', label: 'Highest milk temperature in C (optional)', type: 'number', step: '0.5', min: 0, max: 60 },
    { name: 'max_transit_minutes', label: 'Longest trip time allowed, in minutes (optional)', type: 'number', step: '5', min: 10, max: 1440, inputmode: 'numeric', placeholder: 'e.g. 90', hint: 'Milk spoils with time. The app measures pickup-to-arrival and flags trips that run over.' },
    { name: 'terms', label: 'Other terms (optional)', type: 'textarea', placeholder: 'Pickup time, container, payment method...' },
    { name: 'use_gps', label: 'Save my GPS position so buyers can find the nearest milk', type: 'checkbox' },
  ]);
  const formEl = document.getElementById('lform');
  formEl.insertAdjacentHTML('afterbegin', form.html.s);
  form.bind(formEl);
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = formEl.querySelector('[data-err]');
    err.classList.add('hidden');
    if (!formEl.reportValidity()) return;
    try {
      const v = form.values(formEl);
      const body = {};
      for (const [k, val] of Object.entries(v)) if (val !== null && val !== '' && k !== 'use_gps') body[k] = val;
      if (v.use_gps) Object.assign(body, await getPosition());
      const l = await api.post('/listings', body);
      toast('Listing posted'); go('#/listing/' + l.id);
    } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
  });
}

// ---------- boot ----------
async function boot() {
  try { S.user = (await api.get('/auth/me')).user; } catch { return; }
  document.getElementById('shell').classList.remove('hidden');
  window.addEventListener('hashchange', render);
  try { const d = await api.get('/dashboard'); misc.setBell(d.unread_notifications); } catch { /* ignore */ }
  render();
}
boot();
