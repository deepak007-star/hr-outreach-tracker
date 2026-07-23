// Imperative confirm() that resolves via a React modal instead of window.confirm.
// Usage: const ok = await confirm('Delete this item?');
// Mount <ConfirmDialog /> once at the app root to activate.

let _open = null; // set by ConfirmDialog on mount

export function registerConfirmHandler(fn) { _open = fn; }

export function confirm(message, detail = '') {
  if (!_open) return Promise.resolve(window.confirm(message)); // fallback pre-mount
  return _open(message, detail);
}
