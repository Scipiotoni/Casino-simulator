import * as THREE from 'three';
import { mat, glow, gold } from '../render/materials';
import { canvasTexture, drawNeonText, makeCanvas, roundRect } from '../render/textures';
import { Dyn, bake, box, cyl, sph, disposeTree } from '../items/models/common';
import { CENTER_X, FACADE_Z, SIDEWALK_Z1, WIDTHS, START_DEPTH, DEPTH_STEP } from './grid';
import { SIGN_FONTS, type CasinoLook } from './building';

/** Height of one storey seen from outside. */
export const STORY_H = 3;

/** Everything needed to draw a casino from the street. */
export interface LotLook {
  look: CasinoLook;
  width: number; // index into WIDTHS
  depth: number; // depth steps
  floors: number;
  /** Small text under the name on the roof sign ("OPEN 24/7", "RIVAL", an owner name…). */
  tagline?: string;
  /** Casino cosmetics switched on (searchlights, fireworks, gold facade, rainbow neon). */
  cos?: string[];
  /** A hotel tower (balconies, tall HOTEL sign) or an open-air Pool Garden. */
  style?: 'hotel' | 'garden';
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Draw the big neon name sign used on the roof billboard. */
export function drawCasinoSign(ctx: CanvasRenderingContext2D, W: number, H: number, look: CasinoLook, tagline: string): void {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1c0b30');
  bg.addColorStop(1, '#0b0414');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255, 210, 110, 0.55)';
  ctx.lineWidth = 6;
  roundRect(ctx, 14, 14, W - 28, H - 28, 26);
  ctx.stroke();
  const font = SIGN_FONTS.find((f) => f.id === look.signFont) ?? SIGN_FONTS[0];
  const isScript = font.id === 'pacifico';
  drawNeonText(ctx, look.name || 'My Casino', W / 2, H * 0.46, W - 90, isScript ? 130 : 120, font.css, hex(look.signColor), font.weight);
  ctx.font = '400 30px Bungee, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 233, 176, 0.92)';
  ctx.fillText(tagline, W / 2, H - 40);
}

/**
 * The modelled outside of a casino: storeys with lit windows, neon trim, a roof with a
 * billboard carrying the casino's name and a marquee over the entrance. The `shell` is
 * hidden while the player is inside the building (the cutaway interior walls take over);
 * the `yard` (red carpet, planters, rope posts) always stays.
 */
export class Exterior {
  readonly group = new THREE.Group();
  readonly shell = new THREE.Group();
  readonly yard = new THREE.Group();
  private bulbGroups: THREE.Mesh[] = [];
  private bulbOn = glow(0xfff1b8, 2.2);
  private bulbOff = mat(0x6b5a3a, { rough: 0.4 });
  private signTex: THREE.CanvasTexture;
  private t = Math.random() * 10;

  constructor(readonly info: LotLook) {
    this.group.add(this.shell, this.yard);
    const { canvas, ctx } = makeCanvas(1024, 320);
    drawCasinoSign(ctx, 1024, 320, info.look, info.tagline ?? 'OPEN 24/7');
    this.signTex = canvasTexture(canvas);
    this.build();
  }

