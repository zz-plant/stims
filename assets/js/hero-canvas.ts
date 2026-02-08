import { createUnifiedInput } from './utils';

/**
 * Hero Canvas - Ambient particle animation for the landing page
 * Creates a mesmerizing, audio-reactive-ready particle field with
 * gradient orbs and flowing connections
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
  saturation: number;
  lightness: number;
  alpha: number;
  pulsePhase: number;
  pulseSpeed: number;
}

interface GlowOrb {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  radius: number;
  hue: number;
  alpha: number;
  speed: number;
}

interface HeroCanvasConfig {
  particleCount?: number;
  orbCount?: number;
  connectionDistance?: number;
  speedFactor?: number;
  colorScheme?: 'cosmic' | 'aurora' | 'sunset';
}

const COLOR_SCHEMES = {
  cosmic: { baseHue: 240, hueRange: 60, saturation: 70, lightness: 55 },
  aurora: { baseHue: 160, hueRange: 80, saturation: 75, lightness: 50 },
  sunset: { baseHue: 20, hueRange: 40, saturation: 85, lightness: 55 },
};

export function initHeroCanvas(
  canvas: HTMLCanvasElement,
  config: HeroCanvasConfig = {},
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const {
    particleCount = 80,
    orbCount = 4,
    connectionDistance = 120,
    speedFactor = 1,
    colorScheme = 'cosmic',
  } = config;

  const scheme = COLOR_SCHEMES[colorScheme];
  const particles: Particle[] = [];
  const orbs: GlowOrb[] = [];
  let animationId: number | null = null;
  let width = 0;
  let height = 0;
  let time = 0;
  let mouseX = -1000;
  let mouseY = -1000;
  let isReducedMotion = false;

  // Check for reduced motion preference
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    isReducedMotion = mq.matches;
    mq.addEventListener('change', (e) => {
      isReducedMotion = e.matches;
    });
  } catch {
    // Fallback for older browsers
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx?.scale(dpr, dpr);

    // Reinitialize particles on resize
    initParticles();
    initOrbs();
  }

  function initParticles() {
    particles.length = 0;
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.5 * speedFactor,
        vy: (Math.random() - 0.5) * 0.5 * speedFactor,
        radius: Math.random() * 2 + 1.5,
        hue: scheme.baseHue + (Math.random() - 0.5) * scheme.hueRange,
        saturation: scheme.saturation + Math.random() * 15,
        lightness: scheme.lightness + Math.random() * 15,
        alpha: Math.random() * 0.5 + 0.3,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.02 + Math.random() * 0.02,
      });
    }
  }

  function initOrbs() {
    orbs.length = 0;
    for (let i = 0; i < orbCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      orbs.push({
        x,
        y,
        targetX: x,
        targetY: y,
        radius: 150 + Math.random() * 200,
        hue: scheme.baseHue + (i / orbCount) * scheme.hueRange * 2,
        alpha: 0.08 + Math.random() * 0.08,
        speed: 0.001 + Math.random() * 0.002,
      });
    }
  }

  function updateOrbs() {
    for (const orb of orbs) {
      // Drift towards target
      orb.x += (orb.targetX - orb.x) * 0.003;
      orb.y += (orb.targetY - orb.y) * 0.003;

      // Occasionally pick new target
      if (Math.random() < 0.002) {
        orb.targetX = Math.random() * width;
        orb.targetY = Math.random() * height;
      }

      // Subtle hue shift
      orb.hue = (orb.hue + 0.05) % 360;
    }
  }

  function updateParticles() {
    for (const p of particles) {
      // Move
      p.x += p.vx;
      p.y += p.vy;

      // Pulse
      p.pulsePhase += p.pulseSpeed;

      // Mouse interaction - gentle push
      const dx = p.x - mouseX;
      const dy = p.y - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 150 && dist > 0) {
        const force = (150 - dist) / 150;
        const angle = Math.atan2(dy, dx);
        p.vx += Math.cos(angle) * force * 0.02;
        p.vy += Math.sin(angle) * force * 0.02;
      }

      // Gentle slowdown
      p.vx *= 0.995;
      p.vy *= 0.995;

      // Wrap around edges with margin
      const margin = 20;
      if (p.x < -margin) p.x = width + margin;
      if (p.x > width + margin) p.x = -margin;
      if (p.y < -margin) p.y = height + margin;
      if (p.y > height + margin) p.y = -margin;

      // Gradual hue drift
      p.hue = (p.hue + 0.02) % 360;
    }
  }

  function drawOrbs() {
    if (!ctx) return;
    for (const orb of orbs) {
      const gradient = ctx.createRadialGradient(
        orb.x,
        orb.y,
        0,
        orb.x,
        orb.y,
        orb.radius,
      );
      gradient.addColorStop(
        0,
        `hsla(${orb.hue}, 80%, 60%, ${orb.alpha * 1.5})`,
      );
      gradient.addColorStop(
        0.5,
        `hsla(${orb.hue + 20}, 70%, 50%, ${orb.alpha})`,
      );
      gradient.addColorStop(1, 'transparent');

      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }

  function drawConnections() {
    if (!ctx) return;
    ctx.lineWidth = 0.5;

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const p1 = particles[i];
        const p2 = particles[j];
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < connectionDistance) {
          const alpha = (1 - dist / connectionDistance) * 0.15;
          const hue = (p1.hue + p2.hue) / 2;
          ctx.strokeStyle = `hsla(${hue}, ${scheme.saturation}%, ${scheme.lightness}%, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
  }

  function drawParticles() {
    if (!ctx) return;
    for (const p of particles) {
      const pulse = Math.sin(p.pulsePhase) * 0.3 + 1;
      const radius = p.radius * pulse;
      const alpha = p.alpha * (0.7 + pulse * 0.3);

      // Glow effect
      const gradient = ctx.createRadialGradient(
        p.x,
        p.y,
        0,
        p.x,
        p.y,
        radius * 3,
      );
      gradient.addColorStop(
        0,
        `hsla(${p.hue}, ${p.saturation}%, ${p.lightness}%, ${alpha})`,
      );
      gradient.addColorStop(
        0.4,
        `hsla(${p.hue}, ${p.saturation}%, ${p.lightness}%, ${alpha * 0.4})`,
      );
      gradient.addColorStop(1, 'transparent');

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, ${p.saturation}%, ${p.lightness + 20}%, ${alpha + 0.2})`;
      ctx.fill();
    }
  }

  function draw() {
    if (!ctx) return;

    // Clear with slight trail effect for smoother animation
    ctx.fillStyle = 'rgba(11, 15, 26, 0.15)';
    ctx.fillRect(0, 0, width, height);

    // Full clear occasionally to prevent artifacts
    if (time % 60 === 0) {
      ctx.fillStyle = '#0b0f1a';
      ctx.fillRect(0, 0, width, height);
    }

    drawOrbs();
    drawConnections();
    drawParticles();
  }

  function animate() {
    time++;

    if (!isReducedMotion) {
      updateOrbs();
      updateParticles();
    }

    draw();
    animationId = requestAnimationFrame(animate);
  }

  // Initialize
  resize();

  // Event listeners
  window.addEventListener('resize', resize);
  const unifiedInput = createUnifiedInput({
    target: canvas,
    boundsElement: canvas,
    onInput: (state) => {
      if (state.primary) {
        mouseX = ((state.primary.normalizedX + 1) / 2) * width;
        mouseY = ((1 - state.primary.normalizedY) / 2) * height;
      } else {
        mouseX = -1000;
        mouseY = -1000;
      }
    },
  });

  // Start animation
  animate();

  // Return cleanup function
  return () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    window.removeEventListener('resize', resize);
    unifiedInput.dispose();
  };
}

// Auto-initialize if data attribute is present
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const canvas =
      document.querySelector<HTMLCanvasElement>('[data-hero-canvas]');
    if (canvas) {
      const scheme =
        (canvas.dataset.colorScheme as 'cosmic' | 'aurora' | 'sunset') ||
        'cosmic';
      initHeroCanvas(canvas, { colorScheme: scheme });
    }
  });
}
