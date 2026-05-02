import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import {
  WorkspaceLaunchPanel,
  WorkspaceStagePanel,
  WorkspaceToast,
  WorkspaceToolSheet,
} from './workspace-ui.tsx';

const MOCK_CATALOG: PresetCatalogEntry[] = [
  {
    id: 'eos-glowsticks-v2-03-music',
    title: 'Eos Glowsticks',
    author: 'Eos',
    tags: ['classic', 'bright'],
    supports: { webgl: true, webgpu: true },
    visualCertification: {
      status: 'certified',
      measured: true,
      source: 'reference-suite',
      fidelityClass: 'exact',
      visualEvidenceTier: 'visual',
      requiredBackend: 'webgl',
      actualBackend: 'webgl',
      reasons: [],
    },
  },
  {
    id: 'rovastar-parallel-universe',
    title: 'Parallel Universe',
    author: 'Rovastar',
    tags: ['space', 'moody'],
    supports: { webgl: true, webgpu: true },
    visualCertification: {
      status: 'certified',
      measured: true,
      source: 'reference-suite',
      fidelityClass: 'near-exact',
      visualEvidenceTier: 'visual',
      requiredBackend: 'webgl',
      actualBackend: 'webgl',
      reasons: [],
    },
  },
  {
    id: 'eos-phat-cubetrace-v2',
    title: 'Phat Cubetrace',
    author: 'Eos',
    tags: ['geometry', 'classic'],
    supports: { webgl: true, webgpu: true },
    visualCertification: {
      status: 'certified',
      measured: true,
      source: 'reference-suite',
      fidelityClass: 'partial',
      visualEvidenceTier: 'visual',
      requiredBackend: 'webgl',
      actualBackend: 'webgl',
      reasons: [],
    },
  },
  {
    id: 'krash-rovastar-cerebral-demons-stars',
    title: 'Cerebral Demons Stars',
    author: 'Krash / Rovastar',
    tags: ['psychedelic', 'motion'],
    supports: { webgl: true, webgpu: false },
  },
];

function getQueryParams() {
  const url = new URL(window.location.href);
  const component = url.searchParams.get('component') ?? 'WorkspaceLaunchPanel';
  const propsParam = url.searchParams.get('props');
  const props = propsParam
    ? (JSON.parse(decodeURIComponent(propsParam)) as Record<string, unknown>)
    : {};
  const mockBackend = url.searchParams.get('mockBackend') ?? 'webgl';
  const mockPresetId = url.searchParams.get('mockPresetId') ?? null;
  const mockAudioActive = url.searchParams.get('mockAudioActive') === 'true';
  const gridParam = url.searchParams.get('grid');
  const gridWidths = gridParam
    ? gridParam
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter(Boolean)
    : null;
  return {
    component,
    props,
    mockBackend,
    mockPresetId,
    mockAudioActive,
    gridWidths,
  };
}

function useHarnessState() {
  return getQueryParams();
}

function MockWorkspaceLaunchPanel(overrides: Record<string, unknown>) {
  return (
    <WorkspaceLaunchPanel
      embedded={Boolean(overrides.embedded)}
      engineReady={true}
      favoritePresets={MOCK_CATALOG.filter(
        (c) => c.id === 'eos-glowsticks-v2-03-music',
      )}
      featuredPreset={MOCK_CATALOG[0] ?? null}
      launchEyebrow="MilkDrop in the browser"
      launchSummary="Start with demo audio now, then switch to your own music whenever you want the motion to track live sound."
      launchTitle="Start music-reactive color and motion in seconds."
      missingRequestedPreset={false}
      onAudioStart={() => {}}
      onBrowseRecovery={() => {}}
      onFeaturedPresetSelection={() => {}}
      onLoadRecentYouTubeVideo={() => {}}
      onLoadYouTube={() => {}}
      onPresetSelection={() => {}}
      onToggleExtendedSources={() => {}}
      onYoutubeUrlChange={() => {}}
      onYoutubeUrlKeyDown={() => {}}
      presetPreviews={{}}
      readinessAlerts={[]}
      recentYouTubeVideos={[]}
      requestedPresetId={null}
      recentPresets={MOCK_CATALOG.slice(1, 3)}
      showExtendedSources={false}
      youtubeCanLoad={false}
      youtubeFeedback=""
      youtubeInputInvalid={false}
      youtubeLoading={false}
      youtubePreviewRef={{ current: null }}
      youtubeReady={false}
      youtubeUrl=""
      {...overrides}
    />
  );
}

function MockWorkspaceStagePanel(overrides: Record<string, unknown>) {
  return (
    <WorkspaceStagePanel
      audioEnergy={0.5}
      audioSource="demo"
      backend="webgl"
      engineReady={true}
      invalidExperienceSlug={null}
      isFullscreen={false}
      launchPanel={MockWorkspaceLaunchPanel({ embedded: true })}
      liveMode={false}
      missingRequestedPreset={false}
      onAudioStart={() => {}}
      onLoadRecentYouTubeVideo={() => {}}
      onLoadYouTube={() => {}}
      onOpenBrowse={() => {}}
      onOpenSettings={() => {}}
      onShowCurrentLink={() => {}}
      onShufflePreset={() => {}}
      onToggleExtendedSources={() => {}}
      onToggleFullscreen={() => {}}
      onToggleTheme={() => {}}
      onYoutubeUrlChange={() => {}}
      onYoutubeUrlKeyDown={() => {}}
      panel={null}
      recentYouTubeVideos={[]}
      stageEyebrow="Ready when you are"
      stageRef={{ current: null }}
      stageSummary="Featured pick"
      stageTitle="Eos Glowsticks"
      showExtendedSources={false}
      youtubeCanLoad={false}
      youtubeFeedback=""
      youtubeInputInvalid={false}
      youtubeLoading={false}
      youtubePreviewRef={{ current: null }}
      youtubeReady={false}
      youtubeUrl=""
      {...overrides}
    />
  );
}

