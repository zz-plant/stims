import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { jsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js';
import { z } from 'zod';
import toysData from '../assets/js/toys-data.js';
import docsDevelopment from '../docs/DEVELOPMENT.md?raw';
import docsMcpServer from '../docs/MCP_SERVER.md?raw';
import docsReadme from '../docs/README.md?raw';
import docsToyDevelopment from '../docs/TOY_DEVELOPMENT.md?raw';
import docsToyScriptIndex from '../docs/TOY_SCRIPT_INDEX.md?raw';
import docsToys from '../docs/toys.md?raw';
import readme from '../README.md?raw';

const defaultInstructions =
  'Use these tools to surface documentation, toy metadata, loader behavior, and development commands for the Stim Webtoys library.';

const markdownSources = {
  'README.md': readme,
  'docs/README.md': docsReadme,
  'docs/MCP_SERVER.md': docsMcpServer,
  'docs/DEVELOPMENT.md': docsDevelopment,
  'docs/TOY_DEVELOPMENT.md': docsToyDevelopment,
  'docs/TOY_SCRIPT_INDEX.md': docsToyScriptIndex,
  'docs/toys.md': docsToys,
} as const;

type MarkdownSourceKey = keyof typeof markdownSources;

type DocSectionResult =
  | { ok: true; content: string }
  | { ok: false; message: string };

type CreateServerOptions = {
  instructions?: string;
  jsonSchemaValidator?: jsonSchemaValidator;
};

type ToyMetadata = {
  slug: string;
  title: string;
  description: string;
  requiresWebGPU: boolean;
  controls: string[];
  module: string | null;
  type: string | null;
  allowWebGLFallback: boolean;
  url: string;
};

const serverInfo = { name: 'stim-webtoys-mcp', version: '1.0.0' } as const;

function createMcpServer({
  instructions = defaultInstructions,
  jsonSchemaValidator,
}: CreateServerOptions = {}) {
  const server = new McpServer(serverInfo, {
    capabilities: { tools: {} },
    instructions,
    jsonSchemaValidator,
  });

  registerTools(server);

  return server;
}

function registerTools(server: McpServer) {
  server.registerTool(
    'list_docs',
    {
      description:
        'Return quick-start, runtime, repository layout, and toy catalog pointers from README.md with line references.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      const pointers = await buildDocPointers();

      return asTextResponse(pointers || 'README content was not available.');
    },
  );

  server.registerTool(
    'get_toys',
    {
      description:
        'Return structured toy metadata (including controls and module info) from assets/js/toys-data.js with optional slug or WebGPU filters.',
      inputSchema: z
        .object({
          slug: z
            .string()
            .trim()
            .optional()
            .describe('Limit results to a specific toy slug.'),
          requiresWebGPU: z
            .boolean()
            .optional()
            .describe(
              'Filter by WebGPU requirement (true = only WebGPU toys).',
            ),
        })
        .strict(),
    },
    async ({ slug, requiresWebGPU }) => {
      const toys = normalizeToys(toysData);

      const filtered = toys.filter((toy) => {
        if (slug && toy.slug !== slug) return false;
        if (
          typeof requiresWebGPU === 'boolean' &&
          toy.requiresWebGPU !== requiresWebGPU
        )
          return false;
        return true;
      });

      if (!filtered.length) {
        return asTextResponse('No toys matched the requested filters.');
      }

      return asTextResponse(JSON.stringify(filtered, null, 2));
    },
  );

  server.registerTool(
    'read_doc_section',
    {
      description:
        'Return an entire markdown file or a specific heading section from README.md or docs/*.md.',
      inputSchema: z
        .object({
          file: z
            .enum(
              Object.keys(markdownSources) as [
                MarkdownSourceKey,
                ...MarkdownSourceKey[],
              ],
            )
            .describe(
              'Markdown file to read (e.g., README.md or docs/MCP_SERVER.md).',
            ),
          heading: z
            .string()
            .trim()
            .optional()
            .describe(
              'Optional heading text to narrow the response to a single section.',
            ),
        })
        .strict(),
    },
    async ({ file, heading }) => {
      const result = await getDocSectionContent(file, heading);

      return asTextResponse(result.ok ? result.content : result.message);
    },
  );

  server.registerTool(
    'describe_loader',
    {
      description:
        'Summarize how toy loading and error handling works based on assets/js/loader.ts.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      const loaderDetails = [
        '- Loader derives the manifest path from the current URL to resolve compiled module files (`/.vite/manifest.json`).',
        '- Query param `toy` controls navigation; history updates keep the slug in the URL and restore the library view when removed.',
        '- `loadToy` clears any active toy, shows the active container, and gates WebGPU-only entries before importing modules.',
        '- Imports are resolved through Vite manifest entries when available, with fallbacks for relative and absolute module paths.',
        '- Visible status blocks appear while loading; errors render actionable messages for missing dev server, MIME mismatches, or file:// access.',
        '- A reusable “Back to Library” control and history updates let users return to the catalog without reloads.',
      ];

      return asTextResponse(loaderDetails.join('\n'));
    },
  );

  server.registerTool(
    'dev_commands',
    {
      description:
        'Return installation and development commands from README.md.',
      inputSchema: z
        .object({
          scope: z
            .enum(['setup', 'dev', 'build', 'test', 'lint'])
            .optional()
            .describe('Limit output to a specific workflow area.'),
        })
        .strict(),
    },
    async ({ scope }) => {
      const readmeContent = await loadReadme();
      const quickStart = extractSection(readmeContent, 'Quick Start');
      const localSetup = extractSection(readmeContent, 'Local Setup');
      const helpfulScripts = extractSection(
        readmeContent,
        'Helpful Scripts (Bun-first)',
      );
      const tests = extractSection(readmeContent, 'Running Tests');
      const linting = extractSection(readmeContent, 'Linting and Formatting');

      const sections: Record<string, string | null> = {
        setup:
          quickStart && localSetup
            ? `${quickStart}\n\n${localSetup}`
            : (quickStart ?? localSetup),
        dev: helpfulScripts,
        build: helpfulScripts,
        test: tests,
        lint: linting,
      };

      const text = scope
        ? sections[scope]
        : [quickStart, localSetup, helpfulScripts, tests, linting]
            .filter(Boolean)
            .join('\n\n');

      return asTextResponse(
        text || 'No development guidance was found in README.md.',
      );
    },
  );

  server.registerTool(
    'launch_toy',
    {
      description:
        'Launch a toy in headless mode and enable demo audio for visualization. Returns instructions for capturing screenshots or observing audio reactivity.',
      inputSchema: z
        .object({
          slug: z
            .string()
            .trim()
            .describe('The toy slug to launch (e.g., "holy", "spiral-burst").'),
          port: z
            .number()
            .int()
            .min(1024)
            .max(65535)
            .optional()
            .default(5173)
            .describe('Dev server port (defaults to 5173).'),
        })
        .strict(),
    },
    async ({ slug, port = 5173 }) => {
      const toy = normalizeToys(toysData).find((t) => t.slug === slug);

      if (!toy) {
        return asTextResponse(
          `Toy "${slug}" not found. Use get_toys to list available toys.`,
        );
      }

      const url = `http://localhost:${port}/toy.html?toy=${encodeURIComponent(slug)}`;

      const instructions = [
        `# Launching ${toy.title}`,
        '',
        `**URL:** ${url}`,
        `**Description:** ${toy.description}`,
        '',
        '## Steps to interact:',
        '1. Ensure dev server is running: `bun run dev`',
        '2. Open the URL in a browser or headless browser',
        '3. Look for the audio prompt modal',
        '4. Click "Use demo audio" to enable procedural audio',
        '5. Wait 3-5 seconds for the visualization to react',
        '',
        '## What to observe:',
        toy.requiresWebGPU
          ? '- This toy requires WebGPU support'
          : '- This toy runs with WebGL',
        '- Visual effects that pulse with bass frequencies',
        '- Color changes responding to mid-range frequencies',
        '- Sparkles or fine details reacting to high frequencies',
        '',
        '## Controls:',
        ...(toy.controls.length > 0
          ? toy.controls.map((c) => `- ${c}`)
          : ['- No custom controls documented']),
        '',
        '**Press Escape to return to the library.**',
      ].join('\n');

      return asTextResponse(instructions);
    },
  );

  server.registerTool(
    'get_toy_audio_reactivity_guide',
    {
      description:
        'Get a guide on how toys respond to audio frequencies and what visual effects to look for when a toy is playing with demo audio.',
      inputSchema: z
        .object({
          slug: z
            .string()
            .trim()
            .optional()
            .describe('Specific toy slug for targeted guidance.'),
        })
        .strict(),
    },
    async ({ slug }) => {
      const guide = [
        '# Audio Reactivity Guide',
        '',
        '## How Toys React to Audio',
        '',
        'Stim toys use the AudioHandler to analyze frequency bands and translate them into visual effects:',
        '',
        '### Frequency Band Mapping',
        '- **Bass (20-250 Hz)**: Large-scale movements, pulses, expansions',
        '  - Examples: Halo size, spiral burst radius, camera shake',
        '  - Visual cues: Scaling, position offsets, bloom intensity',
        '',
        '- **Mids (250-4000 Hz)**: Color shifts, rotations, secondary motion',
        '  - Examples: Hue cycling, particle velocity, shape morphing',
        '  - Visual cues: Color temperature, rotation speed, warp effects',
        '',
        '- **Highs (4000-20000 Hz)**: Fine details, sparkles, edge effects',
        '  - Examples: Particle emission, shimmer, grain noise',
        '  - Visual cues: Brightness spikes, detail layers, pixel shimmer',
        '',
        '### Common Audio-Reactive Patterns',
        '1. **Beat detection**: Sudden visual changes on strong transients',
        '2. **Smoothed envelopes**: Gradual visual changes following energy curves',
        '3. **Multi-band visualization**: Different visual elements per frequency band',
        '',
        '## Demo Audio',
        'Demo audio is procedural and contains:',
        '- Consistent bass beats for rhythm',
        '- Melodic mid-range content',
        '- High-frequency harmonics and noise bursts',
        '',
        '## What to Look For',
        'When observing a toy with demo audio:',
        '- Note the timing between audio events and visual changes',
        '- Watch for different elements reacting to different frequencies',
        '- Check if effects are smooth (filtered) or immediate (unfiltered)',
        '- Observe if there are distinct "layers" of reactivity',
      ];

      if (slug) {
        const toy = normalizeToys(toysData).find((t) => t.slug === slug);
        if (toy) {
          guide.push('', `## Specific to "${toy.title}"`, '');
          guide.push(`**Description:** ${toy.description}`);

          // Add slug-specific hints based on known toys
          const slugHints: Record<string, string[]> = {
            holy: [
              '- Watch for halos expanding on bass',
              '- Particles burst on high frequencies',
              '- Color cycles with melodic content',
            ],
            'spiral-burst': [
              '- Spirals expand/contract with bass',
              '- Rotation speed follows mid frequencies',
              '- Multiple spiral arms react independently',
            ],
            'neon-wave': [
              '- Grid ripples on bass hits',
              '- Bloom intensity pulses with volume',
              '- Color theme affects overall palette',
            ],
            geom: [
              '- 3D shapes morph with frequencies',
              '- Camera movement reacts to bass',
              '- Geometry complexity changes with energy',
            ],
          };

          if (slugHints[slug]) {
            guide.push('', '### Expected Behaviors:', ...slugHints[slug]);
          }
        }
      }

      return asTextResponse(guide.join('\n'));
    },
  );
}

