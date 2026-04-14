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
