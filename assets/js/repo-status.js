const API_URL = 'https://api.github.com/repos/zz-plant/stims';
const CACHE_KEY = 'repo-status:zz-plant/stims';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const formatCount = (count) =>
  typeof count === 'number'
    ? new Intl.NumberFormat('en-US').format(count)
    : '—';

const formatDate = (isoString) => {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const readCache = () => {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (!parsed || typeof parsed !== 'object') return null;

    const { payload, etag, timestamp } = parsed;
    if (!payload || typeof timestamp !== 'number') return null;

    return { payload, etag, timestamp };
  } catch (_error) {
    return null;
  }
};

const writeCache = (payload, etag) => {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        payload,
        etag: etag ?? null,
        timestamp: Date.now(),
      }),
    );
  } catch (_error) {
    // Ignore cache write errors
  }
};

const isCacheFresh = (entry) =>
  !entry || Date.now() - entry.timestamp < CACHE_TTL_MS;

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
  fallback.hidden = !message;
};

const fetchRepoStatus = async (etag) => {
  const headers = {
    Accept: 'application/vnd.github+json',
  };

  if (etag) {
    headers['If-None-Match'] = etag;
  }

  const response = await fetch(API_URL, {
    headers,
  });

  if (response.status === 304) {
    return { status: 'not_modified' };
  }

  if (
    response.status === 403 &&
    response.headers.get('X-RateLimit-Remaining') === '0'
  ) {
    const resetHeader = response.headers.get('X-RateLimit-Reset');
    const resetTimestamp = Number.parseInt(resetHeader ?? '', 10);
    const resetAt = Number.isFinite(resetTimestamp)
      ? new Date(resetTimestamp * 1000)
      : null;
    const error = new Error('GitHub rate limit exceeded');
    error.code = 'rate_limit';
    error.resetAt = resetAt;
    throw error;
  }

  if (!response.ok) {
    const error = new Error('GitHub API request failed');
    error.code = 'http_error';
    error.status = response.status;
    throw error;
  }

  const etagHeader = response.headers.get('ETag');
  const data = await response.json();

  return {
    status: 'ok',
    data,
    etag: etagHeader ?? etag ?? null,
  };
};

export const initRepoStatusWidget = async () => {
  const container = document.querySelector('[data-repo-status]');
  if (!container) return;

  const cached = readCache();
  const cacheIsFresh = isCacheFresh(cached);

  if (cached) {
    updateMetrics(container, cached.payload);
    if (!cacheIsFresh) {
      showFallback(container, 'Showing cached GitHub stats while we refresh…');
    } else {
      showFallback(container, '');
    }
  } else {
    showFallback(container, 'Loading GitHub stats…');
  }

  if (cacheIsFresh && cached) {
    return;
  }

  try {
    const result = await fetchRepoStatus(cached?.etag);

    if (result.status === 'not_modified' && cached) {
      writeCache(cached.payload, cached.etag);
      showFallback(container, '');
      return;
    }

    if (result.status === 'ok') {
      updateMetrics(container, result.data);
      writeCache(result.data, result.etag);
      showFallback(container, '');
    }
  } catch (error) {
    if (error?.code === 'rate_limit') {
      const resetMessage = error.resetAt
        ? `Retry after ${formatDate(error.resetAt.toISOString())}.`
        : 'Please try again later.';
      showFallback(
        container,
        `GitHub rate limit reached. ${cached ? 'Showing cached stats for now.' : 'Live metrics are paused.'} ${resetMessage}`,
      );
      return;
    }

    if (cached) {
      showFallback(
        container,
        `Connection hiccup. Showing cached GitHub stats from ${formatDate(
          new Date(cached.timestamp).toISOString(),
        )}.`,
      );
      return;
    }

    updateMetrics(container, null);
    showFallback(
      container,
      'GitHub status is taking a break. Try again later.',
    );
  }
};
