type IconNode = {
  tag: 'circle' | 'path' | 'rect';
  attrs: Record<string, number | string>;
};

const ICON_NODES = {
  'arrow-left': [
    { tag: 'path', attrs: { d: 'M19 12H5' } },
    { tag: 'path', attrs: { d: 'm12 19-7-7 7-7' } },
  ],
  'arrow-right': [
    { tag: 'path', attrs: { d: 'M5 12h14' } },
    { tag: 'path', attrs: { d: 'm12 5 7 7-7 7' } },
  ],
  close: [
    { tag: 'path', attrs: { d: 'm6 6 12 12' } },
    { tag: 'path', attrs: { d: 'M18 6 6 18' } },
  ],
  bookmark: [
    {
      tag: 'path',
      attrs: {
        d: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z',
      },
    },
  ],
  error: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 10 } },
    { tag: 'path', attrs: { d: 'm15 9-6 6' } },
    { tag: 'path', attrs: { d: 'm9 9 6 6' } },
  ],
  expand: [
    { tag: 'path', attrs: { d: 'M9 3H3v6' } },
    { tag: 'path', attrs: { d: 'm3 3 7 7' } },
    { tag: 'path', attrs: { d: 'M15 21h6v-6' } },
    { tag: 'path', attrs: { d: 'm21 21-7-7' } },
    { tag: 'path', attrs: { d: 'M21 9V3h-6' } },
    { tag: 'path', attrs: { d: 'm14 10 7-7' } },
    { tag: 'path', attrs: { d: 'M3 15v6h6' } },
    { tag: 'path', attrs: { d: 'm10 14-7 7' } },
  ],
  gauge: [
    { tag: 'path', attrs: { d: 'M4.5 14a7.5 7.5 0 1 1 15 0' } },
    { tag: 'path', attrs: { d: 'm12 14 4-4' } },
    { tag: 'path', attrs: { d: 'M12 14h.01' } },
  ],
  info: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 10 } },
    { tag: 'path', attrs: { d: 'M12 16v-4' } },
    { tag: 'path', attrs: { d: 'M12 8h.01' } },
  ],
  link: [
    {
      tag: 'path',
      attrs: {
        d: 'M10.8 13.2a4.5 4.5 0 0 0 6.36 0l2.12-2.12a4.5 4.5 0 1 0-6.36-6.36L11.4 6.2',
      },
    },
    {
      tag: 'path',
      attrs: {
        d: 'M13.2 10.8a4.5 4.5 0 0 0-6.36 0l-2.12 2.12a4.5 4.5 0 1 0 6.36 6.36l1.4-1.4',
      },
    },
  ],
  menu: [
    { tag: 'path', attrs: { d: 'M4 7h16' } },
    { tag: 'path', attrs: { d: 'M4 12h16' } },
    { tag: 'path', attrs: { d: 'M4 17h16' } },
  ],
  moon: [
    {
      tag: 'path',
      attrs: { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z' },
    },
  ],
  'picture-in-picture': [
    { tag: 'rect', attrs: { x: 3, y: 5, width: 18, height: 14, rx: 2 } },
    { tag: 'rect', attrs: { x: 13, y: 13, width: 5, height: 4, rx: 0.8 } },
  ],
  pulse: [{ tag: 'path', attrs: { d: 'M3 12h4l2-5 4 10 2-5h6' } }],
  sparkles: [
    {
      tag: 'path',
      attrs: {
        d: 'm12 3 1.25 3.75L17 8l-3.75 1.25L12 13l-1.25-3.75L7 8l3.75-1.25L12 3Z',
      },
    },
    {
      tag: 'path',
      attrs: {
        d: 'm18.5 13.5.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z',
      },
    },
    {
      tag: 'path',
      attrs: {
        d: 'm5.5 14 .55 1.65 1.65.55-1.65.55-.55 1.65-.55-1.65-1.65-.55 1.65-.55.55-1.65Z',
      },
    },
  ],
  sliders: [
    { tag: 'path', attrs: { d: 'M4 6h6' } },
    { tag: 'path', attrs: { d: 'M14 6h6' } },
    { tag: 'circle', attrs: { cx: 12, cy: 6, r: 2 } },
    { tag: 'path', attrs: { d: 'M4 12h10' } },
    { tag: 'path', attrs: { d: 'M18 12h2' } },
    { tag: 'circle', attrs: { cx: 16, cy: 12, r: 2 } },
    { tag: 'path', attrs: { d: 'M4 18h2' } },
    { tag: 'path', attrs: { d: 'M10 18h10' } },
    { tag: 'circle', attrs: { cx: 8, cy: 18, r: 2 } },
  ],
  warning: [
    { tag: 'path', attrs: { d: 'm12 4 10 17H2L12 4Z' } },
    { tag: 'path', attrs: { d: 'M12 9v5' } },
    { tag: 'path', attrs: { d: 'M12 17h.01' } },
  ],
  sun: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } },
    { tag: 'path', attrs: { d: 'M12 2.5v2.25' } },
    { tag: 'path', attrs: { d: 'M12 19.25v2.25' } },
    { tag: 'path', attrs: { d: 'm4.93 4.93 1.6 1.6' } },
    { tag: 'path', attrs: { d: 'm17.47 17.47 1.6 1.6' } },
    { tag: 'path', attrs: { d: 'M2.5 12h2.25' } },
    { tag: 'path', attrs: { d: 'M19.25 12h2.25' } },
    { tag: 'path', attrs: { d: 'm4.93 19.07 1.6-1.6' } },
    { tag: 'path', attrs: { d: 'm17.47 6.53 1.6-1.6' } },
  ],
  github: [
    {
      tag: 'path',
      attrs: {
        d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
      },
    },
    { tag: 'path', attrs: { d: 'M9 18c-4.51 2-5-2-7-2' } },
  ],
  spinner: [{ tag: 'path', attrs: { d: 'M21 12a9 9 0 1 1-6.219-8.56' } }],
  shuffle: [
    { tag: 'path', attrs: { d: 'M18 8h3V5' } },
    {
      tag: 'path',
      attrs: { d: 'M3 19h4a4 4 0 0 0 3.2-1.6l3.6-4.8A4 4 0 0 1 17 11h4' },
    },
    { tag: 'path', attrs: { d: 'M18 16v3h3' } },
    {
      tag: 'path',
      attrs: { d: 'M3 5h4a4 4 0 0 1 3.2 1.6l3.6 4.8A4 4 0 0 0 17 13h4' },
    },
  ],
  eye: [
    {
      tag: 'path',
      attrs: { d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' },
    },
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 3 } },
  ],
  wand: [
    { tag: 'path', attrs: { d: 'm10 10-8 8V22h4l8-8' } },
    { tag: 'path', attrs: { d: 'm14 6 4 4' } },
    { tag: 'path', attrs: { d: 'M18 2h.01' } },
    { tag: 'path', attrs: { d: 'M22 6h.01' } },
    { tag: 'path', attrs: { d: 'M22 2h.01' } },
  ],
  trash: [
    { tag: 'path', attrs: { d: 'M3 6h18' } },
    { tag: 'path', attrs: { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' } },
    { tag: 'path', attrs: { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' } },
  ],
  image: [
    { tag: 'rect', attrs: { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 } },
    { tag: 'circle', attrs: { cx: 8.5, cy: 8.5, r: 1.5 } },
    { tag: 'path', attrs: { d: 'M21 15l-5-5L5 17' } },
  ],
  music: [
    {
      tag: 'path',
      attrs: {
        d: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
      },
    },
  ],
  refresh: [
    {
      tag: 'path',
      attrs: {
        d: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
      },
    },
  ],
} as const satisfies Record<string, readonly IconNode[]>;

export type UiIconName = keyof typeof ICON_NODES;

type RenderIconOptions = {
  className?: string;
  title?: string;
};

function escapeAttribute(value: string) {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return match;
    }
  });
}

export function renderIconSvg(
  name: UiIconName,
  options: RenderIconOptions = {},
) {
  const body = ICON_NODES[name]
    .map(
      ({ tag, attrs }) =>
        `<${tag}${Object.entries(attrs)
          .map(([key, value]) => ` ${key}="${escapeAttribute(String(value))}"`)
          .join('')} />`,
    )
    .join('');
  const className = options.className
    ? ` class="${escapeAttribute(options.className)}"`
    : '';
  const title = options.title
    ? `<title>${escapeAttribute(options.title)}</title>`
    : '';

  return `<svg${className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true" data-icon="${escapeAttribute(name)}">${title}${body}</svg>`;
}

export function replaceIconContents(
  target: Element | null | undefined,
  name: UiIconName,
  options: RenderIconOptions = {},
) {
  if (!target) return;
  target.innerHTML = renderIconSvg(name, options);
}

export function getIconNodes(name: UiIconName) {
  return ICON_NODES[name];
}
