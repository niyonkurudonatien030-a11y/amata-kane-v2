/* AmataShield single-page app. Plain JavaScript, no build step.
   Sections: helpers -> api -> dialogs/camera -> views -> router. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const state = { user: null, aiEnabled: false };

const LABELS = {
  open: "Open", pending_acceptance: "Pending acceptance", agreed: "Agreed", in_transit: "In transit",
  delivered: "Delivered", received: "Received by buyer", completed: "Completed", disputed: "Disputed", cancelled: "Cancelled",
  unconfirmed: "Payment unconfirmed", reported: "Payment reported", confirmed: "Payment confirmed by both", 
  farmer: "Farmer", buyer: "Buyer", driver: "Driver", coop_admin: "Cooperative admin", admin: "System admin",
  quality_measurement: "Quality measurement", lactometer_photo: "Lactometer photo", delivery_photo: "Delivery photo",
  collection_receipt: "Collection-centre receipt", payment_receipt: "Payment receipt", other: "Other document",
};
const label = (k) => LABELS[k] || k;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rwf = (n) => new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(n || 0) + " RWF";
const when = (s) => (s ? new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "-");
const badge = (s) => `<span class="badge ${esc(s)}">${esc(label(s))}</span>`;
const DISTRICTS = ["Kigali", "Gasabo", "Kicukiro", "Nyarugenge", "Kayonza", "Nyagatare", "Gatsibo", "Rwamagana", "Musanze", "Huye", "Nyanza", "Rubavu", "Other"];

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------------------------------------------------------------- API */
async function api(path, { method = "GET", json, form } = {}) {
  const opts = { method, credentials: "same-origin", headers: { "X-Requested-With": "AmataShield" } };
  if (json !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(json); }
  if (form) opts.body = form;
  let res;
  try { res = await fetch("/api" + path, opts); } catch { throw new Error("No connection. Check your internet and try again."); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/auth/login") { state.user = null; location.hash = "#/login"; }
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

/* ---------------------------------------------------------------- dialogs & camera */
function dialog(html, id = "dlg") {
  const d = $("#" + id);
  d.innerHTML = html;
  d.showModal();
  return d;
}
function closeDialog(id = "dlg") { const d = $("#" + id); if (d.open) d.close(); }

/** Generic form dialog. fields: [{name,label,type,options,required,value}] -> Promise(values|null) */
function askForm(title, fields, submit = "Save", intro = "") {
  return new Promise((resolve) => {
    const inputs = fields.map((f) => {
      const req = f.required === false ? "" : "required";
      if (f.type === "select") return `<label>${esc(f.label)}<select name="${f.name}" ${req}>${f.options.map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("")}</select></label>`;
      if (f.type === "textarea") return `<label>${esc(f.label)}<textarea name="${f.name}" ${req}>${esc(f.value || "")}</textarea></label>`;
      return `<label>${esc(f.label)}<input name="${f.name}" type="${f.type || "text"}" ${f.step ? `step="${f.step}"` : ""} value="${esc(f.value || "")}" ${req}></label>`;
    }).join("");
    const d = dialog(`<form method="dialog" id="askf"><h2>${esc(title)}</h2>${intro ? `<p class="mute">${esc(intro)}</p>` : ""}${inputs}
      <div class="btns"><button type="submit" class="gold">${esc(submit)}</button><button type="button" class="ghost" id="askc">Cancel</button></div></form>`);
    let done = false;
    $("#askc", d).onclick = () => { done = true; closeDialog(); resolve(null); };
    $("#askf", d).onsubmit = (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target).entries());
      done = true; closeDialog(); resolve(values);
    };
    d.onclose = () => { if (!done) resolve(null); };
  });
}

/** Opens the phone camera in the browser (getUserMedia) and returns a JPEG File, or null. */
function captureFromCamera() {
  return new Promise((resolve) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Camera not available. Use 'Choose file' instead."); return resolve(null); }
    let stream;
    const d = dialog(`<h2>Take photo</h2><video class="cam" autoplay playsinline muted></video>
      <p class="mute">Hold the phone steady. Make sure the numbers are clear and well lit.</p>
      <div class="btns"><button id="snap" class="gold">Capture</button><button id="camx" class="ghost">Cancel</button></div>`, "dlg2");
    const video = $("video", d);
    const stop = () => stream && stream.getTracks().forEach((t) => t.stop());
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => { stream = s; video.srcObject = s; })
      .catch(() => { toast("Camera permission denied. Use 'Choose file' instead."); closeDialog("dlg2"); resolve(null); });
    $("#camx", d).onclick = () => { stop(); closeDialog("dlg2"); resolve(null); };
    $("#snap", d).onclick = () => {
      if (!video.videoWidth) return;
      const c = document.createElement("canvas");
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext("2d").drawImage(video, 0, 0);
      c.toBlob((blob) => { stop(); closeDialog("dlg2"); resolve(blob ? new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }) : null); }, "image/jpeg", 0.9);
    };
    d.onclose = stop;
  });
}

