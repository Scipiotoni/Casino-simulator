import * as THREE from 'three';
import { canvasTexture, makeCanvas, seeded } from '../render/textures';

/**
 * The sky over Jackpot City, driven by the in-game clock: a gradient dome with the sun
 * crossing it from east to west (sunrise ~6:00, sunset ~20:00), a glowing horizon at dawn
 * and dusk, stars and the moon at night and clouds drifting by. It also tells the renderer
 * how to light the world (sun direction and colour, sky fill, fog).
 */

export interface SkyLight {
  /** Direction towards the light that casts shadows (the sun, or the moon at night). */
  dir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fog: THREE.Color;
  exposure: number;
  fogNear: number;
  fogFar: number;
  /** 0 = broad daylight, 1 = deep night. */
  night: number;
}

const R = 2000;

const C = (hex: number) => new THREE.Color(hex);
const KEYS: { e: number; top: THREE.Color; hor: THREE.Color; sun: THREE.Color }[] = [
  { e: -0.5, top: C(0x03050f), hor: C(0x1b1430), sun: C(0x7f9cff) },
  { e: -0.16, top: C(0x070b22), hor: C(0x2a1a44), sun: C(0x8aa4ff) },
  { e: -0.04, top: C(0x1a2458), hor: C(0xc8507a), sun: C(0xff7a4a) },
  { e: 0.05, top: C(0x2c4a90), hor: C(0xff9a50), sun: C(0xffa060) },
  { e: 0.22, top: C(0x2f70c8), hor: C(0xf0c8a0), sun: C(0xffe2b8) },
  { e: 0.6, top: C(0x2a78d8), hor: C(0xbfe2f6), sun: C(0xfff4e4) },
];

