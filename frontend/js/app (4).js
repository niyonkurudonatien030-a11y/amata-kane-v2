const API = "/api";
const tokenKey = "ingazi_dev_token";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const token = () => localStorage.getItem(tokenKey);
const authHeaders = () => token() ? {"Authorization": `Token ${token()}`} : {};
function notice(message, isError=false) {
  const el = $("#notice"); el.textContent = message;
  el.className = `notice show${isError ? " error" : ""}`;
  window.scrollTo({top: 0, behavior: "smooth"});
}
function clearNotice(){ const el=$("#notice"); el.className="notice"; el.textContent=""; }
async function api(path, options={}) {
  const headers = {"Content-Type":"application/json", ...authHeaders(), ...(options.headers||{})};
  const response = await fetch(`${API}${path}`, {...options, headers});
  let data = {}; try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const detail = data.detail || Object.values(data).flat().join(" ") || `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}
function setSignedIn(signedIn) {
  $("#auth-panel").classList.toggle("hidden", signedIn);
  $("#app-grid").classList.toggle("hidden", !signedIn);
  $("#logout-btn").classList.toggle("hidden", !signedIn);
  $("#session-label").textContent = signedIn ? "Signed in" : "Visitor";
  if (signedIn) { loadFeed(); loadOpportunities(); loadPeople(); }
}
function showView(name) {
  $$(".view").forEach(v => v.classList.add("hidden"));
  const target = $(`#view-${name}`); if (target) target.classList.remove("hidden");
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view===name));
  clearNotice();
}
function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function displayName(person) {
  return [person.first_name, person.last_name].filter(Boolean).join(" ") || person.username || "Member";
}
async function loadFeed() {
  const list=$("#feed-list"); list.innerHTML='<div class="empty-state">Loading posts…</div>';
  try {
    const result=await api("/posts/"); const rows=result.results || result;
    list.innerHTML = rows.length ? rows.map(p=>`<article class="feed-card"><div class="card-meta"><div class="mini-avatar">${escapeHtml((p.author.username||"M")[0].toUpperCase())}</div><div><strong>${escapeHtml(displayName(p.author))}</strong><small>${escapeHtml(p.author.headline||"Community member")} · ${new Date(p.created_at).toLocaleString()}</small></div></div><div class="feed-body">${escapeHtml(p.body)}</div></article>`).join("") : '<div class="empty-state">No posts yet. Share the first useful idea.</div>';
  } catch(e) { list.innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}
async function loadOpportunities() {
  const list=$("#opportunity-list"); list.innerHTML='<div class="empty-state">Loading opportunities…</div>';
  try {
    const result=await api("/opportunities/"); const rows=result.results || result;
    list.innerHTML=rows.length ? rows.map(o=>`<article class="opportunity-card"><span class="tag">${escapeHtml(o.kind)}</span><h3>${escapeHtml(o.title)}</h3><div class="muted">${escapeHtml(o.organisation)} · ${escapeHtml(o.location||"Location not specified")}</div><p>${escapeHtml(o.description)}</p>${o.deadline?`<small class="muted">Deadline: ${escapeHtml(o.deadline)}</small>`:""}${o.application_url?`<p><a href="${escapeHtml(o.application_url)}" target="_blank" rel="noopener noreferrer">Application details ↗</a></p>`:""}</article>`).join("") : '<div class="empty-state">No opportunities have been published yet.</div>';
  } catch(e) { list.innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}
async function loadPeople() {
  const list=$("#people-list"); list.innerHTML='<div class="empty-state">Loading members…</div>';
  try {
    const result=await api("/profiles/"); const rows=result.results || result;
    list.innerHTML=rows.length ? rows.map(p=>`<article class="person-card"><div class="card-meta"><div class="mini-avatar">${escapeHtml((p.username||"M")[0].toUpperCase())}</div><div><strong>${escapeHtml(displayName(p))}</strong><small>${escapeHtml(p.headline||"Professional member")} · ${escapeHtml(p.location||"Location not added")}</small></div></div>${p.is_verified_professional?'<span class="tag">Reviewed professional</span>':""}<p class="muted small">Member ID: ${p.id}</p></article>`).join("") : '<div class="empty-state">No members found.</div>';
  } catch(e) { list.innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}
$("#register-form").addEventListener("submit", async e=>{
  e.preventDefault(); clearNotice();
  try { const data=await api("/auth/register/",{method:"POST",body:JSON.stringify(formObject(e.target))}); localStorage.setItem(tokenKey,data.token); e.target.reset(); setSignedIn(true); notice("Account created. Welcome to Ingazi."); }
  catch(err){notice(err.message,true);}
});
$("#login-form").addEventListener("submit", async e=>{
  e.preventDefault(); clearNotice();
  try { const data=await api("/auth/token/",{method:"POST",body:JSON.stringify(formObject(e.target))}); localStorage.setItem(tokenKey,data.token); e.target.reset(); setSignedIn(true); notice("You are signed in."); }
  catch(err){notice(err.message,true);}
});
$("#logout-btn").addEventListener("click",()=>{localStorage.removeItem(tokenKey);setSignedIn(false);notice("You have signed out.");});
$("#post-form").addEventListener("submit",async e=>{
  e.preventDefault(); try { await api("/posts/",{method:"POST",body:JSON.stringify(formObject(e.target))}); e.target.reset(); await loadFeed(); notice("Your post has been published."); } catch(err){notice(err.message,true);}
});
$("#opportunity-form").addEventListener("submit",async e=>{
  e.preventDefault(); const data=formObject(e.target); if(!data.deadline) delete data.deadline;
  try { await api("/opportunities/",{method:"POST",body:JSON.stringify(data)}); e.target.reset(); await loadOpportunities(); notice("Opportunity published."); } catch(err){notice(err.message,true);}
});
$("#report-form").addEventListener("submit",async e=>{
  e.preventDefault(); const data=formObject(e.target); data.target_user=Number(data.target_user);
  try { await api("/reports/",{method:"POST",body:JSON.stringify(data)}); e.target.reset(); notice("Report received for review. A report is not itself a finding of misconduct."); } catch(err){notice(err.message,true);}
});
$("#appeal-form").addEventListener("submit",async e=>{
  e.preventDefault(); try { await api("/appeals/",{method:"POST",body:JSON.stringify(formObject(e.target))}); e.target.reset(); notice("Appeal submitted. The current prototype records the appeal; staff workflow and status tracking are still to be built."); } catch(err){notice(err.message,true);}
});
$("#refresh-feed").addEventListener("click",loadFeed);
$("#refresh-opportunities").addEventListener("click",loadOpportunities);
$("#refresh-people").addEventListener("click",loadPeople);
$$("[data-view]").forEach(btn=>btn.addEventListener("click",()=>showView(btn.dataset.view)));
setSignedIn(Boolean(token()));
showView("feed");
