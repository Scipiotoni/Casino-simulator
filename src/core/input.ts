export interface PointerClick {
  x: number;
  y: number;
  button: number;
  touch: boolean;
}

interface TouchTrack {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  t0: number;
  moved: boolean;
}

/**
 * Unified keyboard / mouse / touch input. Touch gets a floating joystick on the left half
 * of the screen, tap-to-click everywhere else and two-finger pinch zoom.
 */
export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  readonly pointer = { x: 0, y: 0, over: false, moved: false };
  primaryDown = false;
  clicks: PointerClick[] = [];
  rightClicks = 0;
  wheel = 0;
  pinch = 1;
  /** One-finger drag and two-finger pan deltas (pixels) accumulated this frame. */
  dragDX = 0;
  dragDY = 0;
  /** Mouse movement while captured (first-person look), pixels this frame. */
  lookDX = 0;
  lookDY = 0;
  /** Mouse movement this frame while it's free (not captured), pixels. */
  freeDX = 0;
  freeDY = 0;
  /** Right mouse button held (aim down sights). */
  rightHeld = false;
  /** First person wants the mouse captured: the next left click on the canvas grabs it. */
  wantLock = false;
  /** The page isn't allowed to capture the mouse (some embeds): aim with the cursor instead. */
  lockFailed = false;
  /** You freed the mouse yourself (Esc): it stays free until you click back in. */
  userFreed = false;
  private lockFails = 0;
  private unlockAt = 0;
  private lockTryAt = 0;
  private selfExit = false;
  panDX = 0;
  panDY = 0;
  private lastMid: { x: number; y: number } | null = null;
  lastPointerType: string = 'mouse';
  readonly joy = { active: false, x: 0, y: 0, originX: 0, originY: 0, curX: 0, curY: 0 };
  /** When false the joystick zone is disabled (e.g. menus open). */
  joystickEnabled = true;

  private joyId: number | null = null;
  private touches = new Map<number, TouchTrack>();
  private pinchDist = 0;
  private mouseDown: { x: number; y: number; t0: number; button: number } | null = null;
  /** Left mouse button is down (tracked separately so it works while the right button aims). */
  private leftHeld = false;
  private suppressTap = false;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('pointerleave', () => {
      this.pointer.over = false;
    });
    canvas.addEventListener('pointerenter', () => {
      this.pointer.over = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockerror', () => this.onLockError());
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) {
        this.lockFails = 0;
        this.lockFailed = false;
        this.userFreed = false;
        return;
      }
      this.unlockAt = performance.now();
      // Esc (or the browser) let go of the mouse, not the game: stay free until a click.
      if (!this.selfExit) this.userFreed = true;
      this.selfExit = false;
      this.keys.clear();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
        this.wheel += e.deltaY * scale;
      },
      { passive: false },
    );
  }

  get isTouch(): boolean {
    return this.lastPointerType === 'touch';
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only on the frame the key went down. */
  /** Forget a key press this frame (it was used up). */
  consume(code: string): void {
    this.pressed.delete(code);
  }

  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.clicks.length = 0;
    this.mousePresses = 0;
    this.rightClicks = 0;
    this.wheel = 0;
    this.pinch = 1;
    this.dragDX = 0;
    this.dragDY = 0;
    this.panDX = 0;
    this.panDY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.freeDX = 0;
    this.freeDY = 0;
    this.pointer.moved = false;
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
      return;
    }
    if (isDown) {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    } else {
      this.keys.delete(e.code);
    }
  }

  private localPos(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    // With the mouse captured (first person) everything happens at the crosshair.
    if (this.locked) return { x: r.width / 2, y: r.height / 2 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** The mouse is captured for first-person look. */
  get locked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.canvas;
  }

  /**
   * A capture was refused. Browsers refuse one asked for right after Esc (a short cool-down)
   * or without a click, so only give up for good after several refusals in a row.
   */
  private onLockError(): void {
    if (performance.now() - this.unlockAt < 1600) return;
    this.lockFails++;
    if (this.lockFails >= 3) this.lockFailed = true;
  }

  /** Capture the mouse (first person on desktop). */
  requestLock(): void {
    if (this.locked || this.isTouch) return;
    this.userFreed = false;
    this.lockTryAt = performance.now();
    const plain = () => {
      try {
        const r2 = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (r2 && typeof r2.catch === 'function') r2.catch(() => this.onLockError());
      } catch {
        this.onLockError();
      }
    };
    try {
      const r = (this.canvas as HTMLElement & { requestPointerLock(o?: unknown): Promise<void> | void }).requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(plain);
    } catch {
      plain();
    }
  }

  /**
   * First person wants the mouse: grab it again by itself after the game let go of it (a menu
   * closed, a mini-game ended), as long as you just clicked or pressed a key. Not after you
   * freed it with Esc: then it waits for a click on the game.
   */
  autoLock(): void {
    if (!this.wantLock || this.locked || this.lockFailed || this.userFreed || this.isTouch) return;
    const now = performance.now();
    if (now - this.lockTryAt < 1500 || now - this.unlockAt < 1300) return;
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive) return;
    this.requestLock();
  }

  /** Let go of everything (keys, buttons, the joystick): nothing stays held down. */
  releaseAll(): void {
    this.keys.clear();
    this.pressed.clear();
    this.primaryDown = false;
    this.rightHeld = false;
    this.leftHeld = false;
    this.endJoystick();
  }

  exitLock(): void {
    if (!this.locked) return;
    this.selfExit = true;
    document.exitPointerLock();
  }

  private onDown(e: PointerEvent): void {
    this.lastPointerType = e.pointerType;
    const p = this.localPos(e);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.over = true;
    if (e.pointerType === 'touch') {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const inJoyZone = p.x < r.width * 0.42 && p.y > r.height * 0.3;
      if (this.joystickEnabled && this.joyId === null && inJoyZone) {
        this.joyId = e.pointerId;
        this.joy.active = true;
        this.joy.originX = e.clientX;
        this.joy.originY = e.clientY;
        this.joy.curX = e.clientX;
        this.joy.curY = e.clientY;
        this.joy.x = 0;
        this.joy.y = 0;
        return;
      }
      this.touches.set(e.pointerId, { id: e.pointerId, startX: p.x, startY: p.y, x: p.x, y: p.y, t0: performance.now(), moved: false });
      if (this.touches.size === 1) {
        this.primaryDown = true;
        this.suppressTap = false;
      } else if (this.touches.size === 2) {
        this.primaryDown = false;
        this.suppressTap = true;
        const [a, b] = [...this.touches.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      return;
    }
    if (e.button === 2) this.rightHeld = true;
    // First person: this click captures the mouse (inside the click, as browsers require).
    if (e.button === 0 && this.wantLock && !this.locked && !this.lockFailed) {
      this.requestLock();
      return;
    }
    this.mouseDown = { x: p.x, y: p.y, t0: performance.now(), button: e.button };
    if (e.button === 0) this.leftHeld = true;
    if (e.button === 0) this.mousePresses++;
    if (e.button === 0) this.primaryDown = true;
    if (e.button === 2) this.rightClicks++;
  }

  private onMove(e: PointerEvent): void {
    // A second mouse button pressed or released while another is held comes as a move
    // ("chorded" buttons), not as pointerdown/up: aim with the right button, fire with the left.
    if (e.pointerType === 'mouse' && e.button >= 0) this.onChord(e);
    if (this.locked && e.pointerType === 'mouse') {
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
      return;
    }
    if (e.pointerId === this.joyId) {
      const dx = e.clientX - this.joy.originX;
      const dy = e.clientY - this.joy.originY;
      const max = 55;
      const len = Math.hypot(dx, dy);
      const k = len > max ? max / len : 1;
      this.joy.curX = this.joy.originX + dx * k;
      this.joy.curY = this.joy.originY + dy * k;
      this.joy.x = (dx * k) / max;
      this.joy.y = (dy * k) / max;
      return;
    }
    const p = this.localPos(e);
    const track = this.touches.get(e.pointerId);
    if (track) {
      const px = track.x;
      const py = track.y;
      track.x = p.x;
      track.y = p.y;
      if (Math.hypot(p.x - track.startX, p.y - track.startY) > 12) track.moved = true;
      if (this.touches.size >= 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0 && d > 0) this.pinch *= this.pinchDist / d;
        this.pinchDist = d;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.lastMid) {
          this.panDX += mid.x - this.lastMid.x;
          this.panDY += mid.y - this.lastMid.y;
        }
        this.lastMid = mid;
        return;
      }
      this.lastMid = null;
      if (track.moved) {
        this.dragDX += p.x - px;
        this.dragDY += p.y - py;
      }
    }
    if (e.pointerType !== 'touch') {
      this.lastPointerType = e.pointerType;
      this.freeDX += e.movementX || 0;
      this.freeDY += e.movementY || 0;
    }
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.moved = true;
  }

  private onChord(e: PointerEvent): void {
    const left = (e.buttons & 1) !== 0;
    const right = (e.buttons & 2) !== 0;
    if (e.button === 0) {
      if (left && !this.leftHeld) {
        this.leftHeld = true;
        this.mousePresses++;
        this.primaryDown = true;
      } else if (!left) {
        this.leftHeld = false;
        this.primaryDown = false;
      }
    } else if (e.button === 2) {
      if (right && !this.rightHeld) this.rightClicks++;
      this.rightHeld = right;
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    if (e.pointerType === 'mouse' && e.button === 2) this.rightHeld = false;
    if (e.pointerType === 'mouse' && e.button === 0) this.leftHeld = false;
    if (e.pointerId === this.joyId) {
      this.endJoystick();
      return;
    }
    const track = this.touches.get(e.pointerId);
    if (track) {
      this.touches.delete(e.pointerId);
      const quick = performance.now() - track.t0 < 450;
      if (!cancelled && !track.moved && quick && !this.suppressTap) {
        this.clicks.push({ x: track.x, y: track.y, button: 0, touch: true });
      }
      if (this.touches.size < 2) this.lastMid = null;
      if (this.touches.size === 0) {
        this.primaryDown = false;
        this.suppressTap = false;
        this.pinchDist = 0;
      }
      return;
    }
    if (this.mouseDown) {
      const p = this.localPos(e);
      const moved = Math.hypot(p.x - this.mouseDown.x, p.y - this.mouseDown.y);
      const onCanvas = e.target === this.canvas;
      if (!cancelled && moved < 8 && this.mouseDown.button === 0 && onCanvas) {
        this.clicks.push({ x: p.x, y: p.y, button: 0, touch: false });
      }
      if (this.mouseDown.button === 0) this.primaryDown = false;
      this.mouseDown = null;
    }
  }

  /** Fingers on the canvas right now (not counting the joystick). */
  get touchCount(): number {
    return this.touches.size;
  }

  /** Left mouse button held right now (not touch). */
  get mouseHeld(): boolean {
    return this.leftHeld;
  }

  /** Left mouse presses since the last frame (for guns: a tap fires even when shorter than a frame). */
  mousePresses = 0;

  private endJoystick(): void {
    this.joyId = null;
    this.joy.active = false;
    this.joy.x = 0;
    this.joy.y = 0;
  }
}