function MockWorkspaceToolSheet(overrides: Record<string, unknown>) {
  const routeState: SessionRouteState = {
    presetId: null,
    collectionTag: null,
    panel: 'browse' as PanelState,
    audioSource: null,
    agentMode: false,
    invalidExperienceSlug: null,
  };
  return (
    <WorkspaceToolSheet
      catalog={MOCK_CATALOG}
      catalogError={null}
      catalogReady={true}
      collectionTags={['classic', 'bright', 'space', 'moody', 'geometry']}
      currentPresetId={null}
      favoritePresets={MOCK_CATALOG.slice(0, 1)}
      filteredCatalog={MOCK_CATALOG}
      motionPreference={{ enabled: true }}
      onClose={() => {}}
      onCollectionTagChange={() => {}}
      onCompatibilityModeChange={() => {}}
      onImport={() => {}}
      onMotionPreferenceChange={() => {}}
      onPresetSelection={() => {}}
      onQualityPresetChange={() => {}}
      onRefreshPresetPreviews={() => {}}
      onRenderPreferenceChange={() => {}}
      onSearchQueryChange={() => {}}
      onShowCurrentLink={() => {}}
      onShufflePreset={() => {}}
      onTabChange={() => {}}
      onVisiblePresetIdsChange={() => {}}
      onExportPreset={() => {}}
      panel="browse"
      presetPreviews={{}}
      qualityPreset={{
        id: 'balanced',
        label: 'Balanced',
        description: 'Good default',
        maxPixelRatio: 1.5,
      }}
      recentPresets={MOCK_CATALOG.slice(1, 2)}
      renderPreferences={{
        renderScale: 1,
        maxPixelRatio: 1.5,
        compatibilityMode: false,
      }}
      routeState={routeState}
      searchQuery=""
      starterPresets={MOCK_CATALOG.slice(0, 4).map((preset, index) => ({
        key: `starter-${index}`,
        preset,
        label:
          ['Start here', 'Try this', 'Fan favorite', 'Deep cut'][index] ??
          'Pick',
        summary: 'A great preset to begin with.',
      }))}
      stageAnchoredToolOpen={false}
      {...overrides}
    />
  );
}

function MockWorkspaceToast(overrides: Record<string, unknown>) {
  return (
    <WorkspaceToast
      toast={{ message: 'Using lighter visual mode.', tone: 'warn' }}
      onDismiss={() => {}}
      {...overrides}
    />
  );
}

const COMPONENT_REGISTRY: Record<
  string,
  (props: Record<string, unknown>) => React.ReactElement
> = {
  WorkspaceLaunchPanel: MockWorkspaceLaunchPanel,
  WorkspaceStagePanel: MockWorkspaceStagePanel,
  WorkspaceToolSheet: MockWorkspaceToolSheet,
  WorkspaceToast: MockWorkspaceToast,
};

function SingleViewport({
  width,
  component,
  props,
}: {
  width?: number;
  component: string;
  props: Record<string, unknown>;
}) {
  const renderComponent =
    COMPONENT_REGISTRY[component] ?? MockWorkspaceLaunchPanel;
  return (
    <div
      style={{
        width: width ? `${width}px` : '100%',
        border: '1px dashed rgba(255,255,255,0.15)',
        borderRadius: '12px',
        overflow: 'hidden',
        background: '#05070d',
      }}
    >
      {width ? (
        <div
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.05)',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {width}px
        </div>
      ) : null}
      <div style={{ padding: width ? '12px' : '0' }}>
        {renderComponent(props)}
      </div>
    </div>
  );
}

function HarnessDashboard() {
  const { component, props, gridWidths } = useHarnessState();

  const widths = gridWidths ?? [undefined];

  return (
    <div
      style={{
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: '1.5rem',
            margin: 0,
          }}
        >
          Stims UI Iteration Harness
        </h1>
        <span
          style={{
            fontSize: '0.72rem',
            color: 'rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.06)',
            padding: '4px 10px',
            borderRadius: '6px',
          }}
        >
          {component}
        </span>
      </header>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '24px',
          alignItems: 'flex-start',
        }}
      >
        {widths.map((width) => (
          <SingleViewport
            key={width ?? 'auto'}
            width={width}
            component={component}
            props={props}
          />
        ))}
      </div>

      <footer
        style={{
          fontSize: '0.72rem',
          color: 'rgba(255,255,255,0.35)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingTop: '16px',
        }}
      >
        <p>
          Query params:{' '}
          <code>
            ?component=Name&props=&#123;...&#125;&grid=375,768,1024,1920
          </code>
        </p>
        <p>Registered: {Object.keys(COMPONENT_REGISTRY).join(', ')}</p>
      </footer>
    </div>
  );
}

function startHarness() {
  const container = document.getElementById('ui-harness');
  if (!container) {
    throw new Error('Missing #ui-harness container');
  }
  createRoot(container).render(
    createElement(StrictMode, null, createElement(HarnessDashboard, null)),
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startHarness, { once: true });
} else {
  startHarness();
}
