const API_URL = 'https://api.github.com/repos/zz-plant/stims';
const CACHE_KEY = 'repo-status:zz-plant/stims';

const formatCount = (count) =>
  typeof count === 'number' ? new Intl.NumberFormat('en-US').format(count) : '—';

const formatDate = (isoString) => {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const readCache = () => {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch (error) {
    return null;
  }
};

const writeCache = (data) => {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    // Ignore cache write errors
  }
};

const updateMetrics = (container, data) => {
  const starTarget = container.querySelector('[data-star-count]');
  const commitTarget = container.querySelector('[data-last-commit]');

  if (starTarget) {
    starTarget.textContent = formatCount(data?.stargazers_count);
  }

  if (commitTarget) {
    commitTarget.textContent = formatDate(data?.pushed_at);
  }
};

const showFallback = (container, message) => {
  const fallback = container.querySelector('[data-status-fallback]');
  if (!fallback) return;
  fallback.textContent = message;
  fallback.hidden = false;
};

const fetchRepoStatus = async () => {
  const response = await fetch(API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error('GitHub API request failed');
  }

  return response.json();
};

export const initRepoStatusWidget = async () => {
  const container = document.querySelector('[data-repo-status]');
  if (!container) return;

  const cached = readCache();
  if (cached) {
    updateMetrics(container, cached);
    return;
  }

  try {
    const data = await fetchRepoStatus();
    updateMetrics(container, data);
    writeCache(data);
  } catch (error) {
    showFallback(container, 'GitHub status is taking a break. Try again later.');
  }
};
