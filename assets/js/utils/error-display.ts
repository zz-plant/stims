export function showError(id: string, message: string) {
  const el = document.getElementById(id);
  if (!el) return;

  el.textContent = message;
  el.style.display = 'block';
}

export function clearError(id: string) {
  const el = document.getElementById(id);
  if (!el) return;

  el.textContent = '';
  el.style.display = 'none';
}
