// Relative to this asset, including project-site deployments under a subpath.
const root = new URL('../', import.meta.url);
const key = 'finance-lab-task:' + root.pathname;
const localPreview = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
export function siteUrl(path) {
  const clean = path.replace(/^\//, '');
  // GitHub Pages keeps the API contract relative to the static package root.
  // The local demo server exposes the same contract at its origin root, so
  // namespacing the HTML under /team/ must not move requests to /team/api/.
  return new URL(clean, localPreview ? `${location.origin}/` : root).href;
}
export function rememberTask(id) {
  try { sessionStorage.setItem(key, id); } catch { /* Storage is optional. */ }
}
export function savedTask() {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
