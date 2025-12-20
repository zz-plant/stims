export let disposeCalls = 0;

export function resetDisposeCalls() {
  disposeCalls = 0;
}

export function start({ container } = {}) {
  const marker = document.createElement('div');
  marker.setAttribute('data-fake-toy', 'true');
  marker.setAttribute('data-module', 'disposable');
  container?.appendChild(marker);

  return {
    dispose() {
      disposeCalls += 1;
      marker.remove();
    },
  };
}
