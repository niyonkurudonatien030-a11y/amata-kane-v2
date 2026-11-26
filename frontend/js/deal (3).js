// Deal page: overview, evidence + quality, delivery/job, payment, disputes, timeline; and all deal actions.
import { api } from './api.js';
import { S, go, aiLanguage } from './state.js';
import { ACTION_LABEL, EVIDENCE_LABEL, PAYITEM, PAYSTATUS, RESULT, STATUS, confirmSheet, contactLinks, formSheet, fmtDate, getPosition, html, icon, infoSheet, litres, pill, raw, rwf, setHtml, sg, toast } from './ui.js';

const STEPS = ['REQUESTED', 'AGREED', 'IN_TRANSIT', 'DELIVERED', 'ACCEPTED', 'COMPLETED'];
const BTN = {
  confirm: ['Confirm deal', 'gold'], decline: ['Decline', 'ghost'], cancel: ['Cancel deal', 'ghost'], post_job: ['Hire a driver', 'navy'],
  self_transport: ['I will carry it myself', 'ghost'], driver_arrived_farmer: ["I've arrived at the farm", ''],
  record_pickup_quality: ['Record pickup check', 'gold'], waive_quality: ['Accept this milk anyway', 'ghost'], mark_arrived: ['Mark milk as arrived', ''],
  record_arrival_quality: ['Record arrival check', 'gold'], decide: ['Accept or reject delivery', 'navy'], open_dispute: ['Open a dispute', 'ghost'],
};
const HELP = {
  REQUESTED: 'One party has asked to book. The other party must confirm before the timer ends.',
  AGREED: 'Both parties accepted. Next: arrange who carries the milk, then record the lactometer check at pickup.',
  IN_TRANSIT: 'The pickup check passed (or the buyer accepted it). The carrier marks arrival when the milk reaches the buyer.',
  DELIVERED: 'The buyer checks the milk again (photo + reading), then accepts or rejects it.',
  ACCEPTED: 'Payment stage: the payer reports payment, the receiver confirms receipt. AmataShield does not move money.',
  COMPLETED: 'Everything is confirmed by both sides.', DISPUTED: 'Work through the dispute. Both sides can see all evidence.',
};