/* ---------------------------------------------------------------- shared UI */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v10h-6v-6H9v6H3z"/>', market: '<path d="M4 7h16l-1 5H5zM6 12v8h12v-8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', list: '<path d="M4 6h16M4 12h16M4 18h16"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  truck: '<path d="M2 7h11v9H2zM13 10h5l3 3v3h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.500-1-8-4-8-9V6z"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

function renderNav() {
  const nav = $("#nav");
  const u = state.user;
  $("#logoutBtn").hidden = !u;
  if (!u) { nav.hidden = true; return; }
  const items = [["#/dashboard", "home", "Home"]];
  if (u.role === "driver") items.push(["#/jobs", "truck", "Jobs"]);
  else if (["farmer", "buyer", "coop_admin"].includes(u.role)) items.push(["#/market", "market", "Market"], ["#/new", "plus", "Post"]);
  items.push(["#/deals", "list", "Deals"]);
  if (u.role === "admin") items.push(["#/admin", "shield", "Admin"]);
  items.push(["#/profile", "user", "Me"]);
  nav.innerHTML = items.map(([h, i, t]) => `<a href="${h}" class="${location.hash.startsWith(h) ? "on" : ""}">${icon(i)}${t}</a>`).join("");
  nav.hidden = false;
}

function dealCard(d) {
  const sell = d.deal_type === "sell";
  const who = sell ? d.seller : d.buyer;
  return `<a class="card link" href="#/deals/${d.id}">
    <div class="row"><strong>${sell ? "Milk for sale" : "Buyer wants milk"} · ${esc(d.litres)} L</strong>${badge(d.status)}</div>
    <div class="row"><span>${rwf(d.price_per_litre)}/L · <b>${rwf(d.total_value)}</b></span>${d.status !== "open" ? badge(d.payment_status) : ""}</div>
    <div class="mute">${esc(d.location)}${d.district ? ", " + esc(d.district) : ""} · ${esc(who ? who.full_name : "")} · ${esc(d.public_id)}</div></a>`;
}

const page = (html) => { view.innerHTML = html; window.scrollTo(0, 0); };
const empty = (t) => `<div class="card mute">${esc(t)}</div>`;

