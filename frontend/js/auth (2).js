// Login and registration pages.
import { api, apiConfig } from './api.js';
import { DISTRICTS, ROLE_LABEL, esc } from './ui.js';

apiConfig.redirectOn401 = false;   // a 401 on the login page just means "wrong password"
const show = (msg) => { const e = document.getElementById('err'); e.textContent = msg; e.classList.toggle('hidden', !msg); };

// If someone is already logged in, skip straight to the app.
api.get('/auth/me').then(() => { location.href = '/app.html'; }).catch(() => {});

const login = document.getElementById('login');
if (login) {
  login.addEventListener('submit', async (e) => {
    e.preventDefault(); show('');
    try {
      await api.post('/auth/login', { phone: login.phone.value, password: login.password.value });
      location.href = '/app.html';
    } catch (err) { show(err.message); }
  });
}

const reg = document.getElementById('register');
if (reg) {
  const ROLES = [['farmer', 'Farmer', 'I sell milk'], ['buyer', 'Buyer', 'I buy milk'], ['driver', 'Driver / rider', 'I deliver milk'], ['collector', 'Supplier / collector', 'I gather and sell'], ['coop_admin', 'Cooperative', 'I manage a cooperative']];
  let role = 'farmer';
  const rolesEl = document.getElementById('roles');
  const extra = document.getElementById('extra');
  document.getElementById('district').innerHTML = '<option value="">Choose district</option>' + DISTRICTS.map((d) => `<option>${esc(d)}</option>`).join('');
  const drawRoles = () => {
    rolesEl.innerHTML = ROLES.map(([v, l, s]) => `<button type="button" class="role-opt ${v === role ? 'on' : ''}" data-role="${v}">${esc(l)}<small>${esc(s)}</small></button>`).join('');
    extra.innerHTML = role === 'driver'
      ? '<label for="vehicle_type">Vehicle</label><select id="vehicle_type"><option>motorcycle</option><option>bicycle</option><option>car</option><option>truck</option></select>'
      : role === 'coop_admin'
        ? '<label for="cooperative_name">Cooperative name *</label><input id="cooperative_name" required>'
        : '<label for="business_name">Business / farm name (optional)</label><input id="business_name">';
  };
  rolesEl.addEventListener('click', (e) => { const b = e.target.closest('[data-role]'); if (b) { role = b.dataset.role; drawRoles(); } });
  drawRoles();
  reg.addEventListener('submit', async (e) => {
    e.preventDefault(); show('');
    const val = (id) => (document.getElementById(id) || {}).value || '';
    const body = { role, full_name: val('full_name'), phone: val('phone'), password: val('password'), district: val('district'), consent: document.getElementById('consent').checked };
    if (role === 'driver') body.vehicle_type = val('vehicle_type');
    else if (role === 'coop_admin') body.cooperative_name = val('cooperative_name');
    else if (val('business_name')) body.business_name = val('business_name');
    for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
    try { await api.post('/auth/register', body); location.href = '/app.html'; }
    catch (err) { show(err.message); }
  });
}
