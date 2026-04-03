import { afterEach, describe, expect, test } from 'bun:test';
import {
  hideYouTubeStageLayer,
  mountYouTubeStageLayer,
} from '../assets/js/ui/youtube-stage-layer.ts';

describe('YouTube stage layer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('mounts the player container into the active toy container overlay', () => {
    document.body.innerHTML = `
      <div id="active-toy-container"></div>
      <div id="youtube-player-container"><iframe id="youtube-player"></iframe></div>
    `;

    const playerContainer = document.getElementById(
      'youtube-player-container',
    ) as HTMLElement;
    const layer = mountYouTubeStageLayer(playerContainer);

    expect(layer).not.toBeNull();
    expect(layer?.dataset.youtubeStageLayer).toBe('true');
    expect(layer?.dataset.preserve).toBe('toy-ui');
    expect(layer?.contains(playerContainer)).toBe(true);
    expect(
      playerContainer.classList.contains('control-panel__embed--stage-layer'),
    ).toBe(true);
    expect(layer?.hidden).toBe(false);
  });

  test('hides the stage layer without removing the mounted player', () => {
    document.body.innerHTML = `
      <div id="active-toy-container"></div>
      <div id="youtube-player-container"><iframe id="youtube-player"></iframe></div>
    `;

    const playerContainer = document.getElementById(
      'youtube-player-container',
    ) as HTMLElement;
    const layer = mountYouTubeStageLayer(playerContainer);
    hideYouTubeStageLayer(document);

    expect(layer?.hidden).toBe(true);
    expect(layer?.contains(playerContainer)).toBe(true);
  });
});