/* ---------------------------------------------------------------- views */
function viewLogin() {
  page(`<div class="hero"><h1>AmataShield</h1><p>A shared, traceable record of every milk deal: agreement, quality evidence, delivery, payment and disputes.</p></div>
  <form id="f" class="card"><h2>Sign in</h2><div id="e"></div>
    <label>Phone number<input name="phone" inputmode="tel" autocomplete="username" placeholder="0788 123 456" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="full gold">Sign in</button>
    <p class="mute">No account? <a href="#/register">Create one</a></p></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("/auth/login", { method: "POST", json: Object.fromEntries(new FormData(e.target)) });
      state.user = r.user; await loadMe(); location.hash = "#/dashboard";
    } catch (err) { $("#e").innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
}

function viewRegister() {
  page(`<h1>Create account</h1><form id="f" class="card"><div id="e"></div>
    <label>I am a<select name="role"><option value="farmer">Farmer (sell milk)</option><option value="buyer">Buyer (buy milk)</option><option value="driver">Driver / transporter</option></select></label>
    <label>Full name<input name="full_name" required></label>
    <label>Phone number<input name="phone" inputmode="tel" placeholder="0788 123 456" required></label>
    <label>District<select name="district">${DISTRICTS.map((d) => `<option>${d}</option>`).join("")}</select></label>
    <label>Cooperative / company (optional)<input name="organisation"></label>
    <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
    <p class="mute">At least 8 characters, with one capital letter and one digit.</p>
    <button class="full gold">Create account</button><p class="mute">Already registered? <a href="#/login">Sign in</a></p></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("/auth/register", { method: "POST", json: Object.fromEntries(new FormData(e.target)) });
      state.user = r.user; await loadMe(); location.hash = "#/dashboard";
    } catch (err) { $("#e").innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
}

async function viewDashboard() {
  const d = await api("/dashboard");
  const c = d.counts;
  const stat = (n, t) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`;
  page(`<h1>Hello, ${esc(state.user.full_name.split(" ")[0])}</h1><p class="mute">${esc(label(state.user.role))}${state.user.district ? " · " + esc(state.user.district) : ""}</p>
    <div class="grid">${stat(c.active, "Active")}${stat(c.pending_acceptance, "Pending acceptance")}${stat(c.pending_delivery, "Pending delivery")}${stat(c.completed, "Completed")}${stat(c.open_posts, "Open posts")}${stat(c.disputed, "Disputes")}</div>
    <div class="card navy"><div class="row"><span>Completed volume</span><b>${esc(d.completed_litres)} L</b></div><div class="row"><span>Completed value</span><b>${rwf(d.completed_value)}</b></div>
    <div class="mute">Payment records: ${["unconfirmed", "reported", "confirmed", "disputed"].map((k) => `${d.by_payment[k] || 0} ${k}`).join(" · ")}</div></div>
    ${d.system ? `<div class="card"><b>System</b><div class="mute">Users: ${Object.entries(d.system.users_by_role).map(([k, v]) => `${v} ${label(k)}`).join(", ")}<br>Transactions: ${d.system.deals_total} · Evidence files/records: ${d.system.evidence_total} · Open disputes: ${d.system.open_disputes}</div></div>` : ""}
    <h2>Needs your action</h2>${d.needs_action.length ? d.needs_action.map(dealCard).join("") : empty("Nothing waiting for you.")}
    <h2>Recent</h2>${d.recent.length ? d.recent.map(dealCard).join("") : empty("No transactions yet. Post milk or find a deal in the Market.")}`);
}

async function viewDeals() {
  const status = new URLSearchParams(location.hash.split("?")[1] || "").get("status") || "";
  const r = await api("/deals" + (status ? `?status=${status}` : ""));
  const opts = ["", "open", "pending_acceptance", "agreed", "in_transit", "delivered", "received", "completed", "disputed", "cancelled"];
  page(`<h1>My transactions</h1><label>Filter<select id="flt">${opts.map((o) => `<option value="${o}" ${o === status ? "selected" : ""}>${o ? esc(label(o)) : "All"}</option>`).join("")}</select></label>
    ${r.deals.length ? r.deals.map(dealCard).join("") : empty("No transactions found.")}`);
  $("#flt").onchange = (e) => { location.hash = "#/deals" + (e.target.value ? `?status=${e.target.value}` : ""); };
}

async function viewMarket() {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const r = await api("/deals/open?" + q.toString());
  const u = state.user;
  page(`<h1>${u.role === "buyer" ? "Milk for sale" : "Buyers looking for milk"}</h1>
    <form id="f" class="card"><div class="grid">
      <label>Min litres<input name="min_litres" type="number" inputmode="decimal" value="${esc(q.get("min_litres") || "")}"></label>
      <label>Max price / L<input name="max_price" type="number" inputmode="decimal" value="${esc(q.get("max_price") || "")}"></label></div>
      <label>District<select name="district"><option value="">Any</option>${DISTRICTS.map((d) => `<option ${q.get("district") === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label>Sort by<select name="sort">${[["", "Newest"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["litres_desc", "Most litres"]].map(([v, t]) => `<option value="${v}" ${q.get("sort") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <button class="full">Apply filters</button></form>
    ${r.deals.length ? r.deals.map(dealCard).join("") : empty("No open posts match. Try fewer filters.")}`);
  $("#f").onsubmit = (e) => {
    e.preventDefault();
    const p = new URLSearchParams([...new FormData(e.target).entries()].filter(([, v]) => v));
    location.hash = "#/market" + (p.toString() ? "?" + p : "");
  };
}

async function viewJobs() {
  const r = await api("/deals/delivery-jobs");
  page(`<h1>Delivery jobs</h1><p class="mute">Agreed deals that still need a driver. Open one and apply with your fee.</p>${r.deals.length ? r.deals.map(dealCard).join("") : empty("No open jobs right now.")}`);
}

function viewNew() {
  const sell = state.user.role !== "buyer";
  page(`<h1>${sell ? "Post milk for sale" : "Post a purchase request"}</h1><form id="f" class="card"><div id="e"></div>
    <div class="grid"><label>Litres<input name="litres" type="number" inputmode="decimal" min="1" step="any" required></label>
    <label>Price per litre (RWF)<input name="price_per_litre" type="number" inputmode="decimal" min="1" step="any" required></label></div>
    <label>Collection / delivery location<input name="location" required placeholder="e.g. Kayonza milk collection centre"></label>
    <label>District<select name="district">${DISTRICTS.map((d) => `<option ${d === state.user.district ? "selected" : ""}>${d}</option>`).join("")}</select></label>
    <label>Delivery date and time (optional)<input name="delivery_at" type="datetime-local"></label>
    <label>Quality requirements (optional)<textarea name="quality_requirements" placeholder="e.g. lactometer reading, temperature, same-day milk"></textarea></label>
    <label>Other terms (optional)<textarea name="terms"></textarea></label>
    <div class="note">The other person accepts exactly what is shown here. Changing terms later means posting a new deal.</div>
    <button class="full gold">Post deal</button></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const json = Object.fromEntries(new FormData(e.target));
    json.deal_type = sell ? "sell" : "buy";
    try { const r = await api("/deals", { method: "POST", json }); toast("Deal posted"); location.hash = "#/deals/" + r.deal.id; }
    catch (err) { $("#e").innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
}

const ACTION_TEXT = {
  join: ["Accept these terms", "gold"], confirm: ["Confirm agreement", "gold"], decline: ["Decline", "ghost"], withdraw: ["Withdraw", "ghost"],
  cancel: ["Cancel deal", "ghost"], pickup: ["Record pickup", "gold"], deliver: ["Record arrival", "gold"], receive: ["I checked the milk: accept delivery", "gold"],
};

async function viewDeal(id) {
  const [{ deal: d }, evRes, aiRes] = await Promise.all([api(`/deals/${id}`), api(`/deals/${id}/evidence`).catch(() => ({ evidence: [] })), api(`/deals/${id}/ai`).catch(() => ({ analyses: [] }))]);
  const A = new Set(d.actions);
  const party = (t, p) => (p ? `<dt>${t}</dt><dd>${esc(p.full_name)}${p.phone ? ` · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ""}</dd>` : "");
  const buttons = Object.keys(ACTION_TEXT).filter((a) => A.has(a)).map((a) => `<button data-act="${a}" class="${ACTION_TEXT[a][1]}">${ACTION_TEXT[a][0]}</button>`).join("");
  const extra = [A.has("add_evidence") && `<button data-act="evidence">Add evidence</button>`, A.has("apply_driver") && `<button data-act="apply" class="gold">Apply to deliver</button>`,
    A.has("report_payment") && `<button data-act="pay" class="gold">Report payment</button>`, A.has("open_dispute") && `<button data-act="dispute" class="danger">Open dispute</button>`].filter(Boolean).join("");
  const openDisp = d.disputes.find((x) => x.status === "open");
  page(`<div class="row"><h1>${esc(d.litres)} L · ${esc(d.public_id)}</h1>${badge(d.status)}</div>
    <div class="card"><dl class="kv"><dt>Price</dt><dd>${rwf(d.price_per_litre)} / L</dd><dt>Total</dt><dd><b>${rwf(d.total_value)}</b></dd>
      <dt>Location</dt><dd>${esc(d.location)}${d.district ? ", " + esc(d.district) : ""}</dd><dt>Delivery</dt><dd>${when(d.delivery_at)}</dd>
      <dt>Quality</dt><dd>${esc(d.quality_requirements || "-")}</dd><dt>Terms</dt><dd>${esc(d.terms || "-")}</dd>
      ${party("Seller", d.seller)}${party("Buyer", d.buyer)}${party("Driver", d.driver)}
      <dt>Seller accepted</dt><dd>${when(d.seller_accepted_at)}</dd><dt>Buyer accepted</dt><dd>${when(d.buyer_accepted_at)}</dd>
      <dt>Payment record</dt><dd>${badge(d.payment_status)}</dd></dl>
      ${d.terms_hash ? `<p class="mute">Agreement fingerprint: ${esc(d.terms_hash.slice(0, 16))}…</p>` : ""}</div>
    ${openDisp ? `<a class="card link" href="#/disputes/${openDisp.id}"><b>Open dispute</b><div class="mute">${esc(openDisp.reason)}</div></a>` : ""}
    <div class="btns">${buttons}${extra}</div>
    ${d.driver_applications && d.driver_applications.length ? `<h2>Driver applications</h2>${d.driver_applications.map((a) => `<div class="card row"><div><b>${esc(a.full_name)}</b> ${esc(a.district || "")}<div class="mute">Fee: ${a.proposed_fee ? rwf(a.proposed_fee) : "not stated"} ${esc(a.message || "")}</div></div><button class="small" data-approve="${a.id}">Approve</button></div>`).join("")}` : ""}
    ${d.payments.length ? `<h2>Payment records</h2><div class="note">These are records typed by users. AmataShield does not move or hold money.</div>${d.payments.map((p) => `<div class="card"><div class="row"><b>${rwf(p.amount)}</b>${badge(p.status === "reported" ? "reported" : p.status === "confirmed" ? "confirmed" : "disputed")}</div>
      <div class="mute">${esc(p.method)} · ref ${esc(p.reference || "-")} · by ${esc(p.reporter)} · ${when(p.created_at)}${p.response_note ? `<br>Seller note: ${esc(p.response_note)}` : ""}</div>
      ${p.status === "reported" && d.my_role === "seller" ? `<div class="btns"><button class="small gold" data-payok="${p.id}">I received this payment</button><button class="small danger" data-paybad="${p.id}">Not accepted</button></div>` : ""}</div>`).join("")}` : ""}
    <h2>Evidence (${evRes.evidence.length})</h2>
    ${evRes.evidence.length ? evRes.evidence.map((e) => `<div class="card"><div class="row"><b>${esc(label(e.category))}</b><span class="mute">${esc(e.submitted_by.full_name)} (${esc(label(e.submitted_by.role))})</span></div>
      ${e.measurement ? `<div>Typed measurement: <b>${esc(e.measurement)}</b></div>` : ""}${e.note ? `<div>${esc(e.note)}</div>` : ""}
      ${e.has_file && e.mime_type.startsWith("image/") ? `<img class="thumb" loading="lazy" alt="${esc(label(e.category))}" src="/api/evidence/${e.id}/file">` : ""}
      ${e.has_file && !e.mime_type.startsWith("image/") ? `<a href="/api/evidence/${e.id}/file" target="_blank" rel="noopener">Open ${esc(e.original_name)}</a>` : ""}
      <div class="mute">Recorded ${when(e.created_at)} · device time ${when(e.captured_at)}${e.sha256 ? ` · SHA-256 ${esc(e.sha256.slice(0, 12))}…` : ""}</div>
      ${state.aiEnabled && e.has_file && ["payment_receipt", "lactometer_photo"].includes(e.category) && e.mime_type.startsWith("image/") && ["seller", "buyer", "driver"].includes(d.my_role) ? `<button class="small ghost" data-ai="${e.id}">Read with AI (draft)</button>` : ""}</div>`).join("") : empty("No evidence yet.")}
    ${d.my_role ? `<h2>AI assistant</h2><div class="note">AI gives drafts only. It cannot certify milk, laboratory results or payments. You must check every answer.${state.aiEnabled ? "" : " (AI is not configured on this server.)"}</div>
      ${state.aiEnabled ? `<div class="btns"><button class="small ghost" data-aitask="summary">Summarise</button><button class="small ghost" data-aitask="consistency">Compare agreement and evidence</button>${openDisp ? `<button class="small ghost" data-aitask="dispute_help">Explain dispute</button>` : ""}</div>` : ""}
      ${aiRes.analyses.map(aiCard).join("")}` : ""}
    <h2>History</h2><ul class="timeline">${d.timeline.map((t) => `<li><b>${esc(t.action.replace(/_/g, " "))}</b>${t.who ? " · " + esc(t.who) : ""}<div class="mute">${esc(t.detail || "")} ${when(t.created_at)}</div></li>`).join("")}</ul>`);
  wireDeal(d, aiRes.analyses);
}

function aiCard(a) {
  const out = a.confirmed || a.output;
  const fields = Object.entries(out).map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${Array.isArray(v) ? (v.length ? "<ul>" + v.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>" : "-") : esc(v ?? "-")}</dd>`).join("");
  return `<div class="card"><div class="row"><b>${esc(a.kind)} (AI draft)</b><span class="badge ${a.review_status === "confirmed" ? "completed" : a.review_status === "rejected" ? "cancelled" : "open"}">${esc(a.review_status.replace("_", " "))}</span></div>
    <dl class="kv">${fields}</dl><div class="mute">${esc(a.disclaimer)}</div>
    ${a.review_status === "pending_review" ? `<div class="btns"><button class="small gold" data-aireview="${a.id}" data-v="confirm">Check and confirm</button><button class="small ghost" data-aireview="${a.id}" data-v="reject">Reject</button></div>` : ""}</div>`;
}

function wireDeal(d, analyses) {
  const id = d.id;
  const reload = () => route();
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); reload(); } catch (err) { toast(err.message); } };
  view.onclick = async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    if (["join", "confirm", "decline", "withdraw", "cancel"].includes(act)) {
      if (act === "cancel" && !confirm("Cancel this transaction?")) return;
      return run(() => api(`/deals/${id}/${act}`, { method: "POST", json: {} }), "Done");
    }
    if (["pickup", "deliver", "receive"].includes(act)) {
      if (act === "receive" && !confirm("Confirm you checked the milk and accept this delivery?")) return;
      return run(() => api(`/deals/${id}/stage`, { method: "POST", json: { stage: act } }), "Recorded");
    }
    if (act === "evidence") return evidenceDialog(id, reload);
    if (act === "apply") {
      const v = await askForm("Apply to deliver", [{ name: "proposed_fee", label: "Your fee (RWF)", type: "number" }, { name: "message", label: "Message (optional)", required: false }], "Send application");
      if (v) run(() => api(`/deals/${id}/drivers`, { method: "POST", json: v }), "Application sent");
    }
    if (b.dataset.approve) return run(() => api(`/deals/${id}/drivers/${b.dataset.approve}/approve`, { method: "POST", json: {} }), "Driver assigned");
    if (act === "pay") {
      const v = await askForm("Report payment", [{ name: "amount", label: "Amount sent (RWF)", type: "number", value: d.total_value },
        { name: "method", label: "Method", type: "select", options: [["mobile_money", "Mobile money"], ["bank", "Bank"], ["cash", "Cash"], ["other", "Other"]] },
        { name: "reference", label: "Transaction reference / ID", required: false }], "Report payment", "This records what you say you paid. The seller must confirm receipt.");
      if (v) run(() => api(`/deals/${id}/payments`, { method: "POST", json: v }), "Payment reported");
    }
    if (b.dataset.payok) return run(() => api(`/payments/${b.dataset.payok}/confirm`, { method: "POST", json: {} }), "Payment confirmed");
    if (b.dataset.paybad) {
      const v = await askForm("Payment not accepted", [{ name: "reason", label: "What is wrong?", type: "textarea" }], "Open dispute", "This will open a dispute so both sides can resolve it.");
      if (v) run(() => api(`/payments/${b.dataset.paybad}/reject`, { method: "POST", json: v }), "Dispute opened");
    }
    if (act === "dispute") {
      const v = await askForm("Open a dispute", [{ name: "reason", label: "Explain the disagreement", type: "textarea" }], "Open dispute");
      if (v) { try { const r = await api(`/deals/${id}/disputes`, { method: "POST", json: v }); location.hash = "#/disputes/" + r.dispute_id; } catch (err) { toast(err.message); } }
    }
    if (b.dataset.ai) return aiRun(`/ai/evidence/${b.dataset.ai}/analyse`, reload);
    if (b.dataset.aitask) return aiRun(`/ai/deals/${id}/${b.dataset.aitask}`, reload);
    if (b.dataset.aireview) return aiReview(analyses.find((x) => x.id == b.dataset.aireview), b.dataset.v, reload);
  };
}