export async function dealView(main, id, tab = 'overview') {
  const tx = await api.get('/transactions/' + id);
  const idx = STEPS.indexOf(tx.status);
  const tabs = [['overview', 'Overview'], ['evidence', 'Evidence'], ['delivery', 'Delivery'], ['payment', 'Payment'], ['disputes', 'Disputes'], ['timeline', 'History']];
  const mainActions = tx.actions.filter((a) => BTN[a]);
  const body = { overview, evidence, delivery, payment, disputes, timeline }[tab] || overview;
  setHtml(main, html`<a href="#/deals">&larr; Deals</a>
    <div class="card mt8"><div class="row between"><div><h2>${tx.id}</h2><div class="muted">${litres(tx.litres)} at ${rwf(tx.price_per_litre)}/L = <b>${rwf(tx.total_value)}</b></div></div>${pill(STATUS[tx.status])}</div>
      ${idx >= 0 ? html`<div class="steps">${STEPS.map((s, i) => html`<i class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></i>`)}</div>` : ''}
      <p class="small muted">${HELP[tx.status] || ''}</p>
      ${tx.status === 'REQUESTED' && tx.hold_expires_at ? html`<div class="notice">Time left to confirm: <span class="countdown" data-countdown="${tx.hold_expires_at}">...</span></div>` : ''}
      ${mainActions.length ? html`<div class="btn-row">${mainActions.map((a) => html`<button class="btn ${BTN[a][1]}" data-act="deal" data-do="${a}" data-tx="${tx.id}" data-litres="${tx.litres}">${BTN[a][0]}</button>`)}</div>` : ''}</div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<a class="tab ${k === tab ? 'on' : ''}" href="#/transaction/${tx.id}/${k}" role="tab">${l}</a>`)}</div>
    <div id="tabbody"></div>`);
  setHtml(document.getElementById('tabbody'), await body(tx));
  startCountdown();
}

function startCountdown() {
  const el = document.querySelector('[data-countdown]');
  if (!el) return;
  const end = new Date(el.dataset.countdown).getTime();
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    el.textContent = left > 0 ? `${left}s` : 'expired';
    if (left === 0) { clearInterval(t); setTimeout(() => S.rerender(), 1200); }
  };
  const t = setInterval(tick, 1000); tick();
  S.timers.push(t);
}

const party = (p, label, acceptedAt) => html`<div class="card flat"><div class="row between"><b>${label}</b>${p.is_verified ? pill(['Verified', 'green']) : ''}</div>
  <div>${p.business_name || p.full_name}</div><div class="muted small">${p.full_name} - ${p.district || ''}</div>${contactLinks(p.phone)}
  <div class="small mt6">${acceptedAt ? html`${icon('check', 'sm')} Accepted ${fmtDate(acceptedAt)}` : html`<span class="muted">Not accepted yet</span>`}</div></div>`;

function overview(tx) {
  const q = tx.quality_requirements;
  return html`<div class="grid2">${party(tx.seller, 'Seller', tx.seller_accepted_at)}${party(tx.buyer, 'Buyer', tx.buyer_accepted_at)}</div>
    <div class="card"><h3>Agreement</h3><dl class="kv"><dt>Litres</dt><dd>${litres(tx.litres)}${tx.accepted_litres != null ? ` (accepted ${litres(tx.accepted_litres)})` : ''}</dd>
      <dt>Price</dt><dd>${rwf(tx.price_per_litre)} per litre</dd><dt>Total</dt><dd>${rwf(tx.total_value)}</dd><dt>Collection</dt><dd>${tx.location_name}${tx.district ? ', ' + tx.district : ''}</dd>
      <dt>Pickup time</dt><dd>${fmtDate(tx.delivery_at)}</dd>
      <dt>Quality terms</dt><dd>${q.min_lactometer != null || q.max_lactometer != null || q.max_temperature_c != null ? html`Lactometer ${sg(q.min_lactometer)} to ${sg(q.max_lactometer)}${q.max_temperature_c != null ? `, max ${q.max_temperature_c} C` : ''}` : 'None written'}</dd>
      <dt>Longest trip</dt><dd>${tx.trip.max_transit_minutes ? tx.trip.max_transit_minutes + ' min from pickup to arrival' : 'Not set'}</dd>
      <dt>Other terms</dt><dd>${tx.terms || '-'}</dd><dt>Transport</dt><dd>${{ UNDECIDED: 'Not arranged yet', SELF: 'Carried by a party', DRIVER: 'By hired driver' }[tx.transport_mode]}</dd>
      <dt>Payment</dt><dd>${pill(PAYSTATUS[tx.payment_status])}</dd></dl></div>`;
}

const evCard = (e) => html`<div class="thumb">${e.is_image ? html`<a href="${e.url}" target="_blank" rel="noopener"><img src="${e.url}" alt="${EVIDENCE_LABEL[e.category]}" loading="lazy"></a>` : html`<a class="btn small ghost block" href="${e.url}" target="_blank" rel="noopener">${icon('file', 'sm')} Open file</a>`}
  <div class="meta"><b>${EVIDENCE_LABEL[e.category]}</b><br>${e.submitted_by} (${e.submitted_by_role})<br>${fmtDate(e.created_at)}<br><span class="muted">${e.id} - SHA ${e.sha256.slice(0, 8)}</span>${e.note ? html`<br>${e.note}` : ''}
  ${e.is_image ? html`<br><button class="btn small ghost" data-act="aiAnalyze" data-ev="${e.id}">${icon('spark', 'sm')} AI read</button>` : ''}</div></div>`;

async function evidence(tx) {
  const canAdd = tx.actions.includes('upload_evidence');
  const checks = await api.get(`/transactions/${tx.id}/checks`);
  const pending = tx.ai.filter((a) => a.kind === 'IMAGE_EXTRACTION' && a.status === 'SUGGESTED');
  const done = tx.ai.filter((a) => a.kind === 'IMAGE_EXTRACTION' && a.status === 'CONFIRMED');
  return html`
    <div class="card"><h3>${icon('drop')} Lactometer and quality checks</h3>
      ${tx.quality_checks.length ? tx.quality_checks.map((c) => html`<div class="list-item"><div class="row between"><b>${c.stage === 'PICKUP' ? 'Pickup' : 'Arrival'} check</b>${pill(RESULT[c.result])}</div>
        <div>Reading <b>${sg(c.reading_sg)}</b>${c.temperature_c != null ? ` at ${c.temperature_c} C` : ''} - by ${c.tester_name || c.recorded_by}</div>
        <div class="small muted">${c.result_detail}${c.waived ? ' Buyer accepted it anyway: ' + c.waiver_note : ''}</div><div class="small muted">${fmtDate(c.created_at)}</div></div>`) : html`<div class="empty">No quality check recorded yet.</div>`}
      <div class="notice info small">A reading is compared only with the range the parties wrote in their own deal. It is not a safety certificate, and a photo cannot prove milk is unadulterated.</div></div>
    <div class="card"><div class="row between"><h3>${icon('camera')} Evidence (${tx.evidence.length})</h3>${canAdd ? html`<button class="btn small gold" data-act="deal" data-do="upload_evidence" data-tx="${tx.id}">${icon('plus', 'sm')} Add</button>` : ''}</div>
      ${tx.evidence.length ? html`<div class="thumbs">${tx.evidence.map(evCard)}</div>` : html`<div class="empty">No files yet. Both parties can add photos and documents. Originals are never edited or deleted.</div>`}</div>
    ${pending.length ? html`<div class="card"><h3>${icon('spark')} AI suggestions waiting for a person</h3>${pending.map((a) => html`<div class="list-item"><div class="small">For ${a.evidence_id}</div><div class="btn-row"><button class="btn small" data-act="aiReview" data-ai="${a.id}">Review and confirm</button><button class="btn small ghost" data-act="aiReject" data-ai="${a.id}">Reject</button></div></div>`)}</div>` : ''}
    ${done.length ? html`<div class="card"><h3>Confirmed AI-assisted readings</h3>${done.map((a) => html`<div class="list-item small">${a.evidence_id}: ${Object.entries(a.confirmed || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}</div>`)}</div>` : ''}
    <div class="card"><div class="row between"><h3>${icon('shield')} Consistency checks</h3>${tx.actions.includes('ai_summary') ? html`<button class="btn small navy" data-act="aiSummary" data-tx="${tx.id}">${icon('spark', 'sm')} AI summary</button>` : ''}</div>
      ${checks.findings.length ? checks.findings.map((f) => html`<div class="notice ${f.severity === 'info' ? 'info' : ''} small">${f.message}</div>`) : html`<div class="notice ok small">No issues found by the automatic checks. These checks are simple rules, not proof of anything.</div>`}</div>`;
}

const navLink = (p, mode) => (p.latitude == null ? '' : html`<a class="btn small ghost" href="https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}&travelmode=${mode}" target="_blank" rel="noopener">${icon('pin', 'sm')} Navigate to ${p.name || 'place'}</a>`);

function estimateLine(e, title, max) {
  if (!e) return '';
  const lim = e.leg === 'TO_DROPOFF' && max ? (e.personal_minutes <= max ? pill(['Inside the agreed limit', 'green']) : pill(['Longer than the agreed limit', 'red'])) : '';
  return html`<div class="list-item"><div class="row between"><b>${title}</b>${lim}</div>
    <div class="price">${e.personal_minutes} min <span class="muted small">for you (${e.distance_km} km)</span></div>
    <div class="small">Maps baseline: ${e.maps_minutes} min${e.personal_factor !== 1 ? html` x your pace ${e.personal_factor} (from ${e.trips_used} past trips)` : e.trips_used != null ? html` - personal pace starts after 3 trips (${e.trips_used} so far)` : ''}</div>
    ${e.expected_arrival_at ? html`<div class="small">Expected arrival: ${fmtDate(e.expected_arrival_at)}</div>` : ''}${e.actual_minutes != null ? html`<div class="small"><b>Actual: ${e.actual_minutes} min</b></div>` : ''}
    <div class="small muted">${e.label} - ${fmtDate(e.created_at)}</div></div>`;
}

function tripCard(tx) {
  const t = tx.trip, mode = tx.job && tx.job.driver && /bicycle/i.test(tx.job.driver.vehicle_type || '') ? 'bicycling' : 'driving';
  const can = tx.actions.includes('trip_eta');
  return html`<div class="card"><h3>${icon('clock')} Trip time and spoilage window</h3>
    <dl class="kv"><dt>Longest trip</dt><dd>${t.max_transit_minutes ? t.max_transit_minutes + ' min' : 'Not agreed'}</dd><dt>Pickup</dt><dd>${t.pickup.name || '-'}${t.pickup.latitude == null ? ' (no GPS yet)' : ''}</dd>
      <dt>Drop-off</dt><dd>${t.dropoff.name || '-'}${t.dropoff.latitude == null ? ' (no GPS yet)' : ''}</dd>
      ${t.pickup_at ? html`<dt>Left the farm</dt><dd>${fmtDate(t.pickup_at)}</dd>` : ''}${t.arrived_at ? html`<dt>Arrived</dt><dd>${fmtDate(t.arrived_at)}</dd>` : ''}
      ${t.actual_minutes != null ? html`<dt>Trip took</dt><dd>${t.actual_minutes} min ${t.within_limit === null ? '' : t.within_limit ? pill(['inside limit', 'green']) : pill(['over limit', 'red'])}</dd>` : ''}
      ${t.deadline_at ? html`<dt>Must arrive by</dt><dd>${fmtDate(t.deadline_at)}</dd>` : ''}</dl>
    ${estimateLine(t.estimates.TO_PICKUP, 'Time to the pickup point', null)}${estimateLine(t.estimates.TO_DROPOFF, 'Trip time to the drop-off', t.max_transit_minutes)}
    <div class="btn-row">${can ? html`<button class="btn small gold" data-act="deal" data-do="trip_eta" data-tx="${tx.id}" data-leg="TO_PICKUP">Time from my location to pickup</button><button class="btn small" data-act="deal" data-do="trip_eta" data-tx="${tx.id}" data-leg="TO_DROPOFF">Trip time to drop-off</button>` : ''}
      ${tx.actions.includes('set_dropoff') ? html`<button class="btn small ghost" data-act="deal" data-do="set_dropoff" data-tx="${tx.id}">Set drop-off place</button>` : ''}</div>
    <div class="btn-row mt8">${navLink(t.pickup, mode)}${navLink(t.dropoff, mode)}</div>
    <div class="notice info small">Times come from Google Maps when the server has a key, otherwise a rough estimate. Real pace differs from Maps, so after 3 finished trips the app adjusts the time to the carrier's own pace. The trip time is recorded on arrival and can be checked in a dispute.</div></div>`;
}

