// Driver jobs, disputes, profile/account, admin, notifications.
import { api } from './api.js';
import { S, go } from './state.js';
import { DISTRICTS, EVIDENCE_LABEL, ROLE_LABEL, confirmSheet, contactLinks, fmtDate, formSheet, html, icon, litres, pill, rwf, setHtml, toast } from './ui.js';

export function setBell(n) {
  const b = document.getElementById('bell');
  if (!b) return;
  b.textContent = n; b.classList.toggle('hidden', !n);
}

// ---------- driver jobs ----------
const jobs = { tab: 'open', filters: {} };
export async function jobsView(main) {
  if (S.user.role !== 'driver') return go('#/dashboard');
  const [open, mine] = await Promise.all([api.get('/jobs?' + new URLSearchParams(jobs.filters)), api.get('/jobs/mine')]);
  const need = mine.filter((j) => j.status === 'ASSIGNED').length;
  setHtml(main, html`<h1>Delivery jobs</h1><div class="chips"><button class="chip ${jobs.tab === 'open' ? 'on' : ''}" data-act="jobsTab" data-tab="open">Open jobs (${open.length})</button>
    <button class="chip ${jobs.tab === 'mine' ? 'on' : ''}" data-act="jobsTab" data-tab="mine">My jobs${need ? ` (${need} to answer)` : ''}</button><button class="chip" data-act="jobsFilter">${icon('filter', 'sm')} Filter</button></div>
    ${jobs.tab === 'open' ? (open.length ? open.map((j) => html`<div class="card"><div class="row between"><b>${litres(j.litres)} milk</b><span class="price">${rwf(j.wage_rwf)}</span></div>
      <div class="small muted">${icon('pin', 'sm')} Pickup: ${j.pickup}, ${j.district || ''}</div>${j.dropoff_name ? html`<div class="small muted">Drop-off: ${j.dropoff_name}</div>` : ''}
      <div class="small">Pickup time: ${fmtDate(j.delivery_at)}${j.vehicle_pref ? ' - wants ' + j.vehicle_pref : ''}</div>${j.notes ? html`<div class="small">${j.notes}</div>` : ''}
      ${j.my_application ? html`<div class="notice ok small">You applied for ${rwf(j.my_application.proposed_wage_rwf)} (${j.my_application.status.toLowerCase()}).</div>` : html`<button class="btn gold block" data-act="jobApply" data-id="${j.id}" data-wage="${j.wage_rwf}">Apply for this job</button>`}</div>`) : html`<div class="card empty">No open jobs match. Jobs appear after a buyer and seller agree a deal and hire a driver.</div>`)
      : (mine.length ? mine.map((j) => html`<div class="card"><div class="row between"><b>${j.transaction_id}</b>${pill([j.status, j.status === 'ASSIGNED' ? 'gold' : 'green'])}</div><div>${litres(j.litres)} - wage ${rwf(j.wage_rwf)}</div>
        <div class="small muted">${j.pickup}, ${j.district || ''} - ${fmtDate(j.delivery_at)}</div>
        ${j.status === 'ASSIGNED' ? html`<div class="btn-row"><button class="btn gold" data-act="jobAnswer" data-do="accept" data-id="${j.id}">Accept job</button><button class="btn ghost" data-act="jobAnswer" data-do="decline" data-id="${j.id}">Decline</button></div>` : html`<a class="btn block" href="#/transaction/${j.transaction_id}">Open deal</a>`}</div>`) : html`<div class="card empty">You have no assigned jobs yet.</div>`)}`);
}

// ---------- disputes ----------
export async function disputesView(main) {
  const list = await api.get('/disputes');
  setHtml(main, html`<h1>Disputes</h1><div class="notice info small">A dispute keeps a timestamped record of the disagreement, both parties' evidence, proposals and the final outcome the parties agreed.</div>
    <div class="card">${list.length ? list.map((d) => html`<a class="list-item" href="#/dispute/${d.id}"><div class="row between"><b>${d.id} - ${d.category}</b>${pill([d.status, d.status === 'OPEN' ? 'red' : 'green'])}</div><div class="small muted">Deal ${d.transaction_id} - opened by ${d.opened_by}, ${fmtDate(d.created_at)}</div><div class="small">${d.description.slice(0, 120)}</div></a>`) : html`<div class="empty">No disputes. That is good news.</div>`}</div>`);
}

