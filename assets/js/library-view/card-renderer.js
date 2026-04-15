import { ensureIconSymbol, SVG_NS } from './icon-sprite.js';

const titleCaseLabel = (value = '') =>
  value
    .replace(/\s*·\s*/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());

const normalizeGuideKey = (value = '') =>
  value
    .toLowerCase()
    .replace(/\s*·\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const guidesOverlap = (left, right) => {
  const normalizedLeft = normalizeGuideKey(left);
  const normalizedRight = normalizeGuideKey(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
};

const getInteractionSignal = (toy) => {
  if (toy.capabilities?.motion) return 'Tilt';
  const tags = (toy.tags ?? []).map((tag) => tag.toLowerCase());
  if (
    tags.some((tag) =>
      ['touch', 'gestural', 'sculpting', 'pottery', 'haptics'].includes(tag),
    )
  ) {
    return 'Touch-led';
  }
  return null;
};

const getCardSignals = (toy) => {
  const signals = [];
  const interactionSignal = getInteractionSignal(toy);
  if (interactionSignal) {
    signals.push(interactionSignal);
  }

  (toy.moods ?? []).slice(0, 2).forEach((mood) => {
    const label = titleCaseLabel(mood);
    if (!signals.includes(label)) {
      signals.push(label);
    }
  });

  return signals.slice(0, 3);
};

const getPrimaryGuideLabel = (toy) => {
  if (toy.starterPreset?.label) {
    return titleCaseLabel(toy.starterPreset.label);
  }
  if (toy.capabilities?.motion) {
    return 'Tilt your device';
  }
  if (getInteractionSignal(toy) === 'Touch-led') {
    return 'Use touch';
  }
  if (toy.wowControl) {
    return titleCaseLabel(toy.wowControl);
  }
  if (toy.controls?.[0]) {
    return titleCaseLabel(toy.controls[0]);
  }
  if (toy.recommendedCapability === 'microphone') {
    return 'Use live mic';
  }
  if (toy.recommendedCapability === 'demoAudio') {
    return 'Use demo audio';
  }
  return null;
};

const getSecondaryGuideLabel = (toy, primaryGuide) => {
  if (toy.wowControl) {
    const wowLabel = titleCaseLabel(toy.wowControl);
    const usesPresetLanguage = /preset|starter/i.test(wowLabel);
    if (!guidesOverlap(primaryGuide, wowLabel) && !usesPresetLanguage) {
      return wowLabel;
    }
  }

  if (
    toy.recommendedCapability === 'microphone' &&
    !guidesOverlap(primaryGuide, 'Use live mic')
  ) {
    return 'Use live mic';
  }

  if (
    toy.recommendedCapability === 'demoAudio' &&
    !guidesOverlap(primaryGuide, 'Use demo audio')
  ) {
    return 'Use demo audio';
  }

  return null;
};

const getCardGuidance = (toy) => {
  const primaryGuide = getPrimaryGuideLabel(toy);
  const secondaryGuide = getSecondaryGuideLabel(toy, primaryGuide);
  const guides = [primaryGuide, secondaryGuide].filter(Boolean);

  if (guides.length > 0) {
    return `Try: ${guides.join(' • ')}`;
  }

  if (toy.firstRunHint) {
    return toy.firstRunHint;
  }

  return null;
};

export const createLibraryCardRenderer = ({
  document,
  cardElement,
  enableIcons,
  enableCapabilityBadges,
  getToyHref,
  getMatchedFields,
  openToy,
}) => ({
  createCard(toy, queryTokens = []) {
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

    const href = getToyHref(toy);
    if (cardElement === 'button') {
      card.type = 'button';
    } else if (cardElement === 'a') {
      card.href = href;
      card.setAttribute('data-toy-href', href);
    }

    if (enableIcons) {
      const symbolId = ensureIconSymbol(toy);
      if (symbolId) {
        const icon = document.createElementNS(SVG_NS, 'svg');
        icon.classList.add('toy-icon');
        icon.setAttribute('viewBox', '0 0 120 120');
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', `${toy.title} icon`);

        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = `${toy.title} icon`;
        icon.appendChild(title);

        const use = document.createElementNS(SVG_NS, 'use');
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
    card.append(title, desc);

    const guidance = getCardGuidance(toy);
    if (guidance) {
      const guidanceNode = document.createElement('p');
      guidanceNode.className = 'webtoy-card-guidance';
      guidanceNode.textContent = guidance;
      card.appendChild(guidanceNode);
    }

    const matchedFields = getMatchedFields(toy, queryTokens);
    if (matchedFields.length > 0) {
      const matches = document.createElement('p');
      matches.className = 'webtoy-card-match';

      const label = document.createElement('strong');
      label.textContent = 'Matches:';
      matches.appendChild(label);

      matchedFields.forEach((field) => {
        const matchToken = document.createElement('mark');
        matchToken.textContent = field;
        matches.appendChild(matchToken);
      });

      card.appendChild(matches);
    }

    if (enableCapabilityBadges) {
      const signals = getCardSignals(toy);
      if (signals.length > 0) {
        const metaRow = document.createElement('div');
        metaRow.className = 'webtoy-card-signals';
        signals.forEach((signal) => {
          const badge = document.createElement('span');
          badge.className = 'webtoy-card-signal';
          badge.textContent = signal;
          metaRow.appendChild(badge);
        });
        card.appendChild(metaRow);
      }
    }

    if (toy.type === 'module') {
      const actions = document.createElement('div');
      actions.className = 'webtoy-card-actions';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'cta-button cta-button--accent';
      open.textContent = 'Open controls';
      open.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const launchCard = event.currentTarget.closest('.webtoy-card');
        void openToy(toy, { launchCard });
      });
      open.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
        }
      });
      actions.appendChild(open);

      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'cta-button cta-button--muted';
      play.textContent = toy.capabilities?.demoAudio
        ? 'Start demo'
        : toy.capabilities?.microphone
          ? 'Start mic'
          : 'Launch';
      play.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const launchCard = event.currentTarget.closest('.webtoy-card');
        void openToy(toy, {
          preferDemoAudio: Boolean(toy.capabilities?.demoAudio),
          launchCard,
        });
      });
      play.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
        }
      });
      actions.appendChild(play);
      card.appendChild(actions);
    }

    return card;
  },
});