async function loadReadme() {
  return markdownSources['README.md'];
}

async function loadReadmeLines() {
  const readmeContent = await loadReadme();
  return readmeContent.split(/\r?\n/);
}

type SectionExcerpt = {
  startLine: number;
  endLine: number;
  content: string[];
};

async function buildDocPointers() {
  const lines = await loadReadmeLines();

  const quickStart = extractSectionWithRange(lines, 'Quick Start');
  const layout = extractSectionWithRange(lines, 'Repository Layout');
  const toys = extractSectionWithRange(lines, 'Toys in the Collection');
  const runtime = extractRuntimeRange(lines);

  const entries = [
    quickStart && formatPointer('Quick start steps', quickStart),
    runtime && formatPointer('Runtime options (Bun)', runtime),
    layout && formatPointer('Repository layout', layout),
    toys && formatPointer('Toy catalog link targets', toys),
  ].filter(Boolean) as string[];

  return entries.join('\n\n');
}

function formatPointer(title: string, excerpt: SectionExcerpt) {
  const range = `README.md:L${excerpt.startLine}-L${excerpt.endLine}`;
  return `${title} (${range})\n${excerpt.content.join('\n')}`;
}

function extractSectionWithRange(
  lines: string[],
  heading: string,
): SectionExcerpt | null {
  const headingIndex = lines.findIndex(
    (line) => line.trim() === `## ${heading}`,
  );

  if (headingIndex === -1) return null;

  const nextHeadingOffset = lines
    .slice(headingIndex + 1)
    .findIndex((line) => line.trim().startsWith('## '));
  const nextHeadingIndex =
    nextHeadingOffset === -1
      ? lines.length
      : headingIndex + 1 + nextHeadingOffset;
  const endIndex = Math.max(headingIndex, nextHeadingIndex - 1);

  return {
    startLine: headingIndex + 1,
    endLine: endIndex + 1,
    content: lines.slice(headingIndex, nextHeadingIndex),
  };
}

