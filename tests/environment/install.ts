import { installAnimationFrameController } from './animation-frame.ts';
import { installDomEnvironment } from './dom.ts';
import { installWebGpuGlobals } from './webgpu.ts';

installDomEnvironment();
installAnimationFrameController();
installWebGpuGlobals();
