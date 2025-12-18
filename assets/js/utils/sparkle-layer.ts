interface Sparkle {
  x: number;
  y: number;
  size: number;
  life: number;
  ttl: number;
  hue: number;
}

export type SparkleLayerOptions = {
  maxParticles?: number;
  pixelRatio?: number;
  throttleMs?: number;
};

export function createSparkleLayer(
  host: HTMLElement,
  options: SparkleLayerOptions = {}
) {
  const { maxParticles = 120, pixelRatio = window.devicePixelRatio || 1 } =
    options;
  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.mixBlendMode = 'screen';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles: Sparkle[] = new Array(maxParticles)
    .fill(null)
    .map(() => ({ x: 0, y: 0, size: 0, life: 0, ttl: 0, hue: 0 }));
  let activeCount = 0;
  let lastSpawn = 0;

  function resize(width: number, height: number) {
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  function spawn(count = 6) {
    const now = performance.now();
    if (now - lastSpawn < 40) return;
    lastSpawn = now;
    for (let i = 0; i < count; i += 1) {
      const target =
        activeCount < maxParticles ? activeCount : i % maxParticles;
      const p = particles[target];
      p.x = Math.random() * canvas.width;
      p.y = Math.random() * canvas.height;
      p.size = (Math.random() * 2 + 1) * pixelRatio;
      p.ttl = 400 + Math.random() * 400;
      p.life = p.ttl;
      p.hue = Math.random() * 360;
      if (activeCount < maxParticles) {
        activeCount += 1;
      }
    }
  }

  function update(deltaMs: number) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < activeCount; i += 1) {
      const p = particles[i];
      if (p.life <= 0) continue;
      p.life -= deltaMs;
      const alpha = Math.max(p.life / p.ttl, 0);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 80%, 65%, ${alpha})`;
      ctx.arc(p.x, p.y, p.size * (0.5 + alpha), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { canvas, resize, spawn, update };
}