function extractRuntimeRange(lines: string[]): SectionExcerpt | null {
  const startIndex = lines.findIndex((line) =>
    line.includes('Choose your runtime'),
  );

  if (startIndex === -1) return null;

  let endIndex = startIndex;

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();

    if (/^\d+\.\s/.test(trimmed) || trimmed.startsWith('## ')) {
      break;
    }

    endIndex = i;
  }

  return {
    startLine: startIndex + 1,
    endLine: endIndex + 1,
    content: lines.slice(startIndex, endIndex + 1),
  };
}

function extractSection(markdown: string, heading: string) {
  return extractMarkdownSection(markdown, heading)?.content ?? null;
}

function escapeForRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asTextResponse(text: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
  };
}

function normalizeToys(data: unknown): ToyMetadata[] {
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;

      const slug = typeof entry.slug === 'string' ? entry.slug : null;
      const title = typeof entry.title === 'string' ? entry.title : '';
      const description =
        typeof entry.description === 'string' ? entry.description : '';
      const requiresWebGPU =
        typeof entry.requiresWebGPU === 'boolean'
          ? entry.requiresWebGPU
          : false;
      const module = typeof entry.module === 'string' ? entry.module : null;
      const type = typeof entry.type === 'string' ? entry.type : null;
      const allowWebGLFallback =
        typeof entry.allowWebGLFallback === 'boolean'
          ? entry.allowWebGLFallback
          : false;
      const controls = Array.isArray(entry.controls)
        ? entry.controls.filter(
            (control): control is string => typeof control === 'string',
          )
        : [];

      if (!slug) return null;

      return {
        slug,
        title: title || slug,
        description,
        requiresWebGPU,
        controls,
        module,
        type,
        allowWebGLFallback,
        url: `toy.html?toy=${encodeURIComponent(slug)}`,
      };
    })
    .filter((entry): entry is ToyMetadata => Boolean(entry));
}

