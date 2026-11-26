// Thin wrapper around fetch(). Every request carries the X-Requested-With header the server requires (CSRF guard).
export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export const apiConfig = { redirectOn401: true };

async function request(method, path, body, isForm = false) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'AmataShield' } };
  if (body !== undefined) {
    if (isForm) opts.body = body;               // FormData: the browser sets the multipart boundary itself
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  let res;
  try { res = await fetch('/api' + path, opts); }
  catch { throw new ApiError('No connection. Check your internet and try again.', 0, 'NETWORK'); }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) {
    if (res.status === 401 && apiConfig.redirectOn401) { location.href = '/login.html'; }
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.code);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, formData) => request('POST', p, formData, true),
};
