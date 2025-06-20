import WebGL from 'three/examples/jsm/capabilities/WebGL.js';

export function ensureWebGL(): boolean {
  if (navigator.gpu || WebGL.isWebGLAvailable()) {
    return true;
  }

  const message = document.createElement('div');
  message.id = 'webgl-error-message';
  message.style.textAlign = 'center';
  message.style.padding = '2rem';
  message.style.background = '#000';
  message.style.color = '#fff';
  message.textContent = 'Your browser or device does not support WebGL.';
  document.body.innerHTML = '';
  document.body.appendChild(message);
  return false;
}