function extractMarkdownSection(markdown: string, heading: string) {
  const pattern = new RegExp(
    `^(#{1,6}\\s+${escapeForRegex(heading)})\\s*$`,
    'm',
  );
  const match = pattern.exec(markdown);

  if (!match) return null;

  const startIndex = match.index + match[0].length;
  const rest = markdown.slice(startIndex);
  const nextHeading = rest.search(/^#{1,6}\\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return {
    heading: match[1].trim(),
    content: section.trim(),
  };
}

async function loadMarkdownFile(file: MarkdownSourceKey) {
  const resolved = markdownSources[file];

  if (!resolved) {
    throw new Error(`Unsupported markdown file: ${file}`);
  }

  return resolved;
}

async function getDocSectionContent(
  file: MarkdownSourceKey,
  heading?: string | null,
): Promise<DocSectionResult> {
  if (!markdownSources[file]) {
    return {
      ok: false,
      message: `The file "${file}" is not available for reading.`,
    };
  }

  try {
    const markdown = await loadMarkdownFile(file);

    if (!heading) {
      return { ok: true, content: markdown.trim() };
    }

    const section = extractMarkdownSection(markdown, heading);

    if (!section) {
      return {
        ok: false,
        message: `Heading "${heading}" was not found in ${file}.`,
      };
    }

    const text = `${section.heading}\n${section.content}`.trim();
    return { ok: true, content: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, message: `Could not read ${file}: ${message}` };
  }
}

export type { DocSectionResult, MarkdownSourceKey, ToyMetadata };
export {
  asTextResponse,
  buildDocPointers,
  createMcpServer,
  extractMarkdownSection,
  extractRuntimeRange,
  extractSection,
  extractSectionWithRange,
  getDocSectionContent,
  loadReadme,
  loadReadmeLines,
  markdownSources,
  normalizeToys,
  registerTools,
};