const EV_NAME = { OPENED: 'opened the dispute', COMMENT: 'commented', EVIDENCE: 'attached evidence', PROPOSAL: 'proposed a resolution', PROPOSAL_ACCEPTED: 'accepted a proposal', PROPOSAL_REJECTED: 'rejected a proposal', RESOLVED: 'recorded the final outcome', WITHDRAWN: 'withdrew the dispute' };
export async function disputeView(main, id) {
  const d = await api.get('/disputes/' + id);
  const act = (a) => d.actions.includes(a);
  setHtml(main, html`<a href="#/disputes">&larr; Disputes</a><div class="card mt8"><div class="row between"><h2>${d.id}</h2>${pill([d.status, d.status === 'OPEN' ? 'red' : 'green'])}</div>
    <p class="muted small">Deal <a href="#/transaction/${d.transaction_id}">${d.transaction_id}</a> - ${d.category} - opened by ${d.opened_by}</p><p>${d.description}</p>
    ${d.final_outcome ? html`<div class="notice ok"><b>Final outcome:</b> ${d.final_outcome}</div>` : ''}
    <div class="btn-row">${act('comment') ? html`<button class="btn small ghost" data-act="dispute" data-do="comment" data-id="${d.id}">Comment</button>` : ''}${act('propose') ? html`<button class="btn small" data-act="dispute" data-do="propose" data-id="${d.id}">Propose a resolution</button>` : ''}
      ${act('attach_evidence') ? html`<button class="btn small ghost" data-act="dispute" data-do="evidence" data-id="${d.id}">Attach evidence</button>` : ''}${act('resolve') ? html`<button class="btn small gold" data-act="dispute" data-do="resolve" data-id="${d.id}">Record final outcome</button>` : ''}
      ${act('withdraw') ? html`<button class="btn small ghost" data-act="dispute" data-do="withdraw" data-id="${d.id}">Withdraw</button>` : ''}</div></div>
    <div class="card"><h3>Timeline</h3><ul class="timeline">${d.events.map((e) => html`<li><b>${e.by_me ? 'You' : e.actor}</b> ${EV_NAME[e.type]}${e.body ? html`<div>${e.body}</div>` : ''}${e.evidence_id ? html`<div class="small">Evidence ${e.evidence_id}</div>` : ''}
      ${e.type === 'PROPOSAL' ? (e.answer ? html`<div>${pill([e.answer === 'PROPOSAL_ACCEPTED' ? 'Accepted' : 'Rejected', e.answer === 'PROPOSAL_ACCEPTED' ? 'green' : 'red'])}</div>` : d.status === 'OPEN' && !e.by_me && act('propose') ? html`<div class="btn-row"><button class="btn small gold" data-act="proposalReply" data-id="${d.id}" data-ev="${e.event_id}" data-yes="1">Accept</button><button class="btn small ghost" data-act="proposalReply" data-id="${d.id}" data-ev="${e.event_id}" data-yes="0">Reject</button></div>` : html`<div class="small muted">Waiting for the other party</div>`) : ''}
      <div class="small muted">${fmtDate(e.at)}</div></li>`)}</ul></div>
    <div class="card"><h3>All evidence on this deal (${d.evidence.length})</h3><p class="small muted">Both parties can see everything submitted for this deal.</p><div class="thumbs">${d.evidence.map((e) => html`<div class="thumb">${e.is_image ? html`<a href="${e.url}" target="_blank" rel="noopener"><img src="${e.url}" alt="${EVIDENCE_LABEL[e.category]}" loading="lazy"></a>` : html`<a class="btn small ghost block" href="${e.url}" target="_blank" rel="noopener">Open file</a>`}<div class="meta"><b>${EVIDENCE_LABEL[e.category]}</b><br>${e.submitted_by}<br>${fmtDate(e.created_at)}</div></div>`)}</div></div>`);
  window.__dispute = d;
}

