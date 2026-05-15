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

export const SVG_NS = ns;
export { ensureIconSymbol };
