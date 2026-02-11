const ns = 'http://www.w3.org/2000/svg';

function applyAttributes(element, attributes = {}) {
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      element.setAttribute(key, String(value));
    }
  });
}

function createSvgContext(_slug, label) {
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.classList.add('toy-icon');

  const title = document.createElementNS(ns, 'title');
  title.textContent = label;
  svg.appendChild(title);

  const defs = document.createElementNS(ns, 'defs');
  svg.appendChild(defs);

  const createGradient = (type, id, stops, attrs = {}) => {
    const gradient = document.createElementNS(ns, `${type}Gradient`);
    applyAttributes(gradient, { id, ...attrs });

    stops.forEach(({ offset, color, opacity }) => {
      const stop = document.createElementNS(ns, 'stop');
      applyAttributes(stop, {
        offset,
        'stop-color': color,
        'stop-opacity': opacity,
      });
      gradient.appendChild(stop);
    });

    defs.appendChild(gradient);
    return `url(#${id})`;
  };

  const createNode = (tag, attributes = {}, children = []) => {
    const el = document.createElementNS(ns, tag);
    applyAttributes(el, attributes);
    children.forEach((child) => el.appendChild(child));
    return el;
  };

  const createPattern = (
    id,
    { width, height, units, ...attrs },
    children = [],
  ) => {
    const pattern = document.createElementNS(ns, 'pattern');
    applyAttributes(pattern, {
      id,
      width,
      height,
      patternUnits: units ?? 'userSpaceOnUse',
      ...attrs,
    });
    children.forEach((child) => pattern.appendChild(child));
    defs.appendChild(pattern);
    return `url(#${id})`;
  };

  return { svg, defs, createGradient, createPattern, createNode };
}

function addRings(svg, createNode, rings = []) {
  rings.forEach((ring) => {
    const circle = createNode('circle', {
      cx: ring.cx ?? 60,
      cy: ring.cy ?? 60,
      r: ring.r,
      fill: 'none',
      stroke: ring.stroke,
      'stroke-width': ring.strokeWidth ?? 2,
      'stroke-dasharray': ring.dash,
      'stroke-linecap': ring.linecap,
      opacity: ring.opacity,
      transform: ring.transform,
    });

    if (ring.animate) {
      const anim = createNode('animate', {
        attributeName: ring.animate.attributeName,
        values: ring.animate.values,
        dur: ring.animate.dur,
        repeatCount: 'indefinite',
      });
      circle.appendChild(anim);
    }
    svg.appendChild(circle);
  });
}

function addBurst(svg, createNode, options) {
  const { count = 12, length = 36, stroke, width = 2, opacity = 0.9 } = options;
  const group = createNode('g', { transform: 'translate(60 60)' });
  for (let i = 0; i < count; i += 1) {
    const line = createNode('line', {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: length,
      stroke,
      'stroke-width': width,
      'stroke-linecap': 'round',
      opacity,
      transform: `rotate(${(360 / count) * i}) translate(0 -6)`,
    });
    group.appendChild(line);
  }
  svg.appendChild(group);
  return group;
}

function addGrid(svg, createNode, createPattern, options) {
  const {
    cols = 5,
    rows = 5,
    size = 12,
    gap = 4,
    stroke = '#94a3b8',
    opacity = 0.4,
    origin = [20, 20],
    patternId = 'grid',
  } = options;
  const group = createNode('g', {
    transform: `translate(${origin[0]} ${origin[1]})`,
  });
  const tile = createNode('rect', {
    x: 0,
    y: 0,
    width: size,
    height: size,
    rx: 3,
    ry: 3,
    fill: 'none',
    stroke,
    'stroke-width': 1.5,
    opacity,
  });
  const gridPattern = createPattern(
    patternId,
    { width: size + gap, height: size + gap },
    [tile],
  );
  const gridWidth = cols * size + (cols - 1) * gap;
  const gridHeight = rows * size + (rows - 1) * gap;
  group.appendChild(
    createNode('rect', {
      x: 0,
      y: 0,
      width: gridWidth,
      height: gridHeight,
      fill: gridPattern,
    }),
  );
  svg.appendChild(group);
}

function addBars(svg, createNode, options) {
  const {
    count = 16,
    width = 5,
    minHeight = 12,
    maxHeight = 40,
    palette,
    baseY = 92,
    spacing = 2,
  } = options;
  const group = createNode('g', {});
  for (let i = 0; i < count; i += 1) {
    const height = minHeight + ((maxHeight - minHeight) * i) / (count - 1);
    const rect = createNode('rect', {
      x: 16 + i * (width + spacing),
      y: baseY - height,
      width,
      height,
      rx: 2,
      fill: palette[i % palette.length],
      opacity: 0.85,
    });
    group.appendChild(rect);
  }
  svg.appendChild(group);
}

function createToyIcon(toy) {
  const renderer = iconRenderers[toy.slug] || iconRenderers.default;
  return renderer(toy);
}

const iconTemplateCache = new Map();
const iconSymbolCache = new Map();
const iconSpriteId = 'toy-icon-sprite';

function ensureIconTemplate(toy) {
  if (!iconTemplateCache.has(toy.slug)) {
    iconTemplateCache.set(toy.slug, createToyIcon(toy));
  }
  return iconTemplateCache.get(toy.slug);
}

function createSymbolFromTemplate(template, symbolId) {
  const symbol = document.createElementNS(ns, 'symbol');
  symbol.setAttribute('id', symbolId);
  symbol.setAttribute(
    'viewBox',
    template.getAttribute('viewBox') ?? '0 0 120 120',
  );
  template.childNodes.forEach((node) => {
    if (node.nodeName.toLowerCase() === 'title') return;
    symbol.appendChild(node.cloneNode(true));
  });
  return symbol;
}

function ensureIconSprite() {
  const existing = document.getElementById(iconSpriteId);
  if (existing instanceof SVGSVGElement) return existing;
  const sprite = document.createElementNS(ns, 'svg');
  sprite.setAttribute('id', iconSpriteId);
  sprite.setAttribute('aria-hidden', 'true');
  sprite.setAttribute('focusable', 'false');
  sprite.classList.add('toy-icon-sprite');
  document.body?.appendChild(sprite);
  return sprite;
}

function ensureIconSymbol(toy) {
  if (!iconSymbolCache.has(toy.slug)) {
    const symbolId = `toy-icon-${toy.slug}`;
    const template = ensureIconTemplate(toy);
    const symbol = createSymbolFromTemplate(template, symbolId);
    ensureIconSprite().appendChild(symbol);
    iconSymbolCache.set(toy.slug, symbolId);
  }
  return iconSymbolCache.get(toy.slug);
}

