// Shared application state and tiny helpers used by all views.
export const S = { user: null, timers: [], rerender: () => {} };
export const go = (hash) => { if (location.hash === hash) S.rerender(); else location.hash = hash; };
export const isSeller = () => ['farmer', 'collector', 'coop_admin'].includes(S.user.role);
export const isBuyer = () => ['buyer', 'collector', 'coop_admin'].includes(S.user.role);
export const canTrade = () => ['farmer', 'buyer', 'collector', 'coop_admin'].includes(S.user.role);
export const aiLanguage = () => localStorage.getItem('as_lang') || 'en';
