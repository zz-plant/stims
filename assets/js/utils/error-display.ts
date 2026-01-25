export function initErrorDisplay(id: string) {
  const el = document.getElementById(id);
  if (!el) return null;

  el.textContent = '';
  el.style.display = 'none';
  return el;
}

export function setErrorVisible(id: string, message?: string) {
  const el = document.getElementById(id);
  if (!el) return;

  if (message) {
    el.textContent = message;
    el.style.display = 'block';
    return;
  }

  el.textContent = '';
  el.style.display = 'none';
}

export function showError(id: string, message: string) {
  setErrorVisible(id, message);
}

export function clearError(id: string) {
  setErrorVisible(id);
}