async function aiRun(path, reload) {
  toast("Asking the AI… this can take a few seconds");
  try { await api(path, { method: "POST", json: { language: localStorage.getItem("lang") || "en" } }); reload(); } catch (err) { toast(err.message); }
}

/** Human confirmation: the person can correct simple values before confirming. */
async function aiReview(a, action, reload) {
  let values;
  if (action === "confirm") {
    const editable = Object.entries(a.output).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
    const form = await askForm("Check the AI draft against the original evidence", editable.map(([k, v]) => ({ name: k, label: k.replace(/_/g, " "), value: v ?? "", required: false })),
      "Confirm these values", "Correct anything that does not match the photo or document. Only values you confirm are used.");
    if (!form) return;
    values = { ...a.output };
    for (const [k, v] of Object.entries(a.output)) {
      if (!(k in form)) continue;
      if (typeof v === "number" || (v === null && form[k] !== "" && !isNaN(Number(form[k])))) values[k] = form[k] === "" ? null : Number(form[k]);
      else if (typeof v === "boolean") values[k] = form[k] === "true";
      else values[k] = form[k] === "" ? null : form[k];
    }
  }
  try { await api(`/ai/${a.id}/review`, { method: "POST", json: { action, values } }); toast(action === "confirm" ? "Confirmed" : "Rejected"); reload(); } catch (err) { toast(err.message); }
}