function delivery(tx) {
  const j = tx.job;
  return html`${tripCard(tx)}<div class="card"><h3>${icon('truck')} Transport</h3><p>${{ UNDECIDED: 'Transport is not arranged yet.', SELF: 'A party carries the milk themselves.', DRIVER: 'A driver is hired through the app.' }[tx.transport_mode]}</p>
    ${j ? html`<dl class="kv"><dt>Job</dt><dd>${j.id} - ${pill([j.status, j.status === 'ACCEPTED' || j.status === 'COMPLETED' ? 'green' : 'gold'])}</dd><dt>Offered wage</dt><dd>${rwf(j.wage_rwf)}</dd>
      ${j.agreed_wage_rwf != null ? html`<dt>Agreed wage</dt><dd>${rwf(j.agreed_wage_rwf)}</dd>` : ''}<dt>Contact via</dt><dd>${j.contact_method}</dd><dt>Stage</dt><dd>${j.stage.replace('_', ' ').toLowerCase()}</dd>
      ${j.vehicle_pref ? html`<dt>Vehicle</dt><dd>${j.vehicle_pref}</dd>` : ''}${j.notes ? html`<dt>Notes</dt><dd>${j.notes}</dd>` : ''}</dl>
      ${j.driver ? html`<div class="card flat"><b>Driver: ${j.driver.full_name}</b> ${j.driver.vehicle_type ? '(' + j.driver.vehicle_type + ')' : ''}${contactLinks(j.driver.phone)}</div>` : ''}
      ${j.applications && j.status === 'OPEN' ? html`<h3>Applicants (${j.applications.length})</h3>${j.applications.filter((a) => a.status === 'APPLIED').map((a) => html`<div class="list-item"><div class="row between"><b>${a.driver.full_name}</b><span>${rwf(a.proposed_wage_rwf)}</span></div>
        <div class="small muted">${a.driver.vehicle_type || 'vehicle not given'} - ${a.driver.district || ''} ${a.driver.is_verified ? '- verified' : ''}</div>${a.message ? html`<div class="small">${a.message}</div>` : ''}
        ${j.actions.includes('select_driver') ? html`<button class="btn small gold" data-act="job" data-do="select" data-id="${j.id}" data-app="${a.application_id}">Choose this driver</button>` : ''}</div>`)}
        ${j.applications.length === 0 ? html`<div class="empty">Waiting for drivers to apply. Drivers in the pickup district are notified in the app.</div>` : ''}` : ''}
      <div class="btn-row">${j.actions.filter((a) => a !== 'select_driver').map((a) => html`<button class="btn small ${a === 'accept_job' ? 'gold' : 'ghost'}" data-act="job" data-do="${a}" data-id="${j.id}">${{ accept_job: 'Accept job', decline_job: 'Decline', cancel_job: 'Cancel job' }[a]}</button>`)}</div>` : ''}
    <div class="notice info small">Contacting a driver: phone numbers appear after a driver accepts. You can then call, SMS or WhatsApp from this page. The app does not send SMS by itself yet.</div></div>`;
}

