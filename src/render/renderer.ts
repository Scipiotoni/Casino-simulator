import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { setMaxAnisotropy } from './textures';

export type Quality = 'low' | 'medium' | 'high';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Drawn on top of the world with its own depth (the gun in your hands in first person). */
  readonly overlay = new THREE.Scene();
  private overlayPass: RenderPass | null = null;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  quality: Quality = 'high';
  private shadowDirty = 2;
  private width = 1;
  private height = 1;

  constructor(readonly container: HTMLElement, quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false, logarithmicDepthBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.scene.background = new THREE.Color(0x0b0714);
    // Soft studio reflections so gold, chrome and lacquer read as materials.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2600);
    // Distant desert and mountains fade into the sky.
    this.scene.fog = new THREE.Fog(0x1b1430, 320, 2300);

    this.hemi = new THREE.HemisphereLight(0xfff1dd, 0x4a2a6a, 0.8);
    this.scene.add(this.hemi);
    const amb = new THREE.AmbientLight(0x6a4a8a, 0.12);
    this.scene.add(amb);

    this.sun = new THREE.DirectionalLight(0xfff0dc, 1.25);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.overlay.add(new THREE.HemisphereLight(0xfff1dd, 0x3a2a4a, 0.85));
    const key = new THREE.DirectionalLight(0xfff0dc, 1.1);
    key.position.set(0.6, 1, 0.4);
    this.overlay.add(key);
    this.overlay.environment = this.scene.environment;
    this.overlay.environmentIntensity = 0.12;

    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Something is in the overlay scene to draw. */
  private get overlayOn(): boolean {
    return this.overlay.children.some((c) => c.visible && !(c as THREE.Light).isLight);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const ratio = q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 1);
    this.renderer.setPixelRatio(ratio);
    const shadows = q !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.composer?.dispose();
    this.composer = null;
    this.overlayPass = null;
    this.bloom = null;
    if (q !== 'low') this.buildComposer();
    this.resize();
    this.markShadowsDirty();
  }

  private buildComposer(): void {
    const target = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'high' ? 4 : 2,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const over = new RenderPass(this.overlay, this.camera);
    over.clear = false;
    over.clearDepth = true;
    over.enabled = false;
    this.overlayPass = over;
    composer.addPass(over);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width / 2, this.height / 2), 0.55, 0.5, 0.9);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setBloom(strength: number): void {
    if (this.bloom) this.bloom.strength = strength;
  }

  /** Direction towards the sun (or moon) for the shadow-casting light. */
  private sunDir = new THREE.Vector3(-14, 26, 10).normalize();
  private tmpC = new THREE.Color();

  /**
   * Light the world from the sky (sun or moon, sky fill, fog). `indoor` (0..1) blends towards
   * the casino's own warm lighting, which doesn't care what time it is outside.
   */
  applySky(L: { dir: THREE.Vector3; sunColor: THREE.Color; sunIntensity: number; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiIntensity: number; fog: THREE.Color; fogNear: number; fogFar: number; exposure: number; night: number }, indoor: number): void {
    const night = L.night;
    const c = this.tmpC;
    this.hemi.color.copy(L.hemiSky).lerp(c.setHex(0xfff1dd), indoor);
    this.hemi.groundColor.copy(L.hemiGround).lerp(c.setHex(0x4a2a6a), indoor);
    this.hemi.intensity = THREE.MathUtils.lerp(L.hemiIntensity, 0.8 - night * 0.22, indoor);
    this.sun.color.copy(L.sunColor).lerp(c.setHex(0xfff0dc), indoor);
    this.sun.intensity = THREE.MathUtils.lerp(L.sunIntensity, 1.25 - night * 0.35, indoor);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(L.exposure, 1.45 - night * 0.08, indoor);
    if (this.bloom) this.bloom.strength = 0.5 + night * 0.3;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(L.fog);
    fog.near = L.fogNear;
    fog.far = L.fogFar;
    const want = indoor > 0.5 ? c.setRGB(-14, 26, 10) : c.setRGB(L.dir.x, L.dir.y, L.dir.z);
    const d = new THREE.Vector3(want.r, want.g, want.b).normalize();
    if (d.distanceToSquared(this.sunDir) > 0.0004) {
      this.sunDir.copy(d);
      const t = this.sun.target.position;
      this.sun.position.copy(t).addScaledVector(d, 32);
      this.markShadowsDirty();
    }
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    // Wider FOV on portrait screens so phones still see a useful slice of the floor.
    this.camera.fov = w / h < 0.8 ? 52 : 38;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  get size(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  /** Point the sun's shadow frustum at the building footprint. */
  fitShadow(minX: number, maxX: number, minZ: number, maxZ: number): void {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const half = Math.max(maxX - minX, maxZ - minZ) / 2 + 4;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx, 0, cz).addScaledVector(this.sunDir, 32);
    const cam = this.sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 80;
    cam.updateProjectionMatrix();
    this.markShadowsDirty();
  }

  markShadowsDirty(frames = 2): void {
    this.shadowDirty = Math.max(this.shadowDirty, frames);
  }

  render(): void {
    if (this.shadowDirty > 0 && this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty--;
    }
    const over = this.overlayOn;
    if (this.composer) {
      if (this.overlayPass) this.overlayPass.enabled = over;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
      if (over) {
        const auto = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.overlay, this.camera);
        this.renderer.autoClear = auto;
      }
    }
  }
}