function evidenceDialog(dealId, done) {
  let picked = null;
  const cats = Object.keys(LABELS).filter((k) => ["quality_measurement", "lactometer_photo", "delivery_photo", "collection_receipt", "payment_receipt", "other"].includes(k));
  const d = dialog(`<form id="ef"><h2>Add evidence</h2>
    <label>Type<select name="category">${cats.map((c) => `<option value="${c}">${esc(label(c))}</option>`).join("")}</select></label>
    <div class="btns"><button type="button" id="cam" class="gold">Take photo</button><label class="ghost" style="margin:0;display:inline-flex;align-items:center;padding:0 14px;border:1px solid var(--deep);border-radius:12px;min-height:46px;cursor:pointer">Choose file<input id="pick" type="file" accept="image/*,application/pdf" hidden></label></div>
    <p class="mute" id="pk">No file selected.</p>
    <label>Typed measurement (e.g. lactometer reading)<input name="measurement" inputmode="decimal"></label>
    <label>Note<textarea name="note"></textarea></label>
    <div class="btns"><button class="gold" type="submit">Save evidence</button><button type="button" class="ghost" id="x">Cancel</button></div>
    <p class="mute">Original files are kept unchanged and cannot be deleted.</p></form>`);
  const setFile = (f) => { picked = f; $("#pk", d).textContent = f ? `Selected: ${f.name}` : "No file selected."; };
  $("#cam", d).onclick = async () => { const f = await captureFromCamera(); if (f) setFile(f); };
  $("#pick", d).onchange = (e) => setFile(e.target.files[0] || null);
  $("#x", d).onclick = closeDialog;
  $("#ef", d).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (picked) fd.append("file", picked);
    fd.append("captured_at", new Date().toISOString());
    try { await api(`/deals/${dealId}/evidence`, { method: "POST", form: fd }); closeDialog(); toast("Evidence saved"); done(); } catch (err) { toast(err.message); }
  };
}