const iconRenderers = {
  '3dtoy': (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );

    const glow = createGradient('radial', `glow-${toy.slug}`, [
      { offset: '0%', color: '#7dd3fc', opacity: 0.9 },
      { offset: '55%', color: '#38bdf8', opacity: 0.45 },
      { offset: '100%', color: '#0f172a', opacity: 0 },
    ]);

    svg.appendChild(
      createNode('circle', {
        cx: 60,
        cy: 60,
        r: 54,
        fill: glow,
      }),
    );

    const grid = createNode('g', { transform: 'translate(60 60) rotate(-15)' });
    for (let i = -40; i <= 40; i += 16) {
      grid.appendChild(
        createNode('line', {
          x1: i,
          y1: -48,
          x2: i,
          y2: 48,
          stroke: '#e2e8f0',
          'stroke-width': 1.2,
          opacity: 0.35,
        }),
      );
      grid.appendChild(
        createNode('line', {
          x1: -48,
          y1: i,
          x2: 48,
          y2: i,
          stroke: '#e2e8f0',
          'stroke-width': 1.2,
          opacity: 0.35,
        }),
      );
    }
    svg.appendChild(grid);

    const cube = createNode('path', {
      d: 'M 0 -18 L 16 -8 L 16 12 L 0 22 L -16 12 L -16 -8 Z',
      fill: '#22d3ee',
      opacity: 0.85,
      transform: 'translate(60 60)',
    });
    svg.appendChild(cube);

    addRings(svg, createNode, [
      {
        r: 46,
        stroke: '#a855f7',
        strokeWidth: 2.5,
        dash: '6 10',
        opacity: 0.8,
      },
      { r: 32, stroke: '#38bdf8', strokeWidth: 2, dash: '4 8', opacity: 0.7 },
    ]);

    addBurst(svg, createNode, {
      count: 10,
      length: 26,
      stroke: '#f472b6',
      width: 1.6,
      opacity: 0.65,
    });

    return svg;
  },

  'aurora-painter': (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const sky = createGradient(
      'linear',
      `aurora-${toy.slug}`,
      [
        { offset: '0%', color: '#0f172a' },
        { offset: '50%', color: '#1e293b' },
        { offset: '100%', color: '#0ea5e9' },
      ],
      { x1: '0%', x2: '0%', y1: '0%', y2: '100%' },
    );

    svg.appendChild(
      createNode('rect', {
        x: 6,
        y: 6,
        width: 108,
        height: 108,
        rx: 18,
        ry: 18,
        fill: sky,
      }),
    );

    const ribbons = [
      'M 12 78 C 34 64 48 52 74 46 C 94 42 112 48 116 62',
      'M 10 64 C 30 56 52 46 78 42 C 102 40 110 42 114 50',
      'M 14 90 C 28 80 46 68 70 62 C 92 58 112 60 118 70',
    ];
    const ribbonColors = ['#67e8f9', '#a5f3fc', '#f9a8d4'];
    ribbons.forEach((d, index) => {
      svg.appendChild(
        createNode('path', {
          d,
          fill: 'none',
          stroke: ribbonColors[index],
          'stroke-width': 6 - index,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          opacity: 0.8,
        }),
      );
    });

    addBurst(svg, createNode, {
      count: 16,
      length: 18,
      stroke: '#22d3ee',
      width: 1.4,
      opacity: 0.5,
    });

    return svg;
  },

  clay: (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const wheel = createGradient('radial', `clay-${toy.slug}`, [
      { offset: '0%', color: '#f97316', opacity: 0.9 },
      { offset: '60%', color: '#fb923c', opacity: 0.8 },
      { offset: '100%', color: '#451a03', opacity: 0.6 },
    ]);

    svg.appendChild(
      createNode('circle', {
        cx: 60,
        cy: 60,
        r: 52,
        fill: '#0f172a',
        opacity: 0.85,
      }),
    );

    addRings(svg, createNode, [
      { r: 42, stroke: '#fdba74', strokeWidth: 3, dash: '2 6', opacity: 0.8 },
      { r: 28, stroke: '#f97316', strokeWidth: 3.5, dash: '3 5', opacity: 0.7 },
    ]);

    svg.appendChild(
      createNode('circle', {
        cx: 60,
        cy: 60,
        r: 22,
        fill: wheel,
        stroke: '#f59e0b',
        'stroke-width': 2.4,
      }),
    );

    const tool = createNode('rect', {
      x: 46,
      y: 32,
      width: 10,
      height: 36,
      rx: 3,
      ry: 3,
      fill: '#1f2937',
      stroke: '#f97316',
      'stroke-width': 2,
    });
    svg.appendChild(tool);

    return svg;
  },

  evol: (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const nebula = createGradient('radial', `evol-${toy.slug}`, [
      { offset: '0%', color: '#8b5cf6', opacity: 0.9 },
      { offset: '55%', color: '#22d3ee', opacity: 0.55 },
      { offset: '100%', color: '#0f172a', opacity: 0.4 },
    ]);

    svg.appendChild(
      createNode('rect', {
        x: 8,
        y: 8,
        width: 104,
        height: 104,
        rx: 20,
        ry: 20,
        fill: '#020617',
      }),
    );

    svg.appendChild(
      createNode('circle', {
        cx: 60,
        cy: 60,
        r: 46,
        fill: nebula,
        opacity: 0.9,
      }),
    );

    const tendrils = [
      'M 24 72 C 40 56 52 48 62 40 C 74 28 96 24 104 38',
      'M 22 52 C 40 44 54 32 70 34 C 88 36 94 46 104 50',
      'M 32 82 C 46 74 58 70 72 60 C 84 50 92 48 104 56',
    ];
    tendrils.forEach((d, index) => {
      svg.appendChild(
        createNode('path', {
          d,
          fill: 'none',
          stroke: ['#a855f7', '#22d3ee', '#f472b6'][index],
          'stroke-width': 3,
          'stroke-linecap': 'round',
          opacity: 0.7,
        }),
      );
    });

    return svg;
  },

  geom: (toy) => {
    const { svg, createGradient, createPattern, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const gridStroke = createGradient(
      'linear',
      `geom-${toy.slug}`,
      [
        { offset: '0%', color: '#38bdf8' },
        { offset: '100%', color: '#c084fc' },
      ],
      { x1: '0%', x2: '100%', y1: '0%', y2: '0%' },
    );

    addGrid(svg, createNode, createPattern, {
      cols: 4,
      rows: 4,
      size: 18,
      gap: 8,
      stroke: gridStroke,
      opacity: 0.45,
      origin: [18, 18],
      patternId: `grid-${toy.slug}`,
    });

    const polygon = createNode('polygon', {
      points: '60,20 92,60 60,100 28,60',
      fill: 'none',
      stroke: '#22d3ee',
      'stroke-width': 3,
      'stroke-linejoin': 'round',
    });
    svg.appendChild(polygon);

    svg.appendChild(
      createNode('circle', {
        cx: 60,
        cy: 60,
        r: 12,
        fill: '#c084fc',
        opacity: 0.9,
      }),
    );
    return svg;
  },

  holy: (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const halo = createGradient('radial', `holy-${toy.slug}`, [
      { offset: '0%', color: '#fef9c3', opacity: 0.9 },
      { offset: '50%', color: '#facc15', opacity: 0.6 },
      { offset: '100%', color: '#7c2d12', opacity: 0 },
    ]);

    svg.appendChild(
      createNode('circle', { cx: 60, cy: 60, r: 50, fill: halo }),
    );

    addRings(svg, createNode, [
      { r: 44, stroke: '#fde047', strokeWidth: 3, dash: '3 8', opacity: 0.8 },
      { r: 30, stroke: '#fb7185', strokeWidth: 2, dash: '2 6', opacity: 0.7 },
      { r: 18, stroke: '#c084fc', strokeWidth: 2, dash: '1 4', opacity: 0.7 },
    ]);

    addBurst(svg, createNode, {
      count: 18,
      length: 20,
      stroke: '#f472b6',
      width: 1.4,
      opacity: 0.6,
    });
    return svg;
  },

  multi: (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const circles = [
      { r: 36, stroke: '#38bdf8', offset: '-6,-4' },
      { r: 30, stroke: '#f472b6', offset: '6,4' },
      { r: 24, stroke: '#22c55e', offset: '0,0' },
    ];

    const glow = createGradient('radial', `multi-${toy.slug}`, [
      { offset: '0%', color: '#38bdf8', opacity: 0.5 },
      { offset: '100%', color: '#0f172a', opacity: 0 },
    ]);

    svg.appendChild(
      createNode('circle', { cx: 60, cy: 60, r: 52, fill: glow }),
    );

    circles.forEach(({ r, stroke, offset }) => {
      const [dx, dy] = offset.split(',').map(Number);
      svg.appendChild(
        createNode('circle', {
          cx: 60 + dx,
          cy: 60 + dy,
          r,
          fill: 'none',
          stroke,
          'stroke-width': 3,
          opacity: 0.85,
        }),
      );
    });

    svg.appendChild(
      createNode('path', {
        d: 'M 38 66 Q 60 36 82 66',
        fill: 'none',
        stroke: '#e0f2fe',
        'stroke-width': 3,
        'stroke-linecap': 'round',
      }),
    );
    return svg;
  },

  seary: (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const swirl = createGradient(
      'linear',
      `seary-${toy.slug}`,
      [
        { offset: '0%', color: '#10b981' },
        { offset: '50%', color: '#22d3ee' },
        { offset: '100%', color: '#c084fc' },
      ],
      { x1: '0%', x2: '100%', y1: '0%', y2: '0%' },
    );

    svg.appendChild(
      createNode('rect', {
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rx: 16,
        fill: '#0b1020',
      }),
    );

    svg.appendChild(
      createNode('path', {
        d: 'M 18 60 C 30 30 66 30 70 60 C 74 88 102 88 106 60',
        fill: 'none',
        stroke: swirl,
        'stroke-width': 10,
        'stroke-linecap': 'round',
        opacity: 0.9,
      }),
    );

    addBurst(svg, createNode, {
      count: 14,
      length: 14,
      stroke: '#38bdf8',
      width: 1.2,
      opacity: 0.5,
    });
    return svg;
  },

  legible: (toy) => {
    const { svg, createNode } = createSvgContext(toy.slug, `${toy.title} icon`);
    svg.appendChild(
      createNode('rect', {
        x: 8,
        y: 16,
        width: 104,
        height: 88,
        rx: 12,
        fill: '#0b2e11',
        stroke: '#22c55e',
        'stroke-width': 2,
      }),
    );

    for (let row = 0; row < 6; row += 1) {
      svg.appendChild(
        createNode('rect', {
          x: 18,
          y: 26 + row * 12,
          width: 84,
          height: 6,
          rx: 2,
          fill: '#22c55e',
          opacity: 0.35 + row * 0.08,
        }),
      );
    }

    svg.appendChild(
      createNode('rect', {
        x: 18,
        y: 70,
        width: 30,
        height: 14,
        rx: 3,
        fill: '#16a34a',
        opacity: 0.9,
      }),
    );

    return svg;
  },

  symph: (toy) => {
    const { svg, createNode } = createSvgContext(toy.slug, `${toy.title} icon`);
    addBars(svg, createNode, {
      count: 14,
      width: 6,
      minHeight: 8,
      maxHeight: 50,
      baseY: 96,
      spacing: 3,
      palette: ['#38bdf8', '#a855f7', '#f472b6', '#22c55e'],
    });

    addRings(svg, createNode, [
      {
        r: 50,
        stroke: '#38bdf8',
        strokeWidth: 1.5,
        dash: '4 10',
        opacity: 0.35,
      },
      { r: 28, stroke: '#a855f7', strokeWidth: 2, dash: '2 6', opacity: 0.4 },
    ]);
    return svg;
  },

  'cube-wave': (toy) => {
    const { svg, createPattern, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    addGrid(svg, createNode, createPattern, {
      cols: 4,
      rows: 4,
      size: 16,
      gap: 6,
      stroke: '#475569',
      opacity: 0.5,
      origin: [20, 18],
      patternId: `grid-${toy.slug}`,
    });

    for (let i = 0; i < 5; i += 1) {
      const height = 10 + i * 6;
      svg.appendChild(
        createNode('rect', {
          x: 20 + i * 16,
          y: 70 - height,
          width: 14,
          height: height + 6,
          rx: 2,
          fill: ['#38bdf8', '#22c55e', '#a855f7', '#f59e0b', '#38bdf8'][i],
          opacity: 0.85,
        }),
      );
    }
    return svg;
  },

  'bubble-harmonics': (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const bubble = createGradient('radial', `bubble-${toy.slug}`, [
      { offset: '0%', color: '#e0f2fe', opacity: 0.9 },
      { offset: '50%', color: '#a5f3fc', opacity: 0.6 },
      { offset: '100%', color: '#38bdf8', opacity: 0.2 },
    ]);

    [36, 22, 14].forEach((r, index) => {
      svg.appendChild(
        createNode('circle', {
          cx: 60 + index * 8,
          cy: 60 - index * 6,
          r,
          fill: bubble,
          stroke: '#38bdf8',
          'stroke-width': 1.6 - index * 0.2,
          opacity: 0.8 - index * 0.15,
        }),
      );
    });

    addRings(svg, createNode, [
      { r: 48, stroke: '#a5f3fc', strokeWidth: 1.5, dash: '4 8', opacity: 0.5 },
      {
        r: 30,
        stroke: '#38bdf8',
        strokeWidth: 1.4,
        dash: '2 6',
        opacity: 0.55,
      },
    ]);
    return svg;
  },

  'cosmic-particles': (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const space = createGradient('radial', `cosmic-${toy.slug}`, [
      { offset: '0%', color: '#0f172a', opacity: 1 },
      { offset: '70%', color: '#0f172a', opacity: 0.8 },
      { offset: '100%', color: '#020617', opacity: 0.6 },
    ]);
    svg.appendChild(
      createNode('rect', {
        x: 8,
        y: 8,
        width: 104,
        height: 104,
        rx: 20,
        fill: space,
      }),
    );

    addRings(svg, createNode, [
      { r: 40, stroke: '#38bdf8', strokeWidth: 2, dash: '3 10', opacity: 0.7 },
      { r: 24, stroke: '#a855f7', strokeWidth: 2, dash: '2 6', opacity: 0.6 },
    ]);

    const orbitGroup = createNode('g', { transform: 'translate(60 60)' });
    const orbitColors = ['#38bdf8', '#f472b6', '#22c55e'];
    for (let i = 0; i < 9; i += 1) {
      const angle = (360 / 9) * i;
      const radius = 32 + (i % 3) * 6;
      const cx = Math.cos((angle * Math.PI) / 180) * radius;
      const cy = Math.sin((angle * Math.PI) / 180) * radius;
      orbitGroup.appendChild(
        createNode('circle', {
          cx,
          cy,
          r: 4,
          fill: orbitColors[i % orbitColors.length],
          opacity: 0.85,
        }),
      );
    }
    svg.appendChild(orbitGroup);
    return svg;
  },

  lights: (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const beam = createGradient(
      'linear',
      `lights-${toy.slug}`,
      [
        { offset: '0%', color: '#22d3ee' },
        { offset: '100%', color: '#6366f1' },
      ],
      { x1: '0%', x2: '100%', y1: '0%', y2: '0%' },
    );

    const group = createNode('g', { transform: 'translate(60 60)' });
    for (let i = 0; i < 8; i += 1) {
      const rect = createNode('rect', {
        x: -4,
        y: -46,
        width: 8,
        height: 30,
        rx: 4,
        fill: beam,
        opacity: 0.8,
        transform: `rotate(${(360 / 8) * i})`,
      });
      group.appendChild(rect);
    }
    svg.appendChild(group);

    addRings(svg, createNode, [
      { r: 42, stroke: '#22d3ee', strokeWidth: 2, dash: '3 8', opacity: 0.6 },
      { r: 24, stroke: '#6366f1', strokeWidth: 2, dash: '2 6', opacity: 0.65 },
    ]);
    return svg;
  },

  'spiral-burst': (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const spiral = createGradient(
      'linear',
      `spiral-${toy.slug}`,
      [
        { offset: '0%', color: '#f97316' },
        { offset: '50%', color: '#f472b6' },
        { offset: '100%', color: '#22d3ee' },
      ],
      { x1: '0%', x2: '100%', y1: '0%', y2: '100%' },
    );

    svg.appendChild(
      createNode('path', {
        d: 'M 22 60 C 26 34 54 30 70 46 C 86 62 90 86 70 94 C 52 102 38 84 42 70 C 46 54 68 50 78 62',
        fill: 'none',
        stroke: spiral,
        'stroke-width': 8,
        'stroke-linecap': 'round',
      }),
    );

    addBurst(svg, createNode, {
      count: 12,
      length: 16,
      stroke: '#f472b6',
      width: 1.4,
      opacity: 0.5,
    });
    return svg;
  },

  'rainbow-tunnel': (toy) => {
    const { svg, createGradient, createNode } = createSvgContext(
      toy.slug,
      `${toy.title} icon`,
    );
    const tunnel = createGradient('radial', `tunnel-${toy.slug}`, [
      { offset: '0%', color: '#22d3ee', opacity: 0.9 },
      { offset: '50%', color: '#f59e0b', opacity: 0.5 },
      { offset: '100%', color: '#0f172a', opacity: 0 },
    ]);

    svg.appendChild(
      createNode('circle', { cx: 60, cy: 60, r: 52, fill: tunnel }),
    );

    addRings(svg, createNode, [
      { r: 44, stroke: '#fb7185', strokeWidth: 3, dash: '4 10', opacity: 0.7 },
      { r: 32, stroke: '#38bdf8', strokeWidth: 2, dash: '3 8', opacity: 0.7 },
      { r: 20, stroke: '#f59e0b', strokeWidth: 2, dash: '2 6', opacity: 0.7 },
    ]);

    svg.appendChild(
      createNode('path', {
        d: 'M 36 70 Q 60 38 84 70',
        fill: 'none',
        stroke: '#e0f2fe',
        'stroke-width': 3,
        'stroke-linecap': 'round',
      }),
    );

    return svg;
  },

  'star-field': (toy) => {
    const { svg, createNode } = createSvgContext(toy.slug, `${toy.title} icon`);
    svg.appendChild(
      createNode('rect', {
        x: 8,
        y: 8,
        width: 104,
        height: 104,
        rx: 20,
        fill: '#0f172a',
      }),
    );
    addBurst(svg, createNode, {
      count: 20,
      length: 12,
      stroke: '#e0f2fe',
      width: 1,
      opacity: 0.6,
    });

    for (let i = 0; i < 8; i += 1) {
      svg.appendChild(
        createNode('circle', {
          cx: 18 + i * 12,
          cy: 22 + (i % 3) * 12,
          r: 3,
          fill: ['#e0f2fe', '#38bdf8', '#c084fc'][i % 3],
          opacity: 0.9,
        }),
      );
    }
    return svg;
  },

  'fractal-kite-garden': (toy) => {
    const { svg, createNode } = createSvgContext(toy.slug, `${toy.title} icon`);
    const group = createNode('g', { transform: 'translate(60 60)' });
    for (let i = 0; i < 4; i += 1) {
      group.appendChild(
        createNode('polygon', {
          points: '0,-18 10,0 0,18 -10,0',
          fill: ['#22d3ee', '#c084fc', '#22c55e', '#f59e0b'][i],
          opacity: 0.85,
          transform: `rotate(${i * 18}) scale(${1 - i * 0.12}) translate(${i * 14} ${i * 6})`,
        }),
      );
    }
    svg.appendChild(group);

    addRings(svg, createNode, [
      { r: 42, stroke: '#a855f7', strokeWidth: 2, dash: '3 8', opacity: 0.55 },
      { r: 28, stroke: '#22c55e', strokeWidth: 1.8, dash: '2 6', opacity: 0.6 },
    ]);
    return svg;
  },

  default: (toy) => {
    const { svg, createNode } = createSvgContext(toy.slug, `${toy.title} icon`);
    addRings(svg, createNode, [
      { r: 48, stroke: '#38bdf8', strokeWidth: 2, dash: '4 12', opacity: 0.6 },
      { r: 32, stroke: '#c084fc', strokeWidth: 2, dash: '3 8', opacity: 0.6 },
    ]);
    svg.appendChild(
      createNode('circle', {
        cx: 60,
        cy: 60,
        r: 16,
        fill: '#38bdf8',
        opacity: 0.75,
      }),
    );
    return svg;
  },
};

const getThemeController = () => {
  if (window.__stimsTheme) {
    return window.__stimsTheme;
  }

  const resolveThemePreference = () => {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  };

  const applyTheme = (theme, persist = false) => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    if (persist) {
      localStorage.setItem('theme', theme);
    }
  };

  return { resolveThemePreference, applyTheme };
};

