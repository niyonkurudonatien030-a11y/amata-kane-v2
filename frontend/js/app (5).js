/* Ingazi front end. Plain JavaScript, no build step.
   Safety rule: user text is only ever added with textContent / createTextNode (never innerHTML),
   so a post containing <script> is shown as harmless text. */
(() => {
  "use strict";
  const API = "/api";
  const TOKEN_KEY = "ingazi_token";
  const VIEWS = ["auth", "feed", "jobs", "people", "trust", "me"];

  // sessionStorage forgets the token when the tab closes. Production should use HttpOnly cookies.
  const store = {
    get(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  let token = store.get(TOKEN_KEY);
  let me = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid);
    }
    return node;
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    const box = $("#toast");
    box.textContent = message;
    box.className = "toast" + (isError ? " error" : "");
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
  }
  const fail = (err) => toast(err && err.message ? err.message : "Something went wrong.", true);

  function describeError(data, status) {
    if (!data) return `Request failed (${status}).`;
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data)) return data.join(" ");
    const parts = Object.entries(data).map(([field, msgs]) => {
      const text = Array.isArray(msgs) ? msgs.join(" ") : String(msgs);
      return field === "non_field_errors" ? text : `${field}: ${text}`;
    });
    return parts.join(" | ") || `Request failed (${status}).`;
  }

  async function api(path, { method = "GET", body, auth = true } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token && auth) headers.Authorization = `Token ${token}`;
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error("Cannot reach the server. Check your connection.");
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (res.status === 401 && token && auth) {
      clearSession();               // the saved token is no longer valid
      if (method === "GET") return api(path, { method });   // public pages still work as a visitor
      showView("auth");
      throw new Error("Your session ended. Please sign in again.");
    }
    if (!res.ok) throw new Error(describeError(data, res.status));
    return data;
  }

  const displayName = (u) => `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username;
  const when = (iso) => new Date(iso).toLocaleString();
  const safeUrl = (u) => /^https?:\/\//i.test(u || "");

  // ---------------------------------------------------------------- session ---
  function clearSession() { token = null; me = null; store.del(TOKEN_KEY); updateChrome(); }

  async function setSession(newToken) {
    token = newToken;
    store.set(TOKEN_KEY, token);
    await loadMe();
  }

  async function loadMe() {
    if (!token) { me = null; updateChrome(); return; }
    try { me = await api("/me/"); } catch (e) { me = null; }
    updateChrome();
  }

  function updateChrome() {
    const signedIn = !!me;
    $("#who-name").textContent = signedIn ? displayName(me) : "Visitor";
    $("#btn-signout").hidden = !signedIn;
    $("#btn-signin").hidden = signedIn;
    $("#nav-me").hidden = !signedIn;
    $("#form-post").hidden = !signedIn;
    $("#feed-gate").hidden = signedIn;
    $("#job-publish").hidden = !signedIn;
    $("#trust-forms").hidden = !signedIn;
    $("#cases").hidden = !signedIn;
    $("#trust-gate").hidden = signedIn;
  }

  // ----------------------------------------------------------------- routing ---
  function showView(name) {
    if (!VIEWS.includes(name)) name = me ? "feed" : "auth";
    if (name === "me" && !me) name = "auth";
    VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== name; });
    $$(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
    if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    if (name === "feed") loadFeed(true).catch(fail);
    if (name === "jobs") loadJobs(true).catch(fail);
    if (name === "people") loadPeople(true).catch(fail);
    if (name === "trust" && me) loadCases().catch(fail);
    if (name === "me" && me) fillProfileForm();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------- lists ---
  function makePager(listEl, moreBtn, path, getParams, renderItem, emptyText) {
    let page = 1;
    async function load(reset) {
      if (reset) { page = 1; listEl.replaceChildren(); }
      const params = new URLSearchParams(getParams());
      params.set("page", String(page));
      const data = await api(`${path}?${params}`);
      if (reset && !data.results.length) listEl.append(el("p", { class: "note", text: emptyText }));
      data.results.forEach((row) => listEl.append(renderItem(row)));
      if (moreBtn) moreBtn.hidden = !data.next;
      page += 1;
    }
    if (moreBtn) moreBtn.addEventListener("click", () => load(false).catch(fail));
    return load;
  }

  function badge(user) {
    return user.is_verified_professional ? el("span", { class: "tag ok", text: "Verified professional" }) : null;
  }

  function reportButton(userId) {
    if (!me || userId === me.id) return null;
    return el("button", { class: "link", type: "button", text: "Report", onclick: () => startReport(userId) });
  }

  function renderPost(p) {
    const mine = me && p.author.id === me.id;
    return el("article", { class: "item" },
      el("header", {},
        el("h4", { text: displayName(p.author) }),
        el("span", { class: "meta", text: when(p.created_at) })),
      el("div", { class: "meta" }, `@${p.author.username} `, badge(p.author), p.author.headline ? ` · ${p.author.headline}` : ""),
      el("p", { class: "body", text: p.body }),
      el("div", { class: "actions" },
        reportButton(p.author.id),
        mine ? el("button", { class: "danger", type: "button", text: "Delete", onclick: async () => {
          if (!confirm("Delete this post?")) return;
          try { await api(`/posts/${p.id}/`, { method: "DELETE" }); await loadFeed(true); } catch (e) { fail(e); }
        } }) : null));
  }

  function renderJob(o) {
    const mine = me && o.publisher.id === me.id;
    const link = safeUrl(o.application_url)
      ? el("a", { href: o.application_url, target: "_blank", rel: "noopener noreferrer nofollow", text: "Apply / learn more" }) : null;
    return el("article", { class: "item" },
      el("header", {},
        el("h4", { text: o.title }),
        el("span", { class: "tag", text: o.kind })),
      el("div", { class: "meta" }, `${o.organisation}${o.location ? " · " + o.location : ""}${o.deadline ? " · deadline " + o.deadline : ""}`),
      o.applicants_pay_fee ? el("p", {}, el("span", { class: "tag warn", text: "Applicants are asked to pay a fee - check carefully" })) : null,
      el("p", { class: "body", text: o.description }),
      el("div", { class: "meta" }, "Published by ", el("b", { text: displayName(o.publisher) }), " ", badge(o.publisher)),
      el("div", { class: "actions" }, link, reportButton(o.publisher.id),
        mine ? el("button", { class: "danger", type: "button", text: "Close listing", onclick: async () => {
          try { await api(`/opportunities/${o.id}/`, { method: "PATCH", body: { is_open: false } }); await loadJobs(true); } catch (e) { fail(e); }
        } }) : null));
  }

  function renderPerson(u) {
    return el("article", { class: "item" },
      el("header", {}, el("h4", { text: displayName(u) }), el("span", { class: "meta", text: `@${u.username} · account ID ${u.id}` })),
      el("div", { class: "meta" }, badge(u), u.headline ? ` ${u.headline}` : "", u.location ? ` · ${u.location}` : ""),
      el("div", { class: "actions" }, reportButton(u.id)));
  }

  function renderAppeal(a) {
    return el("article", { class: "item" },
      el("header", {}, el("h4", { text: `${a.case_ref} · ${a.subject}` }), el("span", { class: "tag", text: a.status_display })),
      el("div", { class: "meta", text: `Filed ${when(a.created_at)} · updated ${when(a.updated_at)}` }),
      a.staff_response ? el("p", { class: "body", text: `Staff response: ${a.staff_response}` })
        : el("p", { class: "note", text: "A person will review this and answer in writing." }));
  }

  function renderReport(r) {
    return el("article", { class: "item" },
      el("header", {}, el("h4", { text: `${r.case_ref} · ${r.reason}` }), el("span", { class: "tag", text: r.status_display })),
      el("div", { class: "meta", text: `About account ID ${r.target_user} · filed ${when(r.created_at)}` }));
  }

  const loadFeed = makePager($("#feed-list"), $("#feed-more"), "/posts/", () => ({}), renderPost, "No posts yet. Be the first to share something useful.");
  const loadJobs = makePager($("#jobs-list"), $("#jobs-more"), "/opportunities/",
    () => ({ kind: $("#jobs-kind").value, q: $("#jobs-q").value.trim() }), renderJob, "No opportunities match your search.");
  const loadPeople = makePager($("#people-list"), $("#people-more"), "/profiles/",
    () => ({ q: $("#people-q").value.trim() }), renderPerson, "Nobody found.");
  const loadAppeals = makePager($("#appeals-list"), null, "/appeals/", () => ({}), renderAppeal, "You have no appeals.");
  const loadReports = makePager($("#reports-list"), null, "/reports/", () => ({}), renderReport, "You have not filed any reports.");
  const loadCases = () => Promise.all([loadAppeals(true), loadReports(true)]);

  function startReport(userId) {
    showView("trust");
    const input = $("#form-report [name=target_user]");
    if (input) { input.value = userId; input.focus(); }
  }

  function fillProfileForm() {
    const f = $("#form-me");
    f.first_name.value = me.first_name || "";
    f.last_name.value = me.last_name || "";
    f.headline.value = me.headline || "";
    f.location.value = me.location || "";
    $("#me-status").textContent = me.email_verified
      ? `Signed in as @${me.username}. Your e-mail ${me.email} is verified.`
      : `Signed in as @${me.username}. Your e-mail ${me.email} is NOT verified yet - open the link we sent you.`;
    $("#btn-resend").hidden = me.email_verified;
  }

  // ------------------------------------------------------------------- forms ---
  function formObject(form) {
    const out = {};
    new FormData(form).forEach((value, key) => { out[key] = typeof value === "string" ? value.trim() : value; });
    $$("input[type=checkbox]", form).forEach((box) => { out[box.name] = box.checked; });
    return out;
  }

  function onSubmit(selector, handler) {
    $(selector).addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = $("button[type=submit]", form);
      if (button) button.disabled = true;
      try { await handler(form, formObject(form)); } catch (e) { fail(e); } finally { if (button) button.disabled = false; }
    });
  }

  onSubmit("#form-register", async (form, data) => {
    const result = await api("/auth/register/", { method: "POST", body: data, auth: false });
    await setSession(result.token);
    form.reset();
    toast("Account created. Check your e-mail (in development it is printed in the server terminal) to verify it.");
    showView("feed");
  });

  onSubmit("#form-login", async (form, data) => {
    const result = await api("/auth/token/", { method: "POST", body: data, auth: false });
    await setSession(result.token);
    form.reset();
    showView("feed");
  });

  onSubmit("#form-post", async (form, data) => {
    await api("/posts/", { method: "POST", body: { body: data.body } });
    form.reset();
    toast("Post published.");
    await loadFeed(true);
  });

  onSubmit("#form-job", async (form, data) => {
    if (!data.deadline) delete data.deadline;
    await api("/opportunities/", { method: "POST", body: data });
    form.reset();
    $("#job-publish").open = false;
    toast("Opportunity published.");
    await loadJobs(true);
  });

  onSubmit("#form-report", async (form, data) => {
    data.target_user = Number(data.target_user);
    const r = await api("/reports/", { method: "POST", body: data });
    form.reset();
    toast(`Report received. Case reference ${r.case_ref}. A person will review it - it is not proof of anything.`);
    await loadReports(true);
  });

  onSubmit("#form-appeal", async (form, data) => {
    const a = await api("/appeals/", { method: "POST", body: data });
    form.reset();
    toast(`Appeal received. Case reference ${a.case_ref}.`);
    await loadAppeals(true);
  });

  onSubmit("#form-me", async (form, data) => {
    me = await api("/me/", { method: "PATCH", body: { first_name: data.first_name, last_name: data.last_name, headline: data.headline, location: data.location } });
    updateChrome();
    fillProfileForm();
    toast("Profile saved.");
  });

  // ----------------------------------------------------------------- buttons ---
  $$("[data-nav]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.nav)));
  $("#btn-signin").addEventListener("click", () => showView("auth"));
  $("#btn-signout").addEventListener("click", async () => {
    try { await api("/auth/logout/", { method: "POST" }); } catch (e) { /* token may already be invalid */ }
    clearSession();
    toast("Signed out. Your token was revoked on the server.");
    showView("auth");
  });
  $("#btn-resend").addEventListener("click", () => {
    api("/auth/resend-verification/", { method: "POST" }).then((r) => toast(r.detail)).catch(fail);
  });

  const debounce = (fn, ms = 300) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  $("#jobs-kind").addEventListener("change", () => loadJobs(true).catch(fail));
  $("#jobs-q").addEventListener("input", debounce(() => loadJobs(true).catch(fail)));
  $("#people-q").addEventListener("input", debounce(() => loadPeople(true).catch(fail)));
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

  // -------------------------------------------------------------------- start ---
  async function start() {
    const verify = new URLSearchParams(location.search).get("verify");
    if (verify) {
      try {
        const r = await api("/auth/verify-email/", { method: "POST", body: { token: verify }, auth: false });
        toast(r.detail);
      } catch (e) { fail(e); }
      history.replaceState(null, "", location.pathname + location.hash);
    }
    await loadMe();
    const wanted = location.hash.slice(1);
    showView(wanted || (me ? "feed" : "auth"));
  }
  start();
})();