async function viewDispute(id) {
  const r = await api(`/disputes/${id}`);
  const open = r.dispute.status === "open";
  const party = ["seller", "buyer"].includes(r.my_role);
  page(`<div class="row"><h1>Dispute</h1>${badge(open ? "disputed" : "completed")}</div>
    <div class="card"><b>Reason</b><p>${esc(r.dispute.reason)}</p><a href="#/deals/${r.deal.id}">View transaction ${esc(r.deal.public_id)}</a>
      ${r.dispute.final_outcome ? `<div class="note"><b>Final outcome:</b> ${esc(r.dispute.final_outcome)}</div>` : ""}</div>
    ${open ? `<div class="btns">${r.my_role !== "driver" ? `<button data-d="comment">Add comment</button>` : ""}${party ? `<button data-d="proposal" class="gold">Propose resolution</button><button data-d="evidence" class="ghost">Attach evidence</button>` : ""}${["oversight"].includes(r.my_role) && ["coop_admin", "admin"].includes(state.user.role) ? `<button data-d="resolve" class="danger">Record final outcome</button>` : ""}</div>` : ""}
    <h2>Evidence from both parties</h2>${r.evidence.length ? r.evidence.map((e) => `<div class="card"><b>${esc(label(e.category))}</b> · ${esc(e.submitted_by.full_name)} (${esc(label(e.submitted_by.role))})${e.measurement ? `<div>Measurement: ${esc(e.measurement)}</div>` : ""}${e.note ? `<div>${esc(e.note)}</div>` : ""}
      ${e.has_file && e.mime_type.startsWith("image/") ? `<img class="thumb" alt="" src="/api/evidence/${e.id}/file">` : ""}<div class="mute">${when(e.created_at)}</div></div>`).join("") : empty("No evidence submitted.")}
    <h2>Discussion</h2><ul class="timeline">${r.events.map((e) => `<li><b>${esc(e.full_name)}</b> (${esc(label(e.user_role))}) · ${esc(e.kind)}<div>${esc(e.body || "")}</div>
      ${e.kind === "proposal" && open && party && e.user_id !== state.user.id ? `<button class="small gold" data-agree="${e.id}">I agree to this</button>` : ""}<div class="mute">${when(e.created_at)}</div></li>`).join("") || "<li class='mute'>No messages yet.</li>"}</ul>`);
  view.onclick = async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const post = async (json) => { try { await api(`/disputes/${id}/events`, { method: "POST", json }); route(); } catch (e) { toast(e.message); } };
    if (b.dataset.agree) { if (confirm("Agree to this proposal? This resolves the dispute.")) post({ kind: "agree", ref_event_id: Number(b.dataset.agree) }); return; }
    if (b.dataset.d === "comment" || b.dataset.d === "proposal") { const v = await askForm(b.dataset.d === "proposal" ? "Propose a resolution" : "Add comment", [{ name: "body", label: "Message", type: "textarea" }]); if (v) post({ kind: b.dataset.d, body: v.body }); }
    if (b.dataset.d === "evidence") {
      const v = await askForm("Attach evidence", [{ name: "evidence_id", label: "Evidence", type: "select", options: r.evidence.map((e) => [e.id, `${label(e.category)} #${e.id}`]) }, { name: "body", label: "Why it matters", type: "textarea" }]);
      if (v) post({ kind: "evidence", evidence_id: Number(v.evidence_id), body: v.body });
    }
    if (b.dataset.d === "resolve") {
      const v = await askForm("Record final outcome", [{ name: "outcome", label: "Agreed outcome", type: "textarea" }], "Record");
      if (v) { try { await api(`/disputes/${id}/resolve`, { method: "POST", json: v }); route(); } catch (e) { toast(e.message); } }
    }
  };
}

