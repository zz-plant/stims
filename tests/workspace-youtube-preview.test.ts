import { beforeEach, describe, expect, test } from 'bun:test';
import {
  describeWorkspaceYouTubeInputState,
  readStoredWorkspaceYouTubeUrl,
  writeStoredWorkspaceYouTubeUrl,
} from '../assets/js/frontend/workspace-youtube-preview.ts';
import {
  parseYouTubeVideoReference,
  readStoredRecentYouTubeVideos,
} from '../assets/js/ui/youtube-controller.ts';

describe('workspace YouTube preview helpers', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  test('persists and clears the stored workspace YouTube URL', () => {
    expect(readStoredWorkspaceYouTubeUrl()).toBe('');

    writeStoredWorkspaceYouTubeUrl(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(readStoredWorkspaceYouTubeUrl()).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );

    writeStoredWorkspaceYouTubeUrl('   ');
    expect(readStoredWorkspaceYouTubeUrl()).toBe('');
  });

  test('describes the workspace YouTube input states', () => {
    expect(
      describeWorkspaceYouTubeInputState({
        loadedVideoKey: null,
        value: '',
        youtubeLoading: false,
      }),
    ).toMatchObject({
      canLoad: false,
      feedback: 'Paste a YouTube link or video ID to load it.',
      invalid: false,
      reference: null,
    });

    expect(
      describeWorkspaceYouTubeInputState({
        loadedVideoKey: null,
        value: 'bad-link',
        youtubeLoading: false,
      }),
    ).toMatchObject({
      canLoad: false,
      feedback:
        'That link or ID was not recognized. Try a YouTube watch/share link or an 11-character video ID.',
      invalid: true,
      reference: null,
    });

    const reference = parseYouTubeVideoReference(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s',
    );
    expect(reference).not.toBeNull();

    expect(
      describeWorkspaceYouTubeInputState({
        loadedVideoKey: null,
        value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s',
        youtubeLoading: false,
      }),
    ).toMatchObject({
      canLoad: true,
      feedback: 'Link looks good. Press Load to continue.',
      invalid: false,
      reference,
    });

    expect(
      describeWorkspaceYouTubeInputState({
        loadedVideoKey: null,
        value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s',
        youtubeLoading: true,
      }),
    ).toMatchObject({
      canLoad: false,
      feedback: 'Loading the embedded player…',
      invalid: false,
      reference,
    });

    expect(
      describeWorkspaceYouTubeInputState({
        loadedVideoKey: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s',
        value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s',
        youtubeLoading: false,
      }),
    ).toMatchObject({
      canLoad: true,
      feedback: 'Video is ready. Choose Start capture to continue.',
      invalid: false,
      reference,
    });
  });

  test('reads stored recent YouTube videos without the player controller', () => {
    localStorage.setItem(
      'stims_recent_youtube',
      JSON.stringify([
        {
          id: 'dQw4w9WgXcQ',
          title: 'Never Gonna Give You Up',
          timestamp: 1,
        },
      ]),
    );

    expect(readStoredRecentYouTubeVideos()).toEqual([
      {
        id: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        timestamp: 1,
      },
    ]);
  });
});
