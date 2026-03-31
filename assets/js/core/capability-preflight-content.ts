import type { CapabilityPreflightResult } from './services/capability-probe-service.ts';

type StatusCardSummary = {
  value: string;
  note: string;
  variant: 'ok' | 'warn' | 'error';
};

type NextStepContent = {
  title: string;
  steps: string[];
  showGrantAction: boolean;
};

function buildStatusBadge(
  label: string,
  value: string,
  variant: 'ok' | 'warn' | 'error',
) {
  const badge = document.createElement('div');
  badge.className = 'preflight-status';
  badge.dataset.variant = variant;

  const title = document.createElement('p');
  title.className = 'preflight-status__label';
  title.textContent = label;
  badge.appendChild(title);

  const state = document.createElement('p');
  state.className = 'preflight-status__value';
  state.textContent = value;
  badge.appendChild(state);

  return badge;
}

function getPerformanceCheckSummary(
  result: CapabilityPreflightResult,
): StatusCardSummary {
  if (!result.rendering.rendererBackend) {
    return {
      value: 'Unavailable on this device',
      note: 'Graphics acceleration was not detected.',
      variant: 'error',
    };
  }

  if (result.performance.lowPower) {
    return {
      value: 'Recommended: lighter visuals',
      note: 'Use reduced quality for smoother playback on this device.',
      variant: 'warn',
    };
  }

  if (result.performance.recommendedQualityPresetId === 'hi-fi') {
    return {
      value: 'Ready for hi-fi visuals',
      note: 'This GPU can handle the richer WebGPU preset by default.',
      variant: 'ok',
    };
  }

  if (result.rendering.rendererBackend === 'webgl') {
    return {
      value: 'Ready in compatibility mode',
      note: 'WebGL is active and optimized for compatibility.',
      variant: 'warn',
    };
  }

  return {
    value: 'Ready for full visuals',
    note: 'WebGPU is available for best-quality rendering.',
    variant: 'ok',
  };
}

function getAudioInputSummary(
  result: CapabilityPreflightResult,
): StatusCardSummary {
  if (!result.microphone.supported) {
    return {
      value: 'Use demo, tab, or YouTube audio',
      note: 'Microphone APIs are unavailable in this browser.',
      variant: 'warn',
    };
  }

  if (result.microphone.state === 'denied') {
    return {
      value: 'Continue with demo audio now',
      note: 'You can keep going with demo audio, then enable microphone access in site settings anytime.',
      variant: 'warn',
    };
  }

  if (result.microphone.state === 'granted') {
    return {
      value: 'Microphone ready',
      note: 'Live audio can start immediately.',
      variant: 'ok',
    };
  }

  return {
    value: 'Microphone permission check pending',
    note: 'You can grant access from this panel, or use alternate audio.',
    variant: 'warn',
  };
}

function getNextStepContent(
  result: CapabilityPreflightResult,
): NextStepContent {
  if (!result.canProceed) {
    return {
      title: 'Best next step',
      steps: result.blockingIssues.length
        ? [
            'Use a browser or device with graphics acceleration enabled.',
            'Or head back to Stims to review the browser requirements first.',
          ]
        : ['Review the guidance below before continuing.'],
      showGrantAction: false,
    };
  }

  if (!result.microphone.supported) {
    return {
      title: 'Best next step',
      steps: [
        'Continue to audio setup.',
        'Start with demo audio, tab audio, or YouTube audio.',
      ],
      showGrantAction: false,
    };
  }

  if (result.microphone.state === 'granted') {
    return {
      title: 'Best next step',
      steps: ['Continue to audio setup.', 'Mic mode is ready immediately.'],
      showGrantAction: false,
    };
  }

  if (result.microphone.state === 'denied') {
    return {
      title: 'Best next step',
      steps: [
        'Continue with demo audio now.',
        'Turn microphone access back on in site settings whenever you want live input.',
      ],
      showGrantAction: false,
    };
  }

  return {
    title: 'Best next step',
    steps: [
      'Continue to audio setup.',
      'Allow microphone access there, or skip it and start with demo audio.',
    ],
    showGrantAction: true,
  };
}

export function updatePreflightNextStep(
  container: HTMLElement,
  result: CapabilityPreflightResult,
  onGrantMicrophone: (() => void) | null,
) {
  container.innerHTML = '';

  const content = getNextStepContent(result);

  const heading = document.createElement('p');
  heading.className = 'preflight-panel__eyebrow';
  heading.textContent = content.title;
  container.appendChild(heading);

  const list = document.createElement('ol');
  list.className = 'preflight-panel__issues';

  content.steps.forEach((label) => {
    const item = document.createElement('li');
    item.textContent = label;
    list.appendChild(item);
  });

  container.appendChild(list);

  if (onGrantMicrophone && content.showGrantAction) {
    const grantButton = document.createElement('button');
    grantButton.type = 'button';
    grantButton.className = 'cta-button ghost';
    grantButton.textContent = 'Grant microphone access';
    grantButton.addEventListener('click', onGrantMicrophone);
    container.appendChild(grantButton);
  }
}