// ---------- profile ----------
export async function profileView(main) {
  const [{ user: u }, methods] = await Promise.all([api.get('/auth/me'), api.get('/users/me/payment-methods')]);
  S.user = u;
  const lang = localStorage.getItem('as_lang') || 'en';
  setHtml(main, html`<h1>My account</h1><div class="card"><div class="row between"><h2>${u.full_name}</h2>${u.is_verified ? pill(['Verified', 'green']) : pill(['Not verified yet', 'gold'])}</div>
    <dl class="kv"><dt>Role</dt><dd>${ROLE_LABEL[u.role]}</dd><dt>Phone</dt><dd>${u.phone}</dd><dt>Business</dt><dd>${u.business_name || '-'}</dd><dt>District</dt><dd>${u.district || '-'}${u.sector ? ', ' + u.sector : ''}</dd>
      ${u.vehicle_type ? html`<dt>Vehicle</dt><dd>${u.vehicle_type}</dd>` : ''}${u.cooperative ? html`<dt>Cooperative</dt><dd>${u.cooperative.name}</dd>` : ''}</dl>
    <div class="btn-row"><button class="btn ghost" data-act="editProfile">Edit profile</button><button class="btn ghost" data-act="changePassword">Change password</button></div></div>
    ${['driver', 'admin'].includes(u.role) ? '' : html`<div class="card"><div class="row between"><h3>${icon('wallet')} How I can be paid</h3><button class="btn small gold" data-act="addMethod">${icon('plus', 'sm')} Add</button></div>
      <p class="small muted">Buyers see these when they report a payment to you. Add MoMo Pay code, phone wallet or bank details.</p>
      ${methods.length ? methods.map((m) => html`<div class="list-item row between"><div><b>${m.label}</b><div class="small muted">${m.method_type.replace('_', ' ')}: ${m.account_value}</div></div><button class="btn small ghost" data-act="delMethod" data-id="${m.id}">Remove</button></div>`) : html`<div class="empty">None yet.</div>`}</div>`}
    ${u.role === 'driver' ? html`<div class="card"><div class="row between"><h3>${icon('wallet')} How I want to be paid</h3><button class="btn small gold" data-act="addMethod">${icon('plus', 'sm')} Add</button></div>${methods.map((m) => html`<div class="list-item row between"><div><b>${m.label}</b><div class="small muted">${m.account_value}</div></div><button class="btn small ghost" data-act="delMethod" data-id="${m.id}">Remove</button></div>`)}</div>` : ''}
    <div class="card"><h3>${icon('spark')} AI assistant language</h3><select data-act="setLang">${[['en', 'English'], ['rw', 'Kinyarwanda'], ['fr', 'Francais']].map(([v, l]) => html`<option value="${v}" ${v === lang ? 'selected' : ''}>${l}</option>`)}</select>
      <p class="hint">Kinyarwanda output from AI is machine-generated and should be checked by a fluent speaker.</p></div>
    <div class="card"><h3>${icon('lock')} Privacy</h3><p class="small">AmataShield stores your phone number, deal records, evidence files and payment statements. Only people in a deal (and system staff) can see that deal. You can ask for corrections to your records.</p></div>
    <button class="btn danger block" data-act="logout">${icon('logout', 'sm')} Log out</button>`);
}

// ---------- admin ----------
export async function adminView(main) {
  if (S.user.role !== 'admin') return go('#/dashboard');
  const users = await api.get('/admin/users');
  setHtml(main, html`<h1>Administration</h1><div class="card"><h3>${icon('shield')} Record integrity</h3><p class="small muted">Checks that no entry in the hash-chained history was altered or removed.</p><button class="btn navy" data-act="auditVerify">Verify audit history</button><div id="auditOut"></div></div>
    <div class="card"><h3>${icon('users')} Users (${users.length})</h3>${users.map((u) => html`<div class="list-item"><div class="row between"><b>${u.full_name}</b>${pill([u.role, ''])}</div><div class="small muted">${u.phone} - ${u.district || ''} ${u.is_active ? '' : '- DEACTIVATED'}</div>
      <div class="btn-row">${u.is_verified ? pill(['Verified', 'green']) : html`<button class="btn small gold" data-act="adminUser" data-do="verify" data-id="${u.public_id}">Verify</button>`}
      <button class="btn small ghost" data-act="adminUser" data-do="${u.is_active ? 'deactivate' : 'activate'}" data-id="${u.public_id}">${u.is_active ? 'Deactivate' : 'Activate'}</button></div></div>`)}</div>`);
}

