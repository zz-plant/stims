import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceProvider } from './workspace-context.tsx';
import { WorkspaceStagePanel, WorkspaceToast } from './workspace-ui.tsx';

function getQueryParams() {
  const url = new URL(window.location.href);
  const component = url.searchParams.get('component') ?? 'WorkspaceStagePanel';
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

function MockWorkspaceStagePanel(overrides: Record<string, unknown>) {
  return (
    <WorkspaceStagePanel
      isFullscreen={false}
      launchPanel={
        <div style={{ padding: 24 }}>
          <h2>Launch Panel Placeholder</h2>
        </div>
      }
      liveMode={false}
      onToggleFullscreen={() => {}}
      stageEyebrow="Ready when you are"
      stageSummary="Featured pick"
      stageTitle="Eos Glowsticks"
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
  WorkspaceStagePanel: MockWorkspaceStagePanel,
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
    COMPONENT_REGISTRY[component] ?? MockWorkspaceStagePanel;
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
        <WorkspaceProvider>{renderComponent(props)}</WorkspaceProvider>
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