  /** An open-air Pool Garden from the street: hedges, a gate with a sign, a lagoon and palms. */
  private buildGarden(): void {
    const { look } = this.info;
    const w = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, this.info.width))].w;
    const d = START_DEPTH + Math.max(0, this.info.depth) * DEPTH_STEP;
    const x0 = CENTER_X - w / 2;
    const x1 = CENTER_X + w / 2;
    const z0 = FACADE_Z - d;
    const z1 = FACADE_Z;
    const s = this.shell;
    const dyn = new Dyn();
    const hedge = mat(0x2f7a3a, { rough: 0.95 });
    const g = gold();
    box(s, w, 0.04, d, mat(0x3f8a37, { rough: 1 }), CENTER_X, 0.02, (z0 + z1) / 2);
    box(s, w + 0.3, 1.0, 0.3, hedge, CENTER_X, 0.5, z0);
    box(s, 0.3, 1.0, d, hedge, x0, 0.5, (z0 + z1) / 2);
    box(s, 0.3, 1.0, d, hedge, x1, 0.5, (z0 + z1) / 2);
    box(s, CENTER_X - 1.2 - x0, 1.0, 0.3, hedge, (x0 + CENTER_X - 1.2) / 2, 0.5, z1);
    box(s, x1 - CENTER_X - 1.2, 1.0, 0.3, hedge, (x1 + CENTER_X + 1.2) / 2, 0.5, z1);
    // Gate arch with the name on it
    for (const px of [CENTER_X - 1.3, CENTER_X + 1.3]) cyl(s, 0.16, 0.18, 3, g, px, 1.5, z1 + 0.1, 12);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.25), new THREE.MeshStandardMaterial({ map: this.signTex, emissive: 0xffffff, emissiveMap: this.signTex, emissiveIntensity: 1, roughness: 0.5 }));
    sign.position.set(CENTER_X, 3.3, z1 + 0.15);
    s.add(sign);
    dyn.keep(sign);
    // A lagoon, a deck around it, palms and umbrellas
    const pw = Math.min(w - 5, 9);
    const pd = Math.min(d - 6, 6);
    const pz = z0 + 2.5 + pd / 2;
    box(s, pw + 1.6, 0.06, pd + 1.6, mat(0xe8dcc2, { rough: 0.6 }), CENTER_X, 0.05, pz);
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x2fb8e0, emissive: 0x0a5a80, emissiveIntensity: 0.7, roughness: 0.05, transparent: true, opacity: 0.85 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(CENTER_X, 0.1, pz);
    s.add(water);
    dyn.keep(water);
    this.garden = waterMat;
    for (const [px, pzz] of [[x0 + 1.5, z0 + 1.5], [x1 - 1.5, z0 + 1.5], [x0 + 1.5, z1 - 2], [x1 - 1.5, z1 - 2]] as [number, number][]) {
      cyl(s, 0.12, 0.18, 3.2, mat(0x8a5a2a, { rough: 0.9 }), px, 1.6, pzz, 8);
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), mat(0x2f8f45, { rough: 0.7 }));
        leaf.scale.set(0.5, 0.25, 3.4);
        const a = (i / 6) * Math.PI * 2;
        leaf.position.set(px + Math.sin(a) * 0.7, 3.25, pzz + Math.cos(a) * 0.7);
        leaf.rotation.y = a;
        s.add(leaf);
      }
    }
    for (let i = 0; i < 4; i++) {
      const ux = CENTER_X - pw / 2 + 1 + i * ((pw - 2) / 3);
      const uz = pz + pd / 2 + 1.6;
      cyl(s, 0.03, 0.03, 2, mat(0xe9e1d3), ux, 1, uz, 6);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.35, 10), mat([0xff6fb5, 0x2fb8c9, 0xff8a1f, 0xffffff][i], { rough: 0.9 }));
      top.position.set(ux, 2, uz);
      s.add(top);
    }
    void look;
    bake(s, dyn);
  }

  /** Lagoon water on a Pool Garden's exterior (shimmers). */
  private garden: THREE.MeshStandardMaterial | null = null;

  private build(): void {
    if (this.info.style === 'garden') return this.buildGarden();
    const { look, floors } = this.info;
    const w = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, this.info.width))].w;
    const d = START_DEPTH + Math.max(0, this.info.depth) * DEPTH_STEP;
    const x0 = CENTER_X - w / 2;
    const x1 = CENTER_X + w / 2;
    const z0 = FACADE_Z - d;
    const z1 = FACADE_Z;
    const H = floors * STORY_H;
    const s = this.shell;
    const dyn = new Dyn();
    const cos = this.info.cos ?? [];
    const golden = cos.includes('goldfacade');
    const wall = golden ? gold() : mat(look.wallColor, { rough: 0.75 });
    const wallDark = golden ? mat(0xb8861b, { metal: 0.8, rough: 0.32, emissive: 0x3a2200, emissiveIntensity: 0.3 }) : mat(shade(look.wallColor, 0.7), { rough: 0.8 });
    // Rainbow neon needs its own material (the shared cache would recolour every casino).
    const trim = cos.includes('rainbow')
      ? (this.rainbow = new THREE.MeshStandardMaterial({ color: look.trimColor, emissive: look.trimColor, emissiveIntensity: 1.3, roughness: 0.4 }))
      : mat(look.trimColor, { emissive: look.trimColor, emissiveIntensity: 0.9, rough: 0.4 });
    const g = gold();
    const lit = mat(0x3a2a20, { emissive: 0xffb45a, emissiveIntensity: 0.32, rough: 0.15, metal: 0.3 });
    const dim = mat(0x1a1428, { emissive: 0x3b2a66, emissiveIntensity: 0.25, rough: 0.15, metal: 0.3 });
    const glass = mat(0x3a2418, { emissive: 0xff9a3d, emissiveIntensity: 0.3, rough: 0.12, metal: 0.3 });
    const roof = mat(0x2a2733, { rough: 0.95 });
    const T = 0.25;

    // Main walls (front has the door opening)
    box(s, w + T, H, T, wall, CENTER_X, H / 2, z0);
    box(s, T, H, d, wall, x0, H / 2, (z0 + z1) / 2);
    box(s, T, H, d, wall, x1, H / 2, (z0 + z1) / 2);
    const doorL = CENTER_X - 1;
    const doorR = CENTER_X + 1;
    const doorH = 2.5;
    box(s, doorL - x0 + T / 2, H, T, wall, (x0 - T / 2 + doorL) / 2, H / 2, z1);
    box(s, x1 + T / 2 - doorR, H, T, wall, (doorR + x1 + T / 2) / 2, H / 2, z1);
    box(s, doorR - doorL, H - doorH, T, wall, CENTER_X, doorH + (H - doorH) / 2, z1);
    // Pilasters on the front corners and every few metres
    for (let x = x0; x <= x1 + 0.01; x += w / Math.max(2, Math.round(w / 5))) {
      if (Math.abs(x - CENTER_X) < 2.2) continue;
      box(s, 0.45, H + 0.2, 0.45, wallDark, x, (H + 0.2) / 2, z1 + 0.1);
    }
    // Roof slab, parapet and trim bands between storeys
    box(s, w + T, 0.2, d, roof, CENTER_X, H + 0.1, (z0 + z1) / 2);
    box(s, w + T + 0.1, 0.55, 0.3, wallDark, CENTER_X, H + 0.45, z1);
    box(s, w + T + 0.1, 0.55, 0.3, wallDark, CENTER_X, H + 0.45, z0);
    box(s, 0.3, 0.55, d, wallDark, x0, H + 0.45, (z0 + z1) / 2);
    box(s, 0.3, 0.55, d, wallDark, x1, H + 0.45, (z0 + z1) / 2);
    box(s, w + T + 0.14, 0.07, 0.34, trim, CENTER_X, H + 0.74, z1);
    for (let f = 1; f <= floors; f++) {
      const y = f * STORY_H - 0.1;
      box(s, w + T + 0.12, 0.12, 0.32, trim, CENTER_X, y, z1);
      box(s, 0.32, 0.12, d, trim, x0, y, (z0 + z1) / 2);
      box(s, 0.32, 0.12, d, trim, x1, y, (z0 + z1) / 2);
    }
    // Upper-storey windows on the front and both sides
    let k = 0;
    for (let f = 1; f < floors; f++) {
      const y = f * STORY_H + 1.4;
      for (let x = x0 + 1.2; x <= x1 - 1.2; x += 1.7) {
        box(s, 1.05, 1.5, 0.08, (k++ * 7) % 5 === 0 ? dim : lit, x, y, z1 + 0.14);
        if (this.info.style === 'hotel') {
          // Little balconies with a gold rail
          box(s, 1.3, 0.1, 0.6, wallDark, x, y - 0.8, z1 + 0.42);
          box(s, 1.3, 0.05, 0.05, g, x, y - 0.35, z1 + 0.7);
        }
      }
      for (let z = z0 + 1.5; z <= z1 - 1.5; z += 2.2) {
        box(s, 0.08, 1.4, 1.3, (k++ * 5) % 4 === 0 ? dim : lit, x0 - 0.14, y, z);
        box(s, 0.08, 1.4, 1.3, (k++ * 3) % 4 === 0 ? dim : lit, x1 + 0.14, y, z);
      }
    }
    // Ground floor storefront glass either side of the door
    for (const [a, b] of [[x0 + 0.8, doorL - 1.4], [doorR + 1.4, x1 - 0.8]]) {
      if (b - a < 0.8) continue;
      box(s, b - a, 1.7, 0.08, glass, (a + b) / 2, 1.35, z1 + 0.14);
      box(s, b - a + 0.1, 0.08, 0.14, g, (a + b) / 2, 2.24, z1 + 0.16);
      box(s, b - a + 0.1, 0.08, 0.14, g, (a + b) / 2, 0.46, z1 + 0.16);
    }
    // Glass doors with gold frame and columns
    box(s, doorR - doorL, doorH, 0.06, mat(0x2a1d33, { emissive: 0xffb45a, emissiveIntensity: 0.2, rough: 0.1 }), CENTER_X, doorH / 2, z1 + 0.02);
    box(s, 0.06, doorH, 0.1, g, CENTER_X, doorH / 2, z1 + 0.06);
    for (const px of [doorL - 0.35, doorR + 0.35]) {
      cyl(s, 0.2, 0.24, 3.1, g, px, 1.55, z1 + 0.45, 16);
      box(s, 0.55, 0.14, 0.55, g, px, 0.07, z1 + 0.45);
    }
    // Marquee canopy over the entrance, with chasing bulbs underneath
    const mw = 5.2;
    const md = 2.0;
    const my = 3.05;
    box(s, mw, 0.42, md, mat(0x1a0f26, { rough: 0.5 }), CENTER_X, my, z1 + md / 2);
    box(s, mw + 0.08, 0.07, md + 0.08, g, CENTER_X, my + 0.24, z1 + md / 2);
    box(s, mw + 0.08, 0.07, md + 0.08, g, CENTER_X, my - 0.24, z1 + md / 2);
    const nameFace = new THREE.Mesh(
      new THREE.PlaneGeometry(mw - 0.2, 0.38),
      new THREE.MeshStandardMaterial({ map: this.signTex, emissive: 0xffffff, emissiveMap: this.signTex, emissiveIntensity: 1.1, roughness: 0.5 }),
    );
    nameFace.position.set(CENTER_X, my, z1 + md + 0.011);
    s.add(nameFace);
    const bulbGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const groups: THREE.BufferGeometry[][] = [[], [], []];
    let bi = 0;
    for (let x = CENTER_X - mw / 2 + 0.2; x <= CENTER_X + mw / 2 - 0.2; x += 0.34) {
      for (const z of [z1 + 0.25, z1 + md - 0.2]) {
        const bg = bulbGeo.clone();
        bg.translate(x, my - 0.3, z);
        groups[bi++ % 3].push(bg);
      }
    }
    // Roof billboard: tilted back so the camera above can read it
    const sw = Math.min(w - 2, 13);
    const sh = sw * 0.31;
    const board = new THREE.Group();
    board.position.set(CENTER_X, H + 1.1 + sh / 2, z1 - 1.3);
    board.rotation.x = -0.62;
    const back = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.3, sh + 0.3, 0.18), g);
    board.add(back);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sh),
      new THREE.MeshStandardMaterial({ map: this.signTex, emissive: 0xffffff, emissiveMap: this.signTex, emissiveIntensity: 0.85, roughness: 0.5 }),
    );
    face.position.z = 0.1;
    board.add(face);
    const bw = sw + 0.14;
    const bh = sh + 0.14;
    const perim: [number, number][] = [];
    const nx = Math.round(sw * 3.2);
    const ny = Math.round(sh * 3.2);
    for (let i = 0; i < nx; i++) perim.push([-bw / 2 + (i / nx) * bw, bh / 2]);
    for (let i = 0; i < ny; i++) perim.push([bw / 2, bh / 2 - (i / ny) * bh]);
    for (let i = 0; i < nx; i++) perim.push([bw / 2 - (i / nx) * bw, -bh / 2]);
    for (let i = 0; i < ny; i++) perim.push([-bw / 2, -bh / 2 + (i / ny) * bh]);
    board.updateMatrixWorld(true);
    for (const [px, py] of perim) {
      const bg = new THREE.SphereGeometry(0.08, 8, 6);
      bg.translate(px, py, 0.12);
      bg.applyMatrix4(board.matrix);
      groups[bi++ % 3].push(bg);
    }
    s.add(board);
    dyn.keep(board);
    for (const px of [-sw * 0.32, sw * 0.32]) cyl(s, 0.1, 0.12, 1.4, mat(0x2d2438, { metal: 0.7, rough: 0.35 }), CENTER_X + px, H + 0.8, z1 - 1.2, 8);
    // Rooftop clutter
    for (let i = 0; i < Math.max(2, Math.round(w / 6)); i++) {
      const ax = x0 + 2 + ((i * 5.3) % (w - 4));
      const az = z0 + 2 + ((i * 3.7) % Math.max(1, d - 6));
      box(s, 1.2, 0.7, 1.0, mat(0x8a8794, { rough: 0.6, metal: 0.3 }), ax, H + 0.55, az);
      cyl(s, 0.35, 0.35, 0.08, mat(0x3a3844), ax, H + 0.94, az, 12);
    }
    // Neon name down the side of taller buildings
    if (floors >= 2) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, Math.min(H - 1.5, 7), 1.1),
        mat(0x1a0f26, { rough: 0.4 }),
      );
      blade.position.set(x1 - 1.2, 3.4 + Math.min(H - 1.5, 7) / 2, z1 + 0.7);
      s.add(blade);
      const bladeTrim = new THREE.Mesh(new THREE.BoxGeometry(0.3, Math.min(H - 1.5, 7) + 0.1, 0.06), trim);
      bladeTrim.position.set(x1 - 1.2, blade.position.y, z1 + 1.26);
      s.add(bladeTrim);
      if (this.info.style === 'hotel') {
        const bh = Math.min(H - 1.5, 7);
        const { canvas, ctx } = makeCanvas(128, 640);
        ctx.fillStyle = '#12091c';
        ctx.fillRect(0, 0, 128, 640);
        ctx.font = '400 104px Bungee, "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = hex(look.signColor);
        ctx.shadowBlur = 24;
        ctx.fillStyle = '#fff4d6';
        'HOTEL'.split('').forEach((c, i) => ctx.fillText(c, 64, 70 + i * 125));
        this.bladeTex = canvasTexture(canvas);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, bh - 0.3), new THREE.MeshStandardMaterial({ map: this.bladeTex, emissive: 0xffffff, emissiveMap: this.bladeTex, emissiveIntensity: 1.2 }));
        face.position.set(x1 - 1.2 + 0.13, blade.position.y, z1 + 0.7);
        face.rotation.y = Math.PI / 2;
        s.add(face);
        dyn.keep(face);
        const face2 = face.clone();
        face2.position.x = x1 - 1.2 - 0.13;
        face2.rotation.y = -Math.PI / 2;
        s.add(face2);
        dyn.keep(face2);
      } else {
        for (let i = 0; i < 6; i++) sph(s, 0.14, glow(look.signColor, 1.6), x1 - 1.2, 3.8 + i * ((Math.min(H - 1.5, 7) - 0.8) / 5), z1 + 1.3, 10, 8);
      }
    }
    bake(s, dyn);
    for (let i = 0; i < 3; i++) {
      if (!groups[i].length) continue;
      const merged = mergeAll(groups[i]);
      const m = new THREE.Mesh(merged, this.bulbOn);
      s.add(m);
      this.bulbGroups.push(m);
    }
    bulbGeo.dispose();
    this.buildYard(x0, x1);
    if (cos.includes('searchlights')) this.buildSearchlights(x0, x1, H, (z0 + z1) / 2);
    if (cos.includes('fireworks')) this.buildFireworks(H, (z0 + z1) / 2);
  }

  /** Red carpet to the curb, planters along the facade and gold rope posts. */
  private buildYard(x0: number, x1: number): void {
    const y = this.yard;
    const dyn = new Dyn();
    const g = gold();
    const len = SIDEWALK_Z1 + 1 - FACADE_Z + 0.2;
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2, len), mat(0xa0101f, { rough: 1 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(CENTER_X, 0.006, FACADE_Z + len / 2 - 0.1);
    y.add(carpet);
    const trim = new THREE.Mesh(new THREE.PlaneGeometry(2.16, len), mat(0xe8b23a, { rough: 0.6, metal: 0.4 }));
    trim.rotation.x = -Math.PI / 2;
    trim.position.set(CENTER_X, 0.004, carpet.position.z);
    y.add(trim);
    const planterMat = mat(0x2c2433, { rough: 0.7 });
    const bushMat = mat(0x2f7a3a, { rough: 0.9 });
    for (let x = x0; x < x1; x++) {
      if (x === CENTER_X - 1 || x === CENTER_X) continue;
      box(y, 0.96, 0.4, 0.8, planterMat, x + 0.5, 0.2, FACADE_Z + 0.5);
      const bush = sph(y, 0.34, bushMat, x + 0.5, 0.62, FACADE_Z + 0.5, 8, 6);
      bush.scale.set(1.2, 0.9, 1);
    }
    for (const side of [-1, 1]) {
      const px = CENTER_X + side * 1.15;
      const posts: THREE.Vector3[] = [];
      for (let z = FACADE_Z + 1.3; z <= SIDEWALK_Z1 + 0.6; z += 1.7) {
        cyl(y, 0.05, 0.07, 0.9, g, px, 0.45, z, 10);
        sph(y, 0.08, g, px, 0.92, z, 10, 8);
        posts.push(new THREE.Vector3(px, 0.78, z));
      }
      for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i];
        const b = posts[i + 1];
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= 0.18;
        y.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 10, 0.03, 6), mat(0x9b0f2a, { rough: 0.6 })));
      }
    }
    bake(y, dyn);
    y.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = false;
    });
  }

  private rainbow: THREE.MeshStandardMaterial | null = null;
  private bladeTex: THREE.Texture | null = null;
  private beams: THREE.Object3D[] = [];
  private rockets: { pts: THREE.Points; vel: Float32Array; t: number; origin: THREE.Vector3 }[] = [];
  private fwBase = new THREE.Vector3();

  private buildSearchlights(x0: number, x1: number, H: number, zc: number): void {
    const beamGeo = new THREE.ConeGeometry(1.4, 26, 20, 1, true);
    beamGeo.translate(0, 13, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const [x, ph] of [[x0 + 1.5, 0], [x1 - 1.5, Math.PI]] as const) {
      const base = new THREE.Group();
      base.position.set(x, H + 0.3, zc);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.5, 14), mat(0x2b2b35, { metal: 0.6, rough: 0.4 }));
      base.add(lamp);
      const pivot = new THREE.Group();
      pivot.position.y = 0.3;
      pivot.userData.phase = ph;
      const beam = new THREE.Mesh(beamGeo, beamMat);
      pivot.add(beam);
      base.add(pivot);
      this.shell.add(base);
      this.beams.push(pivot);
    }
  }

  private buildFireworks(H: number, zc: number): void {
    this.fwBase.set(CENTER_X, H + 1, zc);
    const N = 60;
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const m = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const pts = new THREE.Points(geo, m);
      pts.frustumCulled = false;
      this.shell.add(pts);
      this.rockets.push({ pts, vel: new Float32Array(N * 3), t: -i * 0.9, origin: new THREE.Vector3() });
    }
  }

  private updateEffects(dt: number): void {
    const t = this.t;
    if (this.rainbow) {
      const c = new THREE.Color().setHSL((t * 0.12) % 1, 1, 0.55);
      this.rainbow.color.copy(c);
      this.rainbow.emissive.copy(c);
    }
    for (const b of this.beams) {
      const ph = b.userData.phase as number;
      b.rotation.set(Math.sin(t * 0.7 + ph) * 0.45, 0, Math.cos(t * 0.5 + ph) * 0.4);
    }
    for (const r of this.rockets) {
      r.t += dt;
      const pos = r.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const m = r.pts.material as THREE.PointsMaterial;
      if (r.t < 0) {
        m.opacity = 0;
        continue;
      }
      if (r.t > 2.4) {
        // New burst: random colour, spot and size.
        r.t = -Math.random() * 1.2;
        r.origin.set(this.fwBase.x + (Math.random() - 0.5) * 12, this.fwBase.y + 6 + Math.random() * 6, this.fwBase.z + (Math.random() - 0.5) * 6);
        m.color.setHSL(Math.random(), 1, 0.62);
        const sp = 3 + Math.random() * 3;
        for (let i = 0; i < r.vel.length / 3; i++) {
          const u = Math.random() * 2 - 1;
          const a = Math.random() * Math.PI * 2;
          const q = Math.sqrt(1 - u * u);
          r.vel[i * 3] = q * Math.cos(a) * sp;
          r.vel[i * 3 + 1] = u * sp;
          r.vel[i * 3 + 2] = q * Math.sin(a) * sp;
        }
        continue;
      }
      const k = r.t;
      for (let i = 0; i < r.vel.length / 3; i++) {
        pos.setXYZ(i, r.origin.x + r.vel[i * 3] * k, r.origin.y + r.vel[i * 3 + 1] * k - 2.2 * k * k, r.origin.z + r.vel[i * 3 + 2] * k);
      }
      pos.needsUpdate = true;
      m.opacity = Math.max(0, 1 - k / 2.4);
    }
  }

  update(dt: number): void {
    this.t += dt;
    if (this.garden) this.garden.emissiveIntensity = 0.6 + Math.sin(this.t * 2) * 0.12;
    this.updateEffects(dt);
    const phase = Math.floor(this.t * 8);
    this.bulbGroups.forEach((m, i) => (m.material = (i + phase) % 3 === 0 ? this.bulbOff : this.bulbOn));
  }

  dispose(): void {
    this.group.removeFromParent();
    disposeTree(this.group);
    this.rainbow?.dispose();
    this.garden?.dispose();
    this.bladeTex?.dispose();
    this.signTex.dispose();
  }
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of list) count += (g.index ? g.index.count : g.getAttribute('position').count);
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  void count;
  return out;
}