function payment(tx) {
  if (!tx.payments.length) return html`<div class="card"><h3>${icon('wallet')} Payment</h3><div class="empty">Payment tracking starts after the buyer accepts the delivery.</div>
    <div class="notice info small">AmataShield records who says they paid and who confirms receiving the money. It never holds or sends money.</div></div>`;
  return html`<div class="notice info small">AmataShield records statements about payments. It does not move money, and a screenshot is not proof that money arrived. The receiver should check their own balance before confirming.</div>
    ${tx.payments.map((p) => html`<div class="card"><div class="row between"><h3>${p.purpose === 'MILK' ? 'Milk payment' : 'Driver wage'}</h3>${pill(PAYITEM[p.status])}</div>
      <dl class="kv"><dt>From</dt><dd>${p.payer}${p.i_am_payer ? ' (you)' : ''}</dd><dt>To</dt><dd>${p.payee}${p.i_am_payee ? ' (you)' : ''}</dd><dt>Amount due</dt><dd>${rwf(p.amount_due_rwf)}</dd>
      ${p.amount_reported_rwf != null ? html`<dt>Reported</dt><dd>${rwf(p.amount_reported_rwf)} via ${p.method_type}${p.method_detail ? ' ' + p.method_detail : ''}</dd><dt>Reference</dt><dd>${p.reference}</dd><dt>Reported at</dt><dd>${fmtDate(p.reported_at)}</dd>` : ''}
      ${p.proof_evidence_id ? html`<dt>Proof file</dt><dd>${p.proof_evidence_id}</dd>` : ''}${p.rejection_reason ? html`<dt>Rejected because</dt><dd>${p.rejection_reason}</dd>` : ''}</dl>
      ${p.payee_methods ? html`<h3>Receiver's payment options</h3>${p.payee_methods.length ? p.payee_methods.map((m) => html`<div class="list-item small"><b>${m.label}</b> (${m.method_type.replace('_', ' ')}): ${m.account_value}</div>`) : html`<div class="small muted">The receiver has not listed payment methods. Ask them directly.</div>`}` : ''}
      <div class="btn-row">${p.actions.map((a) => html`<button class="btn ${a === 'confirm' ? 'gold' : a === 'reject' ? 'danger' : ''}" data-act="pay" data-do="${a}" data-id="${p.id}" data-due="${p.amount_due_rwf}" data-tx="${tx.id}">${{ report: 'I have paid - report it', confirm: 'I received it - confirm', reject: 'Not received - reject' }[a]}</button>`)}</div></div>`)}`;
}