function setupDarkModeToggle(themeToggleId = 'theme-toggle') {
  const btn = document.getElementById(themeToggleId);
  if (!btn) return;

  const { resolveThemePreference, applyTheme } = getThemeController();
  let theme = resolveThemePreference();

  const label = btn.querySelector('[data-theme-label]');
  const icon = btn.querySelector('.theme-toggle__icon');
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)');

  const runViewTransition = (action) => {
    const doc = btn.ownerDocument;
    if (
      !doc ||
      typeof doc.startViewTransition !== 'function' ||
      prefersReducedMotion?.matches
    ) {
      action();
      return;
    }
    doc.startViewTransition(() => {
      action();
    });
  };

  const updateButtonState = () => {
    const isDark = theme === 'dark';
    const labelText = isDark ? 'Light mode' : 'Dark mode';
    if (label) {
      label.textContent = labelText;
    } else {
      btn.textContent = labelText;
    }
    if (icon) {
      icon.textContent = isDark ? '☀️' : '🌙';
    }
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute(
      'aria-label',
      isDark ? 'Switch to light mode' : 'Switch to dark mode',
    );
  };

  applyTheme(theme);
  updateButtonState();

  btn.addEventListener('click', () => {
    runViewTransition(() => {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme, true);
      updateButtonState();
    });
  });
}