function viewProfile() {
  const u = state.user;
  page(`<h1>My profile</h1><form id="f" class="card"><div id="e"></div><p>${badge(u.role)} <span class="mute">${esc(u.phone)}</span></p>
    <label>Full name<input name="full_name" value="${esc(u.full_name)}" required></label><label>Email (optional)<input name="email" type="email" value="${esc(u.email || "")}"></label>
    <label>District<input name="district" value="${esc(u.district || "")}"></label><label>Cooperative / company<input name="organisation" value="${esc(u.organisation || "")}"></label>
    <button class="full">Save profile</button></form>
    <form id="p" class="card"><h2>Change password</h2><label>Current password<input name="current_password" type="password" required></label><label>New password<input name="new_password" type="password" minlength="8" required></label><button class="full">Change password</button></form>
    <div class="card"><label>AI language (experimental)<select id="lang"><option value="en">English</option><option value="rw">Kinyarwanda</option></select></label></div>`);
  $("#lang").value = localStorage.getItem("lang") || "en";
  $("#lang").onchange = (e) => localStorage.setItem("lang", e.target.value);
  $("#f").onsubmit = async (e) => { e.preventDefault(); try { const r = await api("/auth/me", { method: "PATCH", json: Object.fromEntries(new FormData(e.target)) }); state.user = r.user; toast("Profile saved"); } catch (err) { $("#e").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
  $("#p").onsubmit = async (e) => { e.preventDefault(); try { await api("/auth/password", { method: "POST", json: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast("Password changed"); } catch (err) { toast(err.message); } };
}

async function viewAdmin() {
  const r = await api("/admin/users");
  page(`<h1>Users</h1><form id="f" class="card"><h2>Create cooperative / admin account</h2>
    <label>Role<select name="role"><option value="coop_admin">Cooperative admin</option><option value="admin">System admin</option></select></label>
    <label>Name<input name="full_name" required></label><label>Phone<input name="phone" required></label><label>District<input name="district"></label>
    <label>Organisation<input name="organisation"></label><label>Temporary password<input name="password" required></label><button class="full">Create</button></form>
    ${r.users.map((u) => `<div class="card row"><div><b>${esc(u.full_name)}</b> ${badge(u.role)}<div class="mute">${esc(u.phone)} · ${esc(u.district || "")}</div></div>
      <button class="small ${u.is_active ? "danger" : ""}" data-u="${u.id}" data-a="${u.is_active ? 0 : 1}">${u.is_active ? "Disable" : "Enable"}</button></div>`).join("")}`);
  $("#f").onsubmit = async (e) => { e.preventDefault(); try { await api("/admin/users", { method: "POST", json: Object.fromEntries(new FormData(e.target)) }); toast("Created"); route(); } catch (err) { toast(err.message); } };
  view.onclick = async (ev) => { const b = ev.target.closest("button[data-u]"); if (b) { try { await api(`/admin/users/${b.dataset.u}`, { method: "PATCH", json: { is_active: b.dataset.a === "1" } }); route(); } catch (err) { toast(err.message); } } };
}

/* ---------------------------------------------------------------- router */
async function loadMe() {
  try { const r = await api("/auth/me"); state.user = r.user; state.aiEnabled = r.ai_enabled; } catch { state.user = null; }
}

async function route() {
  view.onclick = null;
  const [path] = (location.hash || "#/dashboard").slice(1).split("?");
  const parts = path.split("/").filter(Boolean);
  if (!state.user) await loadMe();
  renderNav();
  try {
    if (!state.user && !["login", "register"].includes(parts[0])) { location.hash = "#/login"; return; }
    if (state.user && ["login", "register"].includes(parts[0])) { location.hash = "#/dashboard"; return; }
    switch (parts[0]) {
      case "login": return viewLogin();
      case "register": return viewRegister();
      case "dashboard": return await viewDashboard();
      case "deals": return parts[1] ? await viewDeal(parts[1]) : await viewDeals();
      case "market": return await viewMarket();
      case "jobs": return await viewJobs();
      case "new": return viewNew();
      case "disputes": return await viewDispute(parts[1]);
      case "profile": return viewProfile();
      case "admin": return await viewAdmin();
      default: location.hash = "#/dashboard";
    }
  } catch (err) { page(`<div class="err">${esc(err.message)}</div><a href="#/dashboard">Back to home</a>`); }
  renderNav();
}

$("#logoutBtn").onclick = async () => { await api("/auth/logout", { method: "POST", json: {} }).catch(() => {}); state.user = null; location.hash = "#/login"; renderNav(); };
window.addEventListener("hashchange", route);
route();