function disputes(tx) {
  return html`<div class="card"><h3>${icon('alert')} Disputes</h3>${tx.disputes.length ? tx.disputes.map((d) => html`<a class="list-item" href="#/dispute/${d.id}"><div class="row between"><b>${d.id} - ${d.category}</b>${pill([d.status, d.status === 'OPEN' ? 'red' : 'green'])}</div></a>`) : html`<div class="empty">No disputes.</div>`}
    ${tx.actions.includes('open_dispute') ? html`<button class="btn ghost block" data-act="deal" data-do="open_dispute" data-tx="${tx.id}">Open a dispute</button>` : ''}</div>`;
}

function timeline(tx) {
  return html`<div class="card"><h3>${icon('clock')} History</h3><p class="small muted">Every step is recorded with a time. Records are chained with hashes so changes to old entries can be detected.</p>
    <ul class="timeline">${tx.timeline.map((e) => html`<li><b>${ACTION_LABEL[e.action] || e.action}</b><div class="small muted">${e.actor}${e.actor_role ? ' (' + e.actor_role + ')' : ''} - ${fmtDate(e.at)}</div></li>`)}</ul></div>`;
}

// ---------- actions ----------
const refresh = () => S.rerender();
const post = async (path, body) => { const r = await api.post(path, body); refresh(); return r; };

async function uploadEvidence(txId, v, category) {
  const fd = new FormData();
  fd.append('file', v.photo); fd.append('category', category); fd.append('captured_at', new Date().toISOString());
  if (v.note) fd.append('note', v.note);
  if (v.use_gps) { const p = await getPosition(); fd.append('latitude', p.latitude); fd.append('longitude', p.longitude); }
  return api.upload(`/transactions/${txId}/evidence`, fd);
}

