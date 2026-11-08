import { NoToneMapping, SRGBColorSpace, WebGPURenderer } from 'three/webgpu';

export async function createRenderer(canvas: HTMLCanvasElement, forceWebGL = false) {
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false, forceWebGL });
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  await renderer.init();
  const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  return { renderer, backend };
}