// ---------- notifications ----------
export async function notificationsView(main) {
  const list = await api.get('/notifications');
  setHtml(main, html`<div class="row between"><h1>Notifications</h1><button class="btn small ghost" data-act="markRead">Mark all read</button></div><div class="card">${list.length ? list.map((n) => html`<a class="list-item" href="${n.link || '#/dashboard'}" ><div class="${n.is_read ? 'muted' : ''}"><b>${n.is_read ? '' : '\u2022 '}</b>${n.message}</div><div class="small muted">${fmtDate(n.created_at)}</div></a>`) : html`<div class="empty">Nothing yet.</div>`}</div>`);
}

// ---------- actions ----------
const refresh = () => S.rerender();
export const actions = {
  jobsTab: (el) => { jobs.tab = el.dataset.tab; refresh(); },
  jobsFilter: () => formSheet({ title: 'Filter jobs', submitLabel: 'Apply', fields: [
    { name: 'district', label: 'Pickup district', type: 'select', options: [{ value: '', label: 'Any' }, ...DISTRICTS], value: jobs.filters.district || '' },
    { name: 'min_wage', label: 'Lowest wage (RWF)', type: 'number', min: 0, value: jobs.filters.min_wage },
    { name: 'sort', label: 'Sort', type: 'select', value: jobs.filters.sort || 'newest', options: [{ value: 'newest', label: 'Newest' }, { value: 'wage', label: 'Highest wage' }, { value: 'date', label: 'Earliest pickup' }] }],
    onSubmit: async (v) => { jobs.filters = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== '' && x !== 'newest')); refresh(); } }),
  jobApply: (el) => formSheet({ title: 'Apply for this job', submitLabel: 'Send application', intro: 'The buyer or seller will see your wage and choose a driver. You must accept before anything starts.',
    fields: [{ name: 'proposed_wage_rwf', label: 'Your wage (RWF)', type: 'number', required: true, min: 0, value: el.dataset.wage }, { name: 'message', label: 'Message (vehicle, experience)', type: 'text' }],
    onSubmit: async (v) => { await api.post(`/jobs/${el.dataset.id}/apply`, { proposed_wage_rwf: v.proposed_wage_rwf, message: v.message || undefined }); toast('Application sent'); refresh(); } }),
  jobAnswer: async (el) => { await api.post(`/jobs/${el.dataset.id}/${el.dataset.do}`); toast(el.dataset.do === 'accept' ? 'Job accepted. Contact details are now visible in the deal.' : 'Job declined'); refresh(); },

  dispute: (el) => {
    const id = el.dataset.id, d = window.__dispute;
    const post = async (body) => { await api.post(`/disputes/${id}/events`, body); refresh(); };
    const k = el.dataset.do;
    if (k === 'comment') return formSheet({ title: 'Add a comment', fields: [{ name: 'body', label: 'Message', type: 'textarea', required: true }], onSubmit: (v) => post({ event_type: 'COMMENT', body: v.body }) });
    if (k === 'propose') return formSheet({ title: 'Propose a resolution', intro: 'For example: "The buyer pays 6,500 RWF by MoMo today and the farmer accepts."', fields: [{ name: 'body', label: 'Your proposal', type: 'textarea', required: true }], onSubmit: (v) => post({ event_type: 'PROPOSAL', body: v.body }) });
    if (k === 'evidence') return formSheet({ title: 'Attach evidence', intro: 'Choose a file already uploaded to this deal. To add a new file, upload it in the deal first.', fields: [{ name: 'evidence_id', label: 'File', type: 'select', options: d.evidence.map((e) => ({ value: e.id, label: `${EVIDENCE_LABEL[e.category]} - ${e.submitted_by} (${e.id})` })) }, { name: 'body', label: 'What does it show?', type: 'text' }], onSubmit: (v) => post({ event_type: 'EVIDENCE', evidence_id: v.evidence_id, body: v.body || undefined }) });
    if (k === 'resolve') return formSheet({ title: 'Record the final outcome', submitLabel: 'Close dispute', intro: 'Allowed after the other party accepted a proposal. The deal returns to where it was.', fields: [{ name: 'outcome', label: 'Agreed outcome', type: 'textarea', value: d.events.filter((e) => e.type === 'PROPOSAL' && e.answer === 'PROPOSAL_ACCEPTED').slice(-1)[0]?.body || '' }], onSubmit: async (v) => { await api.post(`/disputes/${id}/resolve`, { outcome: v.outcome || undefined }); refresh(); } });
    if (k === 'withdraw') return confirmSheet('Withdraw this dispute?', 'The deal returns to where it was before the dispute.', 'Withdraw', async () => { await api.post(`/disputes/${id}/withdraw`); refresh(); });
  },
  proposalReply: async (el) => { await api.post(`/disputes/${el.dataset.id}/proposals/${el.dataset.ev}/respond`, { accept: el.dataset.yes === '1' }); refresh(); },

  editProfile: () => formSheet({ title: 'Edit profile', fields: [{ name: 'full_name', label: 'Full name', type: 'text', required: true, value: S.user.full_name }, { name: 'business_name', label: 'Business / farm name', type: 'text', value: S.user.business_name },
    { name: 'district', label: 'District', type: 'select', options: [{ value: '', label: 'Choose' }, ...DISTRICTS], value: S.user.district || '' }, { name: 'sector', label: 'Sector', type: 'text', value: S.user.sector },
    ...(S.user.role === 'driver' ? [{ name: 'vehicle_type', label: 'Vehicle', type: 'select', options: ['bicycle', 'motorcycle', 'car', 'truck'], value: S.user.vehicle_type || 'motorcycle' }] : [])],
    onSubmit: async (v) => { S.user = (await api.patch('/users/me', v)).user; toast('Saved'); refresh(); } }),
  changePassword: () => formSheet({ title: 'Change password', fields: [{ name: 'current_password', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' }, { name: 'new_password', label: 'New password (8+ characters, letter and number)', type: 'password', required: true, autocomplete: 'new-password' }],
    onSubmit: async (v) => { await api.post('/users/me/password', v); toast('Password changed'); } }),
  addMethod: () => formSheet({ title: 'Add payment option', fields: [{ name: 'method_type', label: 'Type', type: 'select', options: [{ value: 'momo_code', label: 'MoMo Pay code' }, { value: 'momo_phone', label: 'MoMo / wallet phone number' }, { value: 'bank', label: 'Bank / e-banking' }, { value: 'other', label: 'Other' }] },
    { name: 'label', label: 'Name (e.g. My MoMo Pay)', type: 'text', required: true }, { name: 'account_value', label: 'Code / number / account', type: 'text', required: true }],
    onSubmit: async (v) => { await api.post('/users/me/payment-methods', v); refresh(); } }),
  delMethod: async (el) => { await api.del(`/users/me/payment-methods/${el.dataset.id}`); refresh(); },
  setLang: (el) => { localStorage.setItem('as_lang', el.value); toast('Saved'); },

  adminUser: async (el) => { await api.post(`/admin/users/${el.dataset.id}/${el.dataset.do}`); refresh(); },
  auditVerify: async () => { const r = await api.get('/admin/audit/verify'); setHtml(document.getElementById('auditOut'), html`<div class="notice ${r.ok ? 'ok' : ''}">${r.ok ? `History intact: ${r.entries_checked} entries checked.` : `PROBLEM: entry ${r.first_bad_entry_id} does not match the chain.`}</div>`); },
  markRead: async () => { await api.post('/notifications/read'); setBell(0); refresh(); },
};
