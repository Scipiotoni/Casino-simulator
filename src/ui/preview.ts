import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel } from '../items/models';
import type { ItemDef } from '../items/catalog';
import { CharacterModel, type Pose } from '../entities/characterModel';
import type { Appearance } from '../entities/appearance';

function makeRenderer(w: number, h: number): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setSize(w, h, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.35;
  return r;
}

function lightScene(renderer: THREE.WebGLRenderer): THREE.Scene {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xfff1dd, 0x4a2a6a, 1.0));
  const key = new THREE.DirectionalLight(0xfff0dc, 1.8);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff7fd0, 0.9);
  rim.position.set(4, 3, -4);
  scene.add(rim);
  return scene;
}

/** Offscreen renderer that turns item models into shop thumbnails. */
class ThumbRenderer {
  private renderer = makeRenderer(160, 160);
  private scene = lightScene(this.renderer);
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  private cache = new Map<string, string>();

  thumb(def: ItemDef, color: number, statueLook?: Appearance): string {
    const key = `${def.id}:${color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const model = buildModel(def.model, { color, level: 1, params: def.params ?? {}, statueLook });
    model.update(0.016, { t: 1.3, broken: false, level: 1, busy: true, jackpotPot: 25000 });
    this.scene.add(model.root);
    const box = new THREE.Box3().setFromObject(model.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.98;
    const dir = new THREE.Vector3(0.62, 0.72, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.lookAt(sphere.center);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    model.root.removeFromParent();
    model.dispose();
    this.cache.set(key, url);
    return url;
  }
}

let thumbs: ThumbRenderer | null = null;

export function itemThumb(def: ItemDef, color?: number, statueLook?: Appearance): string {
  try {
    thumbs ??= new ThumbRenderer();
    return thumbs.thumb(def, color ?? def.colors[0] ?? 0xffffff, statueLook);
  } catch {
    return '';
  }
}

/** Live, rotatable character preview for the creator screens. */
export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private model: CharacterModel | null = null;
  private yaw = 0.4;
  private drag: { x: number; yaw: number } | null = null;
  private raf = 0;
  private last = 0;
  private pose: Pose = 'idle';
  private poseT = 0;
  private pedestal: THREE.Mesh;

  constructor() {
    this.renderer = makeRenderer(400, 400);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'preview-canvas';
    this.scene = lightScene(this.renderer);
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.7, 0.12, 40),
      new THREE.MeshStandardMaterial({ color: 0x2a1640, metalness: 0.4, roughness: 0.3 }),
    );
    ped.position.y = -0.06;
    this.scene.add(ped);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.66, 0.015, 8, 60),
      new THREE.MeshStandardMaterial({ color: 0xffc53d, emissive: 0xffc53d, emissiveIntensity: 1.2 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);
    this.pedestal = ped;
    this.camera.position.set(0, 1.05, 3.1);
    this.camera.lookAt(0, 0.62, 0);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, yaw: this.yaw };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drag) this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.012;
    });
    this.canvas.addEventListener('pointerup', () => (this.drag = null));
  }

  show(look: Appearance): void {
    if (!this.model) {
      this.model = new CharacterModel(look);
      this.scene.add(this.model.root);
    } else {
      this.model.setAppearance(look);
    }
  }

  react(): void {
    if (!this.model) return;
    const poses: Pose[] = ['wave', 'cheer', 'dance', 'clap'];
    this.pose = poses[Math.floor(Math.random() * poses.length)];
    this.poseT = 1.8;
    this.model.setExpression('happy', 1.5);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (!this.drag) this.yaw += dt * 0.35;
      if (this.model) {
        if (this.poseT > 0) {
          this.poseT -= dt;
          this.model.setPose(this.pose);
        } else this.model.setPose('idle');
        this.model.root.rotation.y = this.yaw;
        this.model.update(dt);
      }
      this.pedestal.rotation.y = this.yaw;
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}

let preview: CharacterPreview | null = null;
export function characterPreview(): CharacterPreview {
  preview ??= new CharacterPreview();
  return preview;
}