export function updatePreflightStatusList(
  container: HTMLElement,
  result: CapabilityPreflightResult,
) {
  container.innerHTML = '';

  const cards: Array<{
    label: string;
    summary: StatusCardSummary;
    className: string;
  }> = [
    {
      label: 'Visuals',
      summary: getPerformanceCheckSummary(result),
      className: 'preflight-status--primary',
    },
    {
      label: 'Audio',
      summary: getAudioInputSummary(result),
      className: 'preflight-status--supporting',
    },
  ];

  cards.forEach(({ label, summary, className }) => {
    const status = buildStatusBadge(label, summary.value, summary.variant);
    status.classList.add(className);

    const note = document.createElement('p');
    note.className = 'preflight-status__note';
    note.textContent = summary.note;
    status.appendChild(note);

    container.appendChild(status);
  });
}

export function updatePreflightWhyDetails(
  container: HTMLElement,
  result: CapabilityPreflightResult,
) {
  container.innerHTML = '';

  const items: string[] = [];

  if (result.rendering.rendererBackend === 'webgpu') {
    items.push('High-fidelity visuals are available on this device.');
  } else if (result.rendering.rendererBackend === 'webgl') {
    items.push(
      result.rendering.webgpuFallbackReason
        ? `Compatibility mode is active because ${result.rendering.webgpuFallbackReason}.`
        : 'Compatibility mode is active for broader browser support.',
    );
  } else {
    items.push('Graphics acceleration was not detected on this device.');
  }

  if (!result.microphone.supported) {
    items.push(
      'Microphone capture is unavailable here, so alternate audio options are recommended.',
    );
  } else if (result.microphone.state === 'denied') {
    items.push(
      'Microphone access is off right now; demo audio is the easiest fallback.',
    );
  } else if (
    result.microphone.state === 'prompt' ||
    result.microphone.state === 'unknown'
  ) {
    items.push(
      'Microphone access has not been confirmed yet and may prompt on start.',
    );
  } else {
    items.push('Microphone access is already available for live input.');
  }

  if (!result.environment.secureContext) {
    items.push(
      'This page is not running in a secure browser context, so some features may stay limited.',
    );
  }

  items.push(
    result.environment.reducedMotion
      ? 'Reduced motion preference is enabled; effects will soften.'
      : 'Standard motion effects are enabled.',
  );

  items.push(
    result.performance.recommendedQualityPresetId === 'hi-fi'
      ? 'Hi-fi visuals are recommended for this device.'
      : result.performance.recommendedQualityPresetId === 'performance'
        ? 'Lighter visuals are recommended for smoother playback.'
        : 'Balanced visuals are recommended for this device.',
  );

  const list = document.createElement('ul');
  list.className = 'preflight-panel__details-list';
  items.slice(0, 4).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  container.appendChild(list);
}

export function renderPreflightIssueList(
  container: HTMLElement,
  result: CapabilityPreflightResult,
) {
  container.innerHTML = '';
  const issues = result.blockingIssues.length
    ? result.blockingIssues
    : result.warnings;
  if (!issues.length) {
    const success = document.createElement('p');
    success.className = 'preflight-panel__success';
    success.textContent = 'System check passed.';
    container.appendChild(success);
    return;
  }

  const heading = document.createElement('p');
  heading.className = 'preflight-panel__eyebrow';
  heading.textContent = result.blockingIssues.length
    ? 'Action required'
    : 'Before you continue';
  container.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'preflight-panel__issues';
  issues.forEach((issue) => {
    const item = document.createElement('li');
    item.textContent = issue;
    list.appendChild(item);
  });
  container.appendChild(list);

  if (result.blockingIssues.length) {
    const support = document.createElement('div');
    support.className = 'preflight-panel__support';

    const supportTitle = document.createElement('p');
    supportTitle.className = 'preflight-panel__support-title';
    supportTitle.textContent = 'Why this won’t run here';
    support.appendChild(supportTitle);

    const supportText = document.createElement('p');
    supportText.className = 'preflight-panel__support-text';
    supportText.textContent =
      'This device cannot access WebGL/WebGPU, so 3D visuals cannot render. Try a supported browser or head back to Stims for the browser requirements and launch notes.';
    support.appendChild(supportText);

    const linkList = document.createElement('ul');
    linkList.className = 'preflight-panel__support-links';

    const browserItem = document.createElement('li');
    const browserLink = document.createElement('a');
    browserLink.href = 'https://webglreport.com/';
    browserLink.target = '_blank';
    browserLink.rel = 'noreferrer';
    browserLink.textContent = 'Check supported browsers (WebGL report)';
    browserItem.appendChild(browserLink);
    linkList.appendChild(browserItem);

    const fallbackItem = document.createElement('li');
    const fallbackLink = document.createElement('a');
    fallbackLink.href = '/#launches';
    fallbackLink.textContent = 'Review supported-browser guidance';
    fallbackItem.appendChild(fallbackLink);
    linkList.appendChild(fallbackItem);

    support.appendChild(linkList);
    container.appendChild(support);
  }
}