export function createLibraryView({
  toys = [],
  loadToy,
  initNavigation,
  loadFromQuery,
  targetId = 'toy-list',
  searchInputId,
  cardElement = 'a',
  enableIcons = false,
  enableCapabilityBadges = false,
  enableKeyboardHandlers = false,
  enableDarkModeToggle = false,
  themeToggleId = 'theme-toggle',
} = {}) {
  const STORAGE_KEY = 'stims-library-state';
  const COMPATIBILITY_MODE_KEY = 'stims-compatibility-mode';
  const QUERY_PARAM = 'q';
  const FILTER_PARAM = 'filters';
  const SORT_PARAM = 'sort';
  let allToys = toys;
  let originalOrder = new Map();
  let searchQuery = '';
  let sortBy = 'featured';
  let lastCommittedQuery = '';
  let pendingCommit;
  let resultsMeta;
  let searchForm;
  let searchClearButton;
  let filterResetButton;
  let searchSuggestions;
  let activeFiltersSummary;
  let lastFilteredToys = [];
  let activeFiltersChips;
  let activeFiltersClear;
  const activeFilters = new Set();

  const ensureMetaNode = () => {
    if (!resultsMeta) {
      resultsMeta = document.querySelector('[data-search-results]');
    }
    return resultsMeta;
  };

  const ensureSearchForm = () => {
    if (!searchForm) {
      searchForm = document.querySelector('[data-search-form]');
    }
    return searchForm;
  };

  const ensureSearchClearButton = () => {
    if (!searchClearButton) {
      searchClearButton = document.querySelector('[data-search-clear]');
    }
    return searchClearButton;
  };

  const ensureFilterResetButton = () => {
    if (!filterResetButton) {
      filterResetButton = document.querySelector('[data-filter-reset]');
    }
    return filterResetButton;
  };

  const ensureSearchSuggestions = () => {
    if (!searchSuggestions) {
      searchSuggestions = document.getElementById('toy-search-suggestions');
    }
    return searchSuggestions;
  };

  const ensureActiveFiltersSummary = () => {
    if (!activeFiltersSummary) {
      activeFiltersSummary = document.querySelector('[data-active-filters]');
    }
    return activeFiltersSummary;
  };

  const ensureActiveFiltersChips = () => {
    if (!activeFiltersChips) {
      activeFiltersChips = document.querySelector(
        '[data-active-filters-chips]',
      );
    }
    return activeFiltersChips;
  };

  const ensureActiveFiltersClear = () => {
    if (!activeFiltersClear) {
      activeFiltersClear = document.querySelector(
        '[data-active-filters-clear]',
      );
    }
    return activeFiltersClear;
  };

  const getOriginalIndex = (toy) => originalOrder.get(toy.slug) ?? 0;
  const getFeaturedRank = (toy) =>
    Number.isFinite(toy.featuredRank)
      ? toy.featuredRank
      : Number.POSITIVE_INFINITY;

  const getSortLabel = () => {
    const sortControl = document.querySelector('[data-sort-control]');
    if (sortControl && sortControl.tagName === 'SELECT') {
      const selected = sortControl.selectedOptions?.[0];
      const label = selected?.textContent?.trim();
      if (label) return label;
    }
    const sortLabels = {
      featured: 'Featured',
      newest: 'Newest',
      immersive: 'Most immersive',
      az: 'A → Z',
    };
    return sortLabels[sortBy] ?? sortBy;
  };
  const normalizeCapabilityToken = (value) => {
    const normalized = value.toLowerCase();
    if (normalized === 'demoaudio' || normalized === 'demo-audio') {
      return 'demoAudio';
    }
    return normalized;
  };

  const normalizeMoodToken = (value) => {
    const normalized = value.toLowerCase();
    if (normalized === 'calm') return 'calming';
    return normalized;
  };

  const matchesMoodToken = (toyMoods, value) => {
    const normalizedValue = normalizeMoodToken(value);
    const aliases = {
      calm: ['calming', 'serene', 'minimal'],
      calming: ['calm', 'serene', 'minimal'],
    };
    const accepted = new Set([
      normalizedValue,
      ...(aliases[normalizedValue] ?? []),
    ]);
    return (toyMoods ?? []).some((mood) => accepted.has(mood.toLowerCase()));
  };

  const formatTokenLabel = (token) => {
    const [type, value = ''] = token.split(':');
    if (!type) return token;
    const normalizedValue = value.toLowerCase();
    const chipMatch = Array.from(
      document.querySelectorAll('[data-filter-chip]'),
    ).find((chip) => {
      const chipType = chip.getAttribute('data-filter-type');
      const chipValue = chip.getAttribute('data-filter-value');
      return chipType === type && chipValue?.toLowerCase() === normalizedValue;
    });
    const chipLabel = chipMatch?.textContent?.trim();
    if (chipLabel) return chipLabel;
    const fallbackLabel = normalizedValue.replace(/[-_]/g, ' ');
    return fallbackLabel
      ? `${fallbackLabel[0].toUpperCase()}${fallbackLabel.slice(1)}`
      : token;
  };

  const updateActiveFiltersSummary = () => {
    const summary = ensureActiveFiltersSummary();
    const chipsContainer = ensureActiveFiltersChips();
    if (
      !(summary instanceof HTMLElement) ||
      !(chipsContainer instanceof HTMLElement)
    ) {
      return;
    }

    const trimmedQuery = searchQuery.trim();
    const tokens = Array.from(activeFilters);
    const hasTokens = Boolean(trimmedQuery) || tokens.length > 0;
    summary.hidden = !hasTokens;
    summary.setAttribute('aria-hidden', String(!hasTokens));
    chipsContainer.innerHTML = '';

    const appendChip = ({ label, onClick, ariaLabel }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'active-filter-chip';
      chip.textContent = label;
      if (ariaLabel) {
        chip.setAttribute('aria-label', ariaLabel);
      }
      chip.addEventListener('click', onClick);
      chipsContainer.appendChild(chip);
    };

    if (trimmedQuery) {
      appendChip({
        label: `Search: “${trimmedQuery}”`,
        ariaLabel: `Clear search query ${trimmedQuery}`,
        onClick: () => clearSearch(),
      });
    }

    tokens.forEach((token) => {
      const label = formatTokenLabel(token);
      appendChip({
        label,
        ariaLabel: `Remove filter ${label}`,
        onClick: () => removeFilterToken(token),
      });
    });

    const clearButton = ensureActiveFiltersClear();
    if (
      clearButton instanceof HTMLElement &&
      clearButton.tagName === 'BUTTON'
    ) {
      clearButton.disabled = !hasTokens;
      clearButton.setAttribute('aria-disabled', String(!hasTokens));
    }
  };

  const updateSearchClearState = () => {
    const clearButton = ensureSearchClearButton();
    if (!(clearButton instanceof HTMLElement)) return;
    if (clearButton.tagName !== 'BUTTON') return;
    const hasQuery = searchQuery.trim().length > 0;
    clearButton.disabled = !hasQuery;
    clearButton.setAttribute('aria-disabled', String(!hasQuery));
  };

  const updateFilterResetState = () => {
    const resetButton = ensureFilterResetButton();
    if (!(resetButton instanceof HTMLElement)) return;
    if (resetButton.tagName !== 'BUTTON') return;
    const hasFilters = activeFilters.size > 0;
    resetButton.disabled = !hasFilters;
    resetButton.setAttribute('aria-disabled', String(!hasFilters));
  };

  const updateFilterChipA11y = (chip, isActive) => {
    if (!chip || typeof chip.setAttribute !== 'function') return;
    chip.setAttribute('aria-pressed', String(isActive));
  };

  const resolveQuickLaunchToy = (list, query) => {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery || list.length === 0) return null;

    const exactMatch = list.find((toy) => {
      const slug = toy.slug?.toLowerCase() ?? '';
      const title = toy.title?.toLowerCase() ?? '';
      return slug === trimmedQuery || title === trimmedQuery;
    });

    if (exactMatch) return exactMatch;
    if (list.length === 1) return list[0];
    return null;
  };

  const updateResultsMeta = (visibleCount) => {
    const meta = ensureMetaNode();
    if (!meta) return;

    const trimmedQuery = searchQuery.trim();
    const parts = [`${visibleCount} results`];

    if (trimmedQuery) {
      parts.push(`q: “${trimmedQuery}”`);
    }

    if (activeFilters.size > 0) {
      parts.push(
        `${activeFilters.size} filter${activeFilters.size === 1 ? '' : 's'}`,
      );
    }

    if (sortBy !== 'featured') {
      parts.push(getSortLabel());
    }

    const quickLaunchToy = resolveQuickLaunchToy(
      lastFilteredToys,
      trimmedQuery,
    );
    if (quickLaunchToy) {
      parts.push(`↵ ${quickLaunchToy.title}`);
    }

    meta.textContent = parts.join(' • ');
  };

  const resetFiltersAndSearch = () => {
    searchQuery = '';
    activeFilters.clear();
    sortBy = 'featured';

    const chips = document.querySelectorAll('[data-filter-chip].is-active');
    chips.forEach((chip) => chip.classList.remove('is-active'));

    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = '';
      }
    }

    const sortControl = document.querySelector('[data-sort-control]');
    if (sortControl && sortControl.tagName === 'SELECT') {
      sortControl.value = sortBy;
    }

    commitState({ replace: false });
    renderToys(applyFilters());
    updateSearchClearState();
    updateFilterResetState();
  };

  const getHaystack = (toy) => {
    const capabilityLabels = {
      microphone: ['mic', 'microphone'],
      demoAudio: ['demo audio', 'demo', 'audio'],
      motion: ['motion', 'tilt', 'gyro', 'gyroscope'],
    };

    const capabilityTerms = Object.entries(toy.capabilities || {})
      .filter(([, enabled]) => Boolean(enabled))
      .flatMap(([key]) => {
        const labels = capabilityLabels[key];
        return labels ? [key, ...labels] : [key];
      })
      .map((term) => term.toLowerCase());

    return [
      toy.title,
      toy.slug,
      toy.description,
      ...(toy.tags ?? []),
      ...(toy.moods ?? []),
      ...capabilityTerms,
      toy.requiresWebGPU ? 'webgpu' : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  };

  const capabilityScore = (toy) =>
    (toy.requiresWebGPU ? 2 : 0) +
    Number(toy.capabilities?.microphone) +
    Number(toy.capabilities?.demoAudio) +
    Number(toy.capabilities?.motion);

  const lowSetupScore = (toy) => {
    const hasMic = Boolean(toy.capabilities?.microphone);
    const hasDemo = Boolean(toy.capabilities?.demoAudio);
    const requiresWebGPU = Boolean(toy.requiresWebGPU);
    const hasMotion = Boolean(toy.capabilities?.motion);

    return (
      Number(hasDemo) * 3 +
      Number(!hasMic) * 2 +
      Number(!requiresWebGPU) * 2 +
      Number(!hasMotion)
    );
  };

  const hasSetupIntentToken = (query) => {
    const setupTokens = new Set([
      'mic',
      'microphone',
      'demo',
      'audio',
      'motion',
      'tilt',
      'gyro',
      'webgpu',
      'webgl',
    ]);
    return getQueryTokens(query).some((token) => setupTokens.has(token));
  };

  const shouldApplyLowSetupBoost = () => {
    if (sortBy !== 'featured') return false;
    if (activeFilters.size > 0) return false;
    if (!searchQuery.trim()) return false;
    if (hasSetupIntentToken(searchQuery)) return false;
    return true;
  };

  const sortList = (list) => {
    const sorted = [...list];
    switch (sortBy) {
      case 'newest':
        return sorted.sort((a, b) => getOriginalIndex(b) - getOriginalIndex(a));
      case 'az':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'immersive':
        return sorted.sort(
          (a, b) =>
            capabilityScore(b) - capabilityScore(a) ||
            getOriginalIndex(a) - getOriginalIndex(b),
        );
      default:
        if (shouldApplyLowSetupBoost()) {
          return sorted.sort(
            (a, b) =>
              lowSetupScore(b) - lowSetupScore(a) ||
              getFeaturedRank(a) - getFeaturedRank(b) ||
              getOriginalIndex(a) - getOriginalIndex(b),
          );
        }
        return sorted.sort(
          (a, b) =>
            getFeaturedRank(a) - getFeaturedRank(b) ||
            getOriginalIndex(a) - getOriginalIndex(b),
        );
    }
  };

  const matchesFilter = (toy, token) => {
    const [type, value] = token.split(':');
    if (!type || !value) return true;

    switch (type) {
      case 'mood':
        return matchesMoodToken(toy.moods, value);
      case 'capability':
        return Boolean(toy.capabilities?.[normalizeCapabilityToken(value)]);
      case 'feature':
        if (value === 'webgpu') return Boolean(toy.requiresWebGPU);
        if (value === 'compatible') {
          return !toy.requiresWebGPU || Boolean(toy.allowWebGLFallback);
        }
        return true;
      default:
        return true;
    }
  };

  const getQueryTokens = (query) =>
    query
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);

  const getMatchedFields = (toy, queryTokens) => {
    if (!queryTokens.length) return [];

    const matchedSources = new Set();
    queryTokens.forEach((token) => {
      if (toy.title?.toLowerCase().includes(token)) matchedSources.add('Title');
      if (toy.slug?.toLowerCase().includes(token)) matchedSources.add('Slug');
      if (toy.description?.toLowerCase().includes(token)) {
        matchedSources.add('Description');
      }
      if ((toy.tags ?? []).some((tag) => tag.toLowerCase().includes(token))) {
        matchedSources.add('Tags');
      }
      if (
        (toy.moods ?? []).some((mood) => mood.toLowerCase().includes(token))
      ) {
        matchedSources.add('Moods');
      }
      if (toy.requiresWebGPU && 'webgpu'.includes(token)) {
        matchedSources.add('WebGPU');
      }
      if (toy.capabilities?.microphone && 'microphone mic'.includes(token)) {
        matchedSources.add('Mic');
      }
      if (toy.capabilities?.demoAudio && 'demo audio'.includes(token)) {
        matchedSources.add('Demo audio');
      }
      if (toy.capabilities?.motion && 'motion tilt gyro'.includes(token)) {
        matchedSources.add('Motion');
      }
    });

    return Array.from(matchedSources).slice(0, 3);
  };

  const applyFilters = () => {
    const queryTokens = getQueryTokens(searchQuery);
    const filtered = allToys.filter((toy) => {
      const haystack = getHaystack(toy);
      const matchesQuery =
        queryTokens.length === 0 ||
        queryTokens.every((token) => haystack.includes(token));
      const matchesChips =
        activeFilters.size === 0 ||
        Array.from(activeFilters).every((token) => matchesFilter(toy, token));
      return matchesQuery && matchesChips;
    });

    const sorted = sortList(filtered);
    lastFilteredToys = sorted;
    updateResultsMeta(sorted.length);
    return sorted;
  };

  const setToys = (nextToys = []) => {
    allToys = nextToys;
    originalOrder = new Map(
      nextToys.map((toy, index) => [toy.slug ?? `toy-${index}`, index]),
    );
    populateSearchSuggestions();
  };

  const parseFilters = (value) => {
    if (!value) return [];
    return value
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  };

  const getStateFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get(QUERY_PARAM) ?? '';
    const filters = parseFilters(params.get(FILTER_PARAM));
    const sort = params.get(SORT_PARAM) ?? 'featured';
    return { query, filters, sort };
  };

  const saveStateToStorage = (state) => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Unable to persist library state', error);
    }
  };

  const readStateFromStorage = () => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      console.warn('Unable to restore library state', error);
    }
    return null;
  };

  const stateToParams = (state) => {
    const params = new URLSearchParams(window.location.search);
    if (state.query) {
      params.set(QUERY_PARAM, state.query);
    } else {
      params.delete(QUERY_PARAM);
    }
    if (state.filters?.length) {
      params.set(FILTER_PARAM, state.filters.join(','));
    } else {
      params.delete(FILTER_PARAM);
    }
    if (state.sort && state.sort !== 'featured') {
      params.set(SORT_PARAM, state.sort);
    } else {
      params.delete(SORT_PARAM);
    }
    return params;
  };

  const resolvePathname = () => {
    if (window.location?.pathname) return window.location.pathname;
    if (window.location?.href) {
      try {
        return new URL(window.location.href).pathname;
      } catch (_error) {
        return '/';
      }
    }
    return '/';
  };

  const commitState = ({ replace }) => {
    const state = {
      query: searchQuery.trim(),
      filters: Array.from(activeFilters),
      sort: sortBy,
    };
    const params = stateToParams(state);
    const nextUrl = `${resolvePathname()}${
      params.toString() ? `?${params.toString()}` : ''
    }`;
    try {
      if (replace) {
        window.history.replaceState(state, '', nextUrl);
      } else {
        window.history.pushState(state, '', nextUrl);
      }
    } catch (_error) {
      // Ignore history errors in non-browser environments.
    }
    saveStateToStorage(state);
  };

  const applyState = (state, { render = true } = {}) => {
    searchQuery = state.query ?? '';
    sortBy = state.sort ?? 'featured';
    activeFilters.clear();
    (state.filters ?? []).forEach((token) => activeFilters.add(token));
    lastCommittedQuery = searchQuery.trim();

    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = searchQuery;
      }
    }

    const chips = document.querySelectorAll('[data-filter-chip]');
    chips.forEach((chip) => {
      const type = chip.getAttribute('data-filter-type');
      const value = chip.getAttribute('data-filter-value');
      if (!type || !value) return;
      const token = `${type}:${value.toLowerCase()}`;
      const isActive = activeFilters.has(token);
      chip.classList.toggle('is-active', isActive);
      updateFilterChipA11y(chip, isActive);
    });

    const sortControl = document.querySelector('[data-sort-control]');
    if (sortControl && sortControl.tagName === 'SELECT') {
      sortControl.value = sortBy;
    }

    if (render) {
      renderToys(applyFilters());
    }
    updateSearchClearState();
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const openToy = (toy, { preferDemoAudio = false } = {}) => {
    if (toy.type === 'module' && typeof loadToy === 'function') {
      loadToy(toy.slug, { pushState: true, preferDemoAudio });
    } else if (toy.module) {
      window.location.href = toy.module;
    }
  };

  const handleOpenToy = (toy, event) => {
    const isMouseEvent =
      typeof MouseEvent !== 'undefined' && event instanceof MouseEvent;
    const isModifiedClick = isMouseEvent
      ? event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button === 1
      : false;

    if (cardElement === 'a' && event) {
      if (isModifiedClick) return;
      event.preventDefault();
    }

    openToy(toy);
  };

  const getBestForLabel = (toy) => {
    if (toy.capabilities?.motion) return 'Best for mobile tilt';
    if (toy.capabilities?.demoAudio && toy.capabilities?.microphone) {
      return 'Best for quick starts or live rooms';
    }
    if (toy.capabilities?.demoAudio) return 'Best for no-permission preview';
    if (toy.capabilities?.microphone) return 'Best for live room audio';
    return 'Best for visual exploration';
  };

  const createCard = (toy) => {
    const card = document.createElement(cardElement);
    card.className = 'webtoy-card';
    if (toy.slug) {
      card.dataset.toySlug = toy.slug;
    }
    if (toy.type) {
      card.dataset.toyType = toy.type;
    }
    if (toy.module) {
      card.dataset.toyModule = toy.module;
    }
    const href =
      toy.type === 'module'
        ? `toy.html?toy=${encodeURIComponent(toy.slug)}`
        : toy.module;
    if (cardElement === 'button') {
      card.type = 'button';
    } else if (cardElement === 'a') {
      card.href = href;
      card.setAttribute('data-toy-href', href);
    }

    if (enableIcons) {
      const symbolId = ensureIconSymbol(toy);
      if (symbolId) {
        const icon = document.createElementNS(ns, 'svg');
        icon.classList.add('toy-icon');
        icon.setAttribute('viewBox', '0 0 120 120');
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', `${toy.title} icon`);

        const title = document.createElementNS(ns, 'title');
        title.textContent = `${toy.title} icon`;
        icon.appendChild(title);

        const use = document.createElementNS(ns, 'use');
        use.setAttribute('href', `#${symbolId}`);
        icon.appendChild(use);
        card.appendChild(icon);
      }
    }

    const title = document.createElement('h3');
    title.textContent = toy.title;
    const desc = document.createElement('p');
    desc.className = 'webtoy-card-description';
    desc.textContent = toy.description;
    card.appendChild(title);
    card.appendChild(desc);

    const bestFor = document.createElement('p');
    bestFor.className = 'webtoy-card-bestfor';
    bestFor.textContent = getBestForLabel(toy);
    card.appendChild(bestFor);

    const matchedFields = getMatchedFields(toy, getQueryTokens(searchQuery));
    if (matchedFields.length > 0) {
      const matches = document.createElement('p');
      matches.className = 'webtoy-card-match';

      const label = document.createElement('strong');
      label.textContent = 'Matched in';
      matches.appendChild(label);

      matchedFields.forEach((field) => {
        const matchToken = document.createElement('mark');
        matchToken.textContent = field;
        matches.appendChild(matchToken);
      });

      card.appendChild(matches);
    }

    if (enableCapabilityBadges) {
      const metaRow = document.createElement('div');
      metaRow.className = 'webtoy-card-meta';

      const createBadge = ({
        label,
        title,
        ariaLabel,
        warning = false,
        role = null,
        tone = null,
      }) => {
        const badge = document.createElement('span');
        badge.className = 'capability-badge';
        badge.textContent = label;
        if (title) {
          badge.title = title;
        }
        if (ariaLabel) {
          badge.setAttribute('aria-label', ariaLabel);
        }
        if (role) {
          badge.setAttribute('role', role);
        }
        if (tone) {
          badge.classList.add(`capability-badge--${tone}`);
        }
        if (warning) {
          badge.classList.add('capability-badge--warning');
        }
        return badge;
      };

      if (toy.requiresWebGPU) {
        const hasWebGPU =
          typeof navigator !== 'undefined' && Boolean(navigator.gpu);
        metaRow.appendChild(
          createBadge({
            label: 'WebGPU',
            title: hasWebGPU
              ? 'Requires WebGPU to run.'
              : 'WebGPU not detected; falling back to WebGL if available.',
            ariaLabel: 'Requires WebGPU',
            role: 'status',
            warning: !hasWebGPU,
            tone: 'webgpu',
          }),
        );

        if (!hasWebGPU) {
          const fallbackNote = document.createElement('span');
          fallbackNote.className = 'capability-note';
          fallbackNote.textContent =
            'No WebGPU detected — will try WebGL fallback.';
          metaRow.appendChild(fallbackNote);
        }
      }

      if (toy.capabilities?.microphone) {
        metaRow.appendChild(
          createBadge({
            label: 'Mic',
            title: 'Uses live microphone input.',
            ariaLabel: 'Requires microphone input',
            tone: 'primary',
          }),
        );
      }

      if (toy.capabilities?.demoAudio) {
        metaRow.appendChild(
          createBadge({
            label: 'Demo audio',
            title: 'Includes a demo track if you skip the mic.',
            ariaLabel: 'Demo audio available',
            tone: 'soft',
          }),
        );
      }

      if (toy.capabilities?.motion) {
        metaRow.appendChild(
          createBadge({
            label: 'Motion',
            title: 'Responds to device motion or tilt.',
            ariaLabel: 'Requires device motion',
            tone: 'motion',
          }),
        );
      }

      if (metaRow.childElementCount > 0) {
        card.appendChild(metaRow);
      }
    }

    if (toy.type === 'module') {
      const actions = document.createElement('div');
      actions.className = 'webtoy-card-actions';

      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'cta-button cta-button--muted';
      play.textContent = toy.capabilities?.demoAudio ? 'Play demo' : 'Play';
      play.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openToy(toy, { preferDemoAudio: Boolean(toy.capabilities?.demoAudio) });
      });
      play.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
        }
      });

      actions.appendChild(play);
      card.appendChild(actions);
    }

    card.addEventListener('click', (event) => {
      event.stopPropagation();
      handleOpenToy(toy, event);
    });

    if (enableKeyboardHandlers) {
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpenToy(toy, event);
        }
      });
    }

    return card;
  };

  const initCardClickHandlers = () => {
    const list = document.getElementById(targetId);
    if (!list) return;
    list.addEventListener('click', (event) => {
      const target =
        event.target && typeof event.target === 'object' ? event.target : null;
      const card =
        target && 'closest' in target ? target.closest?.('.webtoy-card') : null;
      if (!(card instanceof HTMLElement)) return;
      const slug = card.dataset.toySlug;
      if (!slug) return;
      const toy = allToys.find((entry) => entry.slug === slug);
      if (!toy) return;
      handleOpenToy(toy, event);
    });
  };

  const renderToys = (listToRender) => {
    const list = document.getElementById(targetId);
    if (!list) return;
    list.innerHTML = '';
    if (listToRender.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.setAttribute('role', 'status');
      emptyState.setAttribute('aria-live', 'polite');

      const message = document.createElement('p');
      message.className = 'empty-state__message';
      message.textContent =
        'No stims match your search or filters. Try clearing your search or removing filters.';

      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'cta-button';
      resetButton.textContent = 'Reset search and filters';
      resetButton.addEventListener('click', () => resetFiltersAndSearch());

      const quickActions = document.createElement('div');
      quickActions.className = 'webtoy-card-actions';

      const applySuggestedSearch = (query) => {
        searchQuery = query;
        if (searchInputId) {
          const search = document.getElementById(searchInputId);
          if (search && 'value' in search) {
            search.value = query;
          }
        }
        commitState({ replace: false });
        renderToys(applyFilters());
        updateSearchClearState();
        updateActiveFiltersSummary();
      };

      [
        { label: 'Try demo audio', query: 'demo audio' },
        { label: 'Try mobile', query: 'mobile' },
        { label: 'Try webgpu', query: 'webgpu' },
      ].forEach(({ label, query }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cta-button cta-button--muted';
        button.textContent = label;
        button.addEventListener('click', () => applySuggestedSearch(query));
        quickActions.appendChild(button);
      });

      const collapseSuggestions =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(max-width: 600px)').matches;

      emptyState.appendChild(message);
      emptyState.appendChild(resetButton);

      if (collapseSuggestions) {
        const suggestionsDisclosure = document.createElement('details');
        suggestionsDisclosure.className = 'empty-state__suggestions';

        const summary = document.createElement('summary');
        summary.textContent = 'Try suggestions';

        suggestionsDisclosure.appendChild(summary);
        suggestionsDisclosure.appendChild(quickActions);
        emptyState.appendChild(suggestionsDisclosure);
      } else {
        emptyState.appendChild(quickActions);
      }

      list.appendChild(emptyState);
      updateResultsMeta(0);
      updateActiveFiltersSummary();
      return;
    }

    listToRender.forEach((toy) => list.appendChild(createCard(toy)));
    updateResultsMeta(listToRender.length);
    updateActiveFiltersSummary();
  };

  const filterToys = (query) => {
    searchQuery = query;
    renderToys(applyFilters());
    updateSearchClearState();
    updateActiveFiltersSummary();
  };

  const clearSearch = () => {
    searchQuery = '';
    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = '';
      }
    }
    commitState({ replace: false });
    renderToys(applyFilters());
    updateSearchClearState();
    updateActiveFiltersSummary();
  };

  const clearFilters = () => {
    activeFilters.clear();
    const chips = document.querySelectorAll('[data-filter-chip].is-active');
    chips.forEach((chip) => {
      chip.classList.remove('is-active');
      updateFilterChipA11y(chip, false);
    });
    commitState({ replace: false });
    renderToys(applyFilters());
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const clearAllFilters = () => {
    searchQuery = '';
    activeFilters.clear();
    const chips = document.querySelectorAll('[data-filter-chip].is-active');
    chips.forEach((chip) => {
      chip.classList.remove('is-active');
      updateFilterChipA11y(chip, false);
    });

    if (searchInputId) {
      const search = document.getElementById(searchInputId);
      if (search && 'value' in search) {
        search.value = '';
      }
    }

    commitState({ replace: false });
    renderToys(applyFilters());
    updateSearchClearState();
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const removeFilterToken = (token) => {
    const [type, value] = token.split(':');
    if (!type || !value) return;
    activeFilters.delete(token);
    const chips = document.querySelectorAll('[data-filter-chip]');
    chips.forEach((chip) => {
      const chipType = chip.getAttribute('data-filter-type');
      const chipValue = chip.getAttribute('data-filter-value');
      if (
        chipType === type &&
        chipValue?.toLowerCase() === value.toLowerCase()
      ) {
        chip.classList.remove('is-active');
        updateFilterChipA11y(chip, false);
      }
    });
    commitState({ replace: false });
    renderToys(applyFilters());
    updateFilterResetState();
    updateActiveFiltersSummary();
  };

  const populateSearchSuggestions = () => {
    const datalist = ensureSearchSuggestions();
    if (!datalist) return;
    datalist.innerHTML = '';
    const suggestions = new Set();
    allToys.forEach((toy) => {
      if (toy.title) suggestions.add(toy.title);
      if (toy.slug) suggestions.add(toy.slug);
      (toy.tags ?? []).forEach((tag) => suggestions.add(tag));
      (toy.moods ?? []).forEach((mood) => suggestions.add(mood));
      if (toy.capabilities?.microphone) suggestions.add('microphone');
      if (toy.capabilities?.demoAudio) suggestions.add('demo audio');
      if (toy.capabilities?.motion) suggestions.add('motion');
      if (toy.requiresWebGPU) suggestions.add('webgpu');
    });
    Array.from(suggestions)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .forEach((suggestion) => {
        const option = document.createElement('option');
        option.value = suggestion;
        datalist.appendChild(option);
      });
  };

  const initFilters = () => {
    const chips = document.querySelectorAll('[data-filter-chip]');
    chips.forEach((chip) => {
      updateFilterChipA11y(chip, chip.classList.contains('is-active'));
      chip.addEventListener('click', () => {
        const type = chip.getAttribute('data-filter-type');
        const value = chip.getAttribute('data-filter-value');
        if (!type || !value) return;
        const token = `${type}:${value.toLowerCase()}`;
        const isActive = chip.classList.toggle('is-active');
        updateFilterChipA11y(chip, isActive);
        if (isActive) {
          activeFilters.add(token);
        } else {
          activeFilters.delete(token);
        }
        commitState({ replace: false });
        renderToys(applyFilters());
        updateFilterResetState();
        updateActiveFiltersSummary();
      });
    });

    const sortControl = document.querySelector('[data-sort-control]');
    if (sortControl && sortControl.tagName === 'SELECT') {
      sortControl.addEventListener('change', () => {
        sortBy = sortControl.value;
        commitState({ replace: false });
        renderToys(applyFilters());
      });
    }

    const resetButton = ensureFilterResetButton();
    if (
      resetButton instanceof HTMLElement &&
      resetButton.tagName === 'BUTTON'
    ) {
      resetButton.addEventListener('click', () => clearFilters());
      updateFilterResetState();
    }

    const clearButton = ensureActiveFiltersClear();
    if (
      clearButton instanceof HTMLElement &&
      clearButton.tagName === 'BUTTON'
    ) {
      clearButton.addEventListener('click', () => clearAllFilters());
    }
  };

  const initSearch = () => {
    if (!searchInputId) return;
    const search = document.getElementById(searchInputId);
    if (search) {
      search.addEventListener('input', (e) => {
        filterToys(e.target.value);
        commitState({ replace: true });
        if (pendingCommit) {
          window.clearTimeout(pendingCommit);
        }
        pendingCommit = window.setTimeout(() => {
          if (searchQuery.trim() !== lastCommittedQuery) {
            lastCommittedQuery = searchQuery.trim();
            commitState({ replace: false });
          }
        }, 500);
      });

      search.addEventListener('blur', () => {
        if (searchQuery.trim() !== lastCommittedQuery) {
          lastCommittedQuery = searchQuery.trim();
          commitState({ replace: false });
        }
      });
    }

    const form = ensureSearchForm();
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
      });
    }

    const shortcutsToggle = document.querySelector(
      '[data-search-shortcuts-toggle]',
    );
    const shortcutsHint = document.getElementById('toy-search-hint');
    if (shortcutsToggle instanceof HTMLButtonElement && shortcutsHint) {
      shortcutsToggle.addEventListener('click', () => {
        const expanded =
          shortcutsToggle.getAttribute('aria-expanded') === 'true';
        shortcutsToggle.setAttribute(
          'aria-expanded',
          expanded ? 'false' : 'true',
        );
        shortcutsHint.hidden = expanded;
      });
    }

    const clearButton = ensureSearchClearButton();
    if (
      clearButton instanceof HTMLElement &&
      clearButton.tagName === 'BUTTON'
    ) {
      clearButton.addEventListener('click', () => clearSearch());
      updateSearchClearState();
    }

    const isEditableTarget = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target instanceof HTMLInputElement) return true;
      if (target instanceof HTMLTextAreaElement) return true;
      return target.isContentEditable;
    };

    const focusSearch = () => {
      if (!(search instanceof HTMLInputElement)) return;
      search.focus();
      search.select();
    };

    search?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (searchQuery.trim().length > 0) {
          event.preventDefault();
          clearSearch();
        }
        return;
      }

      const isPlainEnter =
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey;
      if (!isPlainEnter) return;

      const quickLaunchToy = resolveQuickLaunchToy(
        lastFilteredToys,
        searchQuery,
      );
      if (!quickLaunchToy) return;

      event.preventDefault();
      openToy(quickLaunchToy);
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isMetaShortcut =
        event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      const isSlashShortcut =
        event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isEscapeShortcut = event.key === 'Escape';

      if (isMetaShortcut && !isEditableTarget(target)) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (isSlashShortcut && !isEditableTarget(target)) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (isEscapeShortcut && !isEditableTarget(target)) {
        if (searchQuery.trim().length > 0 || activeFilters.size > 0) {
          event.preventDefault();
          clearAllFilters();
        }
      }
    });
  };

  const init = async () => {
    setToys(allToys);
    const urlState = getStateFromUrl();
    const hasUrlState =
      urlState.query || urlState.filters.length || urlState.sort !== 'featured';
    if (hasUrlState) {
      applyState(urlState, { render: false });
    } else {
      const storedState = readStateFromStorage();
      if (storedState) {
        applyState(
          {
            query: storedState.query ?? '',
            filters: storedState.filters ?? [],
            sort: storedState.sort ?? 'featured',
          },
          { render: false },
        );
        commitState({ replace: true });
      } else {
        try {
          if (
            window.sessionStorage.getItem(COMPATIBILITY_MODE_KEY) === 'true'
          ) {
            applyState(
              {
                query: '',
                filters: ['feature:compatible'],
                sort: 'featured',
              },
              { render: false },
            );
            commitState({ replace: true });
          }
        } catch (_error) {
          // Ignore storage access issues.
        }
      }
    }

    renderToys(applyFilters());

    if (enableDarkModeToggle) {
      setupDarkModeToggle(themeToggleId);
    }

    initSearch();
    initFilters();
    if (typeof initNavigation === 'function') {
      initNavigation();
    }
    initCardClickHandlers();
    if (typeof loadFromQuery === 'function') {
      await loadFromQuery();
    }

    window.addEventListener('popstate', () => {
      const nextState = getStateFromUrl();
      applyState(nextState, { render: true });
    });
  };

  return {
    init,
    setToys,
    renderToys,
    filterToys,
  };
}