function sample(e: number, k: 'top' | 'hor' | 'sun', out: THREE.Color): THREE.Color {
  if (e <= KEYS[0].e) return out.copy(KEYS[0][k]);
  for (let i = 1; i < KEYS.length; i++) {
    if (e <= KEYS[i].e) {
      const t = (e - KEYS[i - 1].e) / (KEYS[i].e - KEYS[i - 1].e);
      return out.copy(KEYS[i - 1][k]).lerp(KEYS[i][k], t);
    }
  }
  return out.copy(KEYS[KEYS.length - 1][k]);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Sun direction for a clock time (minutes after midnight): rises in the east (+x), sets west. */
export function sunDirection(minutes: number, out = new THREE.Vector3()): THREE.Vector3 {
  // Angle around the sky: 0 at sunrise (6:00), π at sunset (20:00); the night half is faster.
  const m = ((minutes % 1440) + 1440) % 1440;
  let a: number;
  if (m >= 360 && m <= 1200) a = ((m - 360) / 840) * Math.PI;
  else a = Math.PI + (((m - 1200 + 1440) % 1440) / 600) * Math.PI;
  const tilt = 0.55; // the sun passes south of overhead
  const x = Math.cos(a);
  const up = Math.sin(a);
  return out.set(x, up * Math.cos(tilt), up * Math.sin(tilt)).normalize();
}

export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh;
  private uniforms = {
    top: { value: new THREE.Color() },
    hor: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color() },
    sunSize: { value: 1 },
    glow: { value: 0.5 },
  };
  private stars: THREE.Points;
  private moon: THREE.Sprite;
  private clouds: { s: THREE.Sprite; a: number; y: number; w: number }[] = [];
  readonly light: SkyLight = {
    dir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sunIntensity: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    fog: new THREE.Color(),
    exposure: 1.4,
    fogNear: 320,
    fogFar: 2300,
    night: 0,
  };
  private tmp = new THREE.Color();
  private tmp2 = new THREE.Color();

  constructor() {
    this.group.name = 'sky';
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 hor;
        uniform vec3 sunDir;
        uniform vec3 sunCol;
        uniform float sunSize;
        uniform float glow;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          float t = pow(clamp(h, 0.0, 1.0), 0.45);
          vec3 col = mix(hor, top, t);
          // Below the horizon: the haze over the mountains
          col = mix(col, hor * 0.82, smoothstep(0.0, -0.15, h));
          float s = max(dot(d, sunDir), 0.0);
          // Warm glow around the sun, stronger near the horizon
          float horizonBoost = 1.0 - smoothstep(0.0, 0.5, sunDir.y);
          col += sunCol * pow(s, 8.0) * glow * (0.35 + horizonBoost * 0.9);
          col += sunCol * pow(s, 64.0) * glow * 0.6;
          // The disc itself
          float disc = smoothstep(0.9993 - 0.0004 * sunSize, 0.9997, s);
          col += sunCol * disc * 6.0 * step(-0.05, sunDir.y);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    // Stars
    const rnd = seeded(99);
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const y = Math.abs(u) * 0.98 + 0.02;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * R * 0.95, y * R * 0.95, Math.sin(th) * r * R * 0.95], i * 3);
      const b = 0.5 + rnd() * 0.5;
      const tint = rnd();
      col.set([b * (tint < 0.2 ? 0.8 : 1), b, b * (tint > 0.8 ? 0.8 : 1)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false }));
    this.moon.scale.set(90, 90, 1);
    this.moon.renderOrder = -8;
    this.group.add(this.moon);

    const ctex = cloudTexture();
    const crnd = seeded(7);
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, depthWrite: false, fog: false, opacity: 0.85 }));
      const w = 260 + crnd() * 420;
      s.scale.set(w, w * (0.28 + crnd() * 0.15), 1);
      s.renderOrder = -7;
      this.clouds.push({ s, a: crnd() * Math.PI * 2, y: 0.12 + crnd() * 0.32, w: 0.004 + crnd() * 0.006 });
      this.group.add(s);
    }
    this.set(12 * 60);
  }

  /** Set the time of day (minutes after midnight) and recompute colours and lighting. */
  set(minutes: number, dt = 0): void {
    const sun = sunDirection(minutes, this.uniforms.sunDir.value);
    const e = Math.asin(sun.y);
    const L = this.light;
    sample(e, 'top', this.uniforms.top.value);
    sample(e, 'hor', this.uniforms.hor.value);
    sample(e, 'sun', this.uniforms.sunCol.value);
    this.uniforms.glow.value = smooth(-0.25, 0.02, e);
    this.uniforms.sunSize.value = 1 + (1 - smooth(0, 0.4, e)) * 1.5;
    const night = 1 - smooth(-0.2, 0.08, e);
    L.night = night;
    (this.stars.material as THREE.PointsMaterial).opacity = smooth(0.35, 0.9, night);
    // Moon roughly opposite the sun
    const moonDir = this.tmpV.copy(sun).multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.15;
    moonDir.normalize();
    this.moon.position.copy(moonDir).multiplyScalar(R * 0.9);
    (this.moon.material as THREE.SpriteMaterial).opacity = smooth(0.2, 0.7, night);
    // Light: the sun by day, the moon by night (never from below the horizon)
    if (e > -0.06) {
      L.dir.copy(sun);
      L.dir.y = Math.max(L.dir.y, 0.32);
    } else {
      L.dir.copy(moonDir);
      L.dir.y = Math.max(L.dir.y, 0.5);
    }
    L.dir.normalize();
    const dayK = smooth(-0.08, 0.35, e);
    L.sunColor.copy(e > -0.06 ? this.uniforms.sunCol.value : this.tmp.setHex(0x9fb4ff));
    L.sunIntensity = e > -0.06 ? 0.2 + dayK * 1.4 : 0.16;
    L.hemiSky.copy(this.uniforms.top.value).lerp(this.tmp.setHex(0xffffff), 0.45 * dayK + 0.15);
    L.hemiGround.copy(this.tmp2.setHex(0x8a5a3a)).lerp(this.tmp.setHex(0x2a1a3a), night);
    L.hemiIntensity = 0.26 + dayK * 0.74;
    L.fogNear = 320 - night * 200;
    L.fogFar = 2300 - night * 900;
    L.fog.copy(this.uniforms.hor.value).multiplyScalar(0.92);
    L.exposure = 1.25 + dayK * 0.15;
    // Clouds take the light: white by day, pink and gold at dusk, dark blue at night
    const cTint = this.tmp.copy(this.uniforms.hor.value).lerp(this.tmp2.setHex(0xffffff), dayK * 0.75);
    for (const c of this.clouds) {
      c.a += c.w * dt * 0.1;
      const r = Math.cos(c.y) * R * 0.8;
      c.s.position.set(Math.cos(c.a) * r, Math.sin(c.y) * R * 0.8, Math.sin(c.a) * r);
      (c.s.material as THREE.SpriteMaterial).color.copy(cTint).multiplyScalar(0.35 + 0.65 * (1 - night * 0.8));
      (c.s.material as THREE.SpriteMaterial).opacity = 0.75 - night * 0.4;
    }
  }
  private tmpV = new THREE.Vector3();

  /** Keep the dome centred on the camera. */
  follow(cam: THREE.Camera): void {
    cam.getWorldPosition(this.group.position);
  }
}

function moonTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
  g.addColorStop(0, 'rgba(220,230,255,0.5)');
  g.addColorStop(1, 'rgba(220,230,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#f2f0e6';
  ctx.beginPath();
  ctx.arc(64, 64, 26, 0, Math.PI * 2);
  ctx.fill();
  const rnd = seeded(3);
  ctx.fillStyle = 'rgba(160,160,170,0.45)';
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc(50 + rnd() * 28, 50 + rnd() * 28, 2 + rnd() * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasTexture(canvas);
}

function cloudTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 96);
  const rnd = seeded(12);
  for (let i = 0; i < 22; i++) {
    const x = 40 + rnd() * 176;
    const y = 40 + rnd() * 26 - Math.abs(x - 128) * 0.08;
    const r = 16 + rnd() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return canvasTexture(canvas);
}