function qualitySheet(txId, stage) {
  let evId = null;   // reuse the uploaded photo if the form must be corrected and sent again
  formSheet({
    title: stage === 'PICKUP' ? 'Pickup lactometer check' : 'Arrival lactometer check', submitLabel: 'Save check',
    intro: 'Photograph the whole lactometer scale (avoid glare), then type the number you read. If the photo is blurry, untick the box and retake it.',
    fields: [
      { name: 'photo', label: 'Lactometer photo', type: 'photo', required: true },
      { name: 'photo_legible', label: 'The scale and liquid level are clearly visible in my photo', type: 'checkbox', value: true },
      { name: 'reading_sg', label: 'Reading (e.g. 1.029, or 29 on the scale = 1.029)', type: 'number', step: '0.001', min: 0.9, max: 1.2, inputmode: 'decimal', placeholder: '1.029' },
      { name: 'temperature_c', label: 'Milk temperature in C (if measured)', type: 'number', step: '0.5', inputmode: 'decimal' },
      { name: 'use_gps', label: 'Attach my GPS location to the photo', type: 'checkbox' },
    ],
    onSubmit: async (v) => {
      if (v.reading_sg && v.reading_sg > 2) v.reading_sg = 1 + v.reading_sg / 1000;   // "29" -> 1.029
      if (!evId) evId = (await uploadEvidence(txId, v, 'lactometer_photo')).id;
      const r = await api.post(`/transactions/${txId}/quality`, { stage, evidence_id: evId, reading_sg: v.reading_sg ?? undefined, temperature_c: v.temperature_c ?? undefined, photo_legible: v.photo_legible });
      toast(r.result_detail, r.result === 'OUTSIDE_AGREED_RANGE'); refresh();
    },
  });
}

const dealActions = {
  confirm: (id) => post(`/transactions/${id}/confirm`).then(() => toast('Deal confirmed')),
  decline: (id) => formSheet({ title: 'Decline this booking?', submitLabel: 'Decline', danger: true, fields: [{ name: 'reason', label: 'Reason (optional)', type: 'text' }], onSubmit: (v) => post(`/transactions/${id}/decline`, v) }),
  cancel: (id) => formSheet({ title: 'Cancel this deal?', submitLabel: 'Cancel deal', danger: true, fields: [{ name: 'reason', label: 'Reason', type: 'text', required: true }], onSubmit: (v) => post(`/transactions/${id}/cancel`, v) }),
  self_transport: (id) => confirmSheet('Carry the milk yourself?', 'You become the carrier: you record the pickup check or mark arrival yourself.', 'Yes, I will', () => post(`/transactions/${id}/transport/self`)),
  post_job: (id) => formSheet({
    title: 'Hire a driver', submitLabel: 'Post job', intro: 'Drivers and riders apply with their wage. You choose one, and they accept before anything starts.',
    fields: [{ name: 'wage_rwf', label: 'Wage you offer (RWF)', type: 'number', required: true, min: 0, inputmode: 'numeric' },
      { name: 'contact_method', label: 'How should the driver reach you?', type: 'select', options: [{ value: 'app', label: 'In the app' }, { value: 'phone', label: 'Phone call' }, { value: 'sms', label: 'SMS' }, { value: 'whatsapp', label: 'WhatsApp' }] },
      { name: 'vehicle_pref', label: 'Vehicle (optional)', type: 'select', options: [{ value: '', label: 'Any' }, 'bicycle', 'motorcycle', 'car', 'truck'] },
      { name: 'dropoff_name', label: 'Drop-off place (optional)', type: 'text' }, { name: 'notes', label: 'Notes (optional)', type: 'textarea' }],
    onSubmit: (v) => post(`/transactions/${id}/job`, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== null))).then(() => { toast('Job posted'); go(`#/transaction/${id}/delivery`); }),
  }),
  driver_arrived_farmer: (id) => post(`/transactions/${id}/driver-arrived`).then(() => toast('The seller was told you arrived')),
  trip_eta: async (id, el) => {
    const leg = el.dataset.leg;
    const body = { leg };
    if (leg === 'TO_PICKUP' || location.hash.includes('/delivery')) { try { Object.assign(body, await getPosition()); } catch (e) { if (leg === 'TO_PICKUP') throw e; } }
    toast('Getting the time...');
    const e = await api.post(`/transactions/${id}/eta`, body);
    infoSheet(leg === 'TO_PICKUP' ? 'Time to the pickup point' : 'Trip time to the drop-off', html`<div class="price big">${e.personal_minutes} min</div>
      <p>Distance ${e.distance_km} km. Maps baseline ${e.maps_minutes} min${e.personal_factor !== 1 ? `, adjusted by your pace x${e.personal_factor}` : ''}.</p>
      ${e.expected_arrival_at ? html`<p>Expected arrival ${fmtDate(e.expected_arrival_at)}</p>` : ''}
      ${e.within_limit === false ? html`<div class="notice">This is longer than the agreed ${e.max_transit_minutes} minutes. Tell the other party early, or agree on a change.</div>` : ''}
      <div class="notice info small">${e.label}${e.cached ? ' (reused from a minute ago)' : ''}.</div>`);
    refresh();
  },
  set_dropoff: (id) => formSheet({ title: 'Set the drop-off place', submitLabel: 'Save drop-off', intro: 'Stand at the place where the milk should be delivered. Your phone position is saved as the drop-off point so drivers get an accurate time.',
    fields: [{ name: 'name', label: 'Place name', type: 'text', placeholder: 'e.g. Kimironko plant gate' }],
    onSubmit: async (v) => { const p = await getPosition(); await api.put(`/transactions/${id}/dropoff`, { name: v.name || undefined, ...p }); toast('Drop-off saved'); refresh(); } }),
  record_pickup_quality: (id) => qualitySheet(id, 'PICKUP'),
  record_arrival_quality: (id) => qualitySheet(id, 'ARRIVAL'),
  waive_quality: (id) => formSheet({ title: 'Accept out-of-range milk?', danger: true, submitLabel: 'Accept and allow delivery', intro: 'The reading is outside the range you agreed. Only continue if you decide to accept this milk. Your decision is recorded.',
    fields: [{ name: 'note', label: 'Why are you accepting it?', type: 'text', required: true }], onSubmit: (v) => post(`/transactions/${id}/quality/waive`, v) }),
  mark_arrived: (id) => confirmSheet('Milk has arrived?', 'The buyer will be asked to check the milk and decide.', 'Yes, arrived', () => post(`/transactions/${id}/arrived`)),
  decide: (id, el) => formSheet({
    title: 'Your decision', submitLabel: 'Save decision', intro: 'Accepting starts payment tracking. Rejecting opens a dispute where both sides can add evidence.',
    fields: [{ name: 'decision', label: 'Decision', type: 'select', options: [{ value: 'accept', label: 'Accept the milk' }, { value: 'reject', label: 'Reject the milk' }] },
      { name: 'accepted_litres', label: 'Litres accepted (if accepting)', type: 'number', step: '0.5', value: el.dataset.litres, min: 0.5 },
      { name: 'category', label: 'If rejecting: main problem', type: 'select', options: ['quality', 'quantity', 'delivery', 'price', 'other'] },
      { name: 'reason', label: 'If rejecting: explain why', type: 'textarea' }],
    onSubmit: (v) => post(`/transactions/${id}/decision`, v.decision === 'accept' ? { decision: 'accept', accepted_litres: v.accepted_litres } : { decision: 'reject', reason: v.reason, category: v.category }),
  }),
  open_dispute: (id) => formSheet({ title: 'Open a dispute', submitLabel: 'Open dispute', danger: true, intro: 'Describe the disagreement. The other party is notified and can see all evidence on this deal.',
    fields: [{ name: 'category', label: 'What is it about?', type: 'select', options: ['quality', 'quantity', 'payment', 'delivery', 'price', 'other'] }, { name: 'description', label: 'What happened?', type: 'textarea', required: true }],
    onSubmit: async (v) => { const d = await api.post(`/transactions/${id}/disputes`, v); go('#/dispute/' + d.id); } }),
  upload_evidence: (id) => formSheet({ title: 'Add evidence', submitLabel: 'Upload', intro: 'Original files are stored as they are and cannot be edited or deleted later.',
    fields: [{ name: 'category', label: 'What is it?', type: 'select', options: Object.entries(EVIDENCE_LABEL).map(([value, label]) => ({ value, label })), value: 'delivery_photo' },
      { name: 'photo', label: 'Photo or document', type: 'photo', required: true }, { name: 'note', label: 'Note (optional)', type: 'text' }, { name: 'use_gps', label: 'Attach my GPS location', type: 'checkbox' }],
    onSubmit: async (v) => { await uploadEvidence(id, v, v.category); toast('Evidence added'); refresh(); } }),
};

