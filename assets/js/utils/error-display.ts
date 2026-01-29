export function initErrorDisplay(id: string) {
  const el = document.getElementById(id);
  if (!el) return;

  el.textContent = '';
  el.style.display = 'none';
}

export function setErrorVisible(id: string, message?: string) {
  const el = document.getElementById(id);
  if (!el) return;

  if (message) {
    el.textContent = message;
    el.style.display = 'block';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

export function showError(id: string, message: string) {
  setErrorVisible(id, message);
}

export function clearError(id: string) {
  setErrorVisible(id);
}
