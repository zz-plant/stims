declare module 'three' {
  export class AudioListener {}
  export class Audio {
    constructor(listener: AudioListener);
    setMediaStreamSource(stream: any): void;
  }
  export class PositionalAudio extends Audio {
    constructor(listener: AudioListener);
  }
  export class Object3D {
    add(obj: any): void;
  }
  export class AudioAnalyser {
    analyser: any;
    constructor(audio: Audio, fftSize?: number);
    getFrequencyData(): Uint8Array;
  }
  export class Camera {
    add: (obj: any) => void;
  }
  const three: any;
  export default three;
}