function reviewAI(a) {
  const x = a.extracted || {}, l = x.lactometer || {}, r = x.receipt || {};
  const fields = [];
  if (l.reading_sg != null) fields.push({ name: 'reading_sg', label: 'Lactometer reading the AI sees', type: 'number', step: '0.001', value: l.reading_sg });
  if (l.temperature_c != null) fields.push({ name: 'temperature_c', label: 'Temperature the AI sees (C)', type: 'number', step: '0.5', value: l.temperature_c });
  if (r.amount_rwf != null) fields.push({ name: 'amount_rwf', label: 'Receipt amount (RWF)', type: 'number', value: r.amount_rwf });
  if (r.reference) fields.push({ name: 'reference', label: 'Receipt reference', type: 'text', value: r.reference });
  if (r.date) fields.push({ name: 'date', label: 'Receipt date', type: 'text', value: r.date });
  const un = (x.uncertainties || []).join('; ');
  formSheet({ title: 'Check the AI suggestion', submitLabel: 'Confirm these values', fields,
    intro: `Look at the original photo yourself and correct anything wrong. ${x.notes || ''} ${un ? 'The AI was unsure about: ' + un : ''} ${fields.length ? '' : 'The AI could not read any values. Close this and retake the photo.'}`,
    onSubmit: async (v) => { const vals = Object.fromEntries(Object.entries(v).filter(([, y]) => y !== null && y !== '')); await api.post(`/ai/${a.id}/confirm`, { values: vals }); toast('Confirmed by you'); refresh(); } });
}

