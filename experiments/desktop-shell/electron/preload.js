const { contextBridge, ipcRenderer } = require('electron');

// Answers Stims's Microphone request with system audio. getDisplayMedia reaches
// the handler in main.js, which picks the sources without showing a picker.
function installSystemAudioShim() {
  const media = navigator.mediaDevices;
  const getUserMedia = media.getUserMedia.bind(media);
  media.getUserMedia = async (constraints) => {
    if (!constraints?.audio || constraints.video) {
      return getUserMedia(constraints);
    }
    // Left at the defaults, this track arrives mono with voice processing on.
    const display = await media.getDisplayMedia({
      video: true,
      audio: {
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    for (const track of display.getVideoTracks()) track.stop();
    return new MediaStream(display.getAudioTracks());
  };

  // Stims refuses the microphone when this query reports denied.
  const permissions = navigator.permissions;
  const query = permissions.query.bind(permissions);
  permissions.query = (descriptor) =>
    descriptor?.name === 'microphone'
      ? Promise.resolve({
          name: 'microphone',
          state: 'granted',
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
        })
      : query(descriptor);
}

contextBridge.executeInMainWorld({ func: installSystemAudioShim });

const probe = ipcRenderer.sendSync('spike:probe');
if (probe) {
  contextBridge.executeInMainWorld({
    func: (config, source) => {
      window.__STIMS_SPIKE__ = config;
      new Function(source)();
    },
    args: [probe.config, probe.source],
  });
}