export const actions = {
  deal: (el) => dealActions[el.dataset.do](el.dataset.tx, el),
  job: async (el) => {
    const { do: d, id, app } = el.dataset;
    if (d === 'select') { await api.post(`/jobs/${id}/select`, { application_id: Number(app) }); toast('Driver chosen. Waiting for them to accept.'); return refresh(); }
    await api.post(`/jobs/${id}/${{ accept_job: 'accept', decline_job: 'decline', cancel_job: 'cancel' }[d] || d}`); toast('Done'); refresh();
  },
  pay: (el) => {
    const { do: d, id, due } = el.dataset;
    if (d === 'confirm') return confirmSheet('Confirm you received the money?', 'Check your own mobile-money or bank balance first. Confirming says the money reached you.', 'Yes, I received it', () => post(`/payments/${id}/confirm`));
    if (d === 'reject') return formSheet({ title: 'Reject this payment', danger: true, submitLabel: 'Reject and flag both', intro: 'Both of you are flagged and a payment dispute opens until it is settled.', fields: [{ name: 'reason', label: 'What is wrong?', type: 'text', required: true }], onSubmit: (v) => post(`/payments/${id}/reject`, v) });
    let proofId = null;
    formSheet({ title: 'Report your payment', submitLabel: 'Report payment', intro: 'This records your statement. The receiver must confirm it.',
      fields: [{ name: 'method_type', label: 'How did you pay?', type: 'select', options: [{ value: 'momo_code', label: 'MoMo Pay code' }, { value: 'momo_phone', label: 'MoMo phone number' }, { value: 'bank', label: 'Bank / e-banking' }, { value: 'other', label: 'Other' }] },
        { name: 'method_detail', label: 'Code / number / account used (optional)', type: 'text' }, { name: 'reference', label: 'Transaction reference', type: 'text', required: true },
        { name: 'amount_rwf', label: 'Amount paid (RWF)', type: 'number', required: true, value: due, min: 1 }, { name: 'photo', label: 'Proof screenshot or receipt (optional)', type: 'photo' }],
      onSubmit: async (v) => {
        if (v.photo && !proofId) proofId = (await uploadEvidence(el.dataset.tx, v, 'payment_receipt')).id;
        const r = await api.post(`/payments/${id}/report`, { method_type: v.method_type, method_detail: v.method_detail || undefined, reference: v.reference, amount_rwf: v.amount_rwf, proof_evidence_id: proofId || undefined });
        toast(r.amount_mismatch ? 'Reported. Note: the amount differs from what is due.' : 'Payment reported'); refresh();
      } });
  },
  aiAnalyze: async (el) => {
    toast('Reading the file with AI...');
    const a = await api.post(`/evidence/${el.dataset.ev}/analyze`, { language: aiLanguage() });
    reviewAI(a);
  },
  aiReview: async (el) => {
    const id = location.hash.match(/AS-[0-9A-F]+/)[0];
    const tx = await api.get('/transactions/' + id);
    reviewAI(tx.ai.find((a) => a.id === el.dataset.ai));
  },
  aiReject: async (el) => { await api.post(`/ai/${el.dataset.ai}/reject`); toast('Suggestion rejected'); refresh(); },
  aiSummary: async (el) => {
    toast('Preparing summary...');
    const r = await api.post(`/transactions/${el.dataset.tx}/ai-summary`, { language: aiLanguage() });
    const ai = r.ai;
    infoSheet('Deal summary', html`${r.notice ? html`<div class="notice">${r.notice}</div>` : ''}
      ${ai ? html`<p>${ai.summary}</p>${['missing_information', 'possible_inconsistencies', 'questions_for_parties'].map((k) => (ai[k] && ai[k].length ? html`<h3>${k.replace(/_/g, ' ')}</h3><ul>${ai[k].map((t) => html`<li>${t}</li>`)}</ul>` : ''))}${ai.dispute_help ? html`<h3>Dispute help</h3><p>${ai.dispute_help}</p>` : ''}` : ''}
      <h3>Automatic checks</h3>${r.findings.length ? r.findings.map((f) => html`<div class="notice ${f.severity === 'info' ? 'info' : ''} small">${f.message}</div>`) : html`<p class="small">Nothing flagged.</p>`}
      <div class="notice info small">${r.disclaimer} The AI does not decide whether milk is safe or whether a payment happened.</div>`);
  },
};
