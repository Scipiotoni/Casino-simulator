import { clamp } from './math';

/**
 * Fully procedural audio: every sound effect and the lounge music loop are synthesized
 * with the Web Audio API, so the game ships without any audio files.
 */

export type SfxName =
  | 'click' | 'pop' | 'coin' | 'cash' | 'spin' | 'win' | 'bigwin' | 'jackpot' | 'place' | 'sell'
  | 'error' | 'levelup' | 'bust' | 'repair' | 'fixed' | 'dice' | 'cards' | 'tick' | 'whoosh'
  | 'break' | 'drink' | 'objective' | 'rotate' | 'paint' | 'doorbell' | 'chips' | 'claw' | 'purchase'
  | 'gunshot' | 'gunHeavy' | 'shotgun' | 'smg' | 'laser' | 'paintball' | 'confettiGun' | 'reload' | 'empty' | 'ping' | 'glass'
  | 'carAlarm' | 'honk' | 'balloon' | 'ricochet' | 'keyBeep' | 'keyError' | 'vaultClunk' | 'vaultHiss' | 'vaultWheel' | 'alarm'
  | 'hitmarker' | 'headshot' | 'hurt' | 'knockout' | 'heartbeat' | 'siren' | 'whiz' | 'busted';

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  freqEnd?: number;
  detune?: number;
  filter?: number;
  dest?: AudioNode;
}

interface NoiseOpts {
  gain?: number;
  attack?: number;
  type?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  dest?: AudioNode;
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface AudioSettings {
  master: number;
  sfx: number;
  music: number;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();
  private settings: AudioSettings = { master: 0.8, sfx: 0.9, music: 0.45 };
  private musicOn = false;
  private musicTimer: number | null = null;
  private nextBeatTime = 0;
  private beatIndex = 0;
  private ambienceStarted = false;
  listener = { x: 0, z: 0, yaw: 0 };
  /** 0..1 scaling of the ambient casino bustle (driven by the number of machines). */
  bustle = 0;

  unlock(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
        return;
      }
      const ctx = this.ctx;
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.ratio.value = 6;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.2;
      this.master = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.ambBus = ctx.createGain();
      this.sfxBus.connect(this.compressor);
      this.musicBus.connect(this.compressor);
      this.ambBus.connect(this.compressor);
      this.compressor.connect(this.master);
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applySettings(this.settings);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.ambienceStarted) this.startAmbience();
    if (this.musicOn && this.musicTimer === null) this.startMusicScheduler();
  }

  applySettings(s: AudioSettings): void {
    this.settings = { ...s };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx * 0.9, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music * 0.55, t, 0.05);
    this.ambBus.gain.setTargetAtTime(s.sfx * 0.5, t, 0.05);
  }

  // ---------------------------------------------------------------- primitives

  private tone(freq: number, start: number, dur: number, o: ToneOpts = {}): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    freq = Math.min(freq, 18000);
    osc.frequency.setValueAtTime(freq, start);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), start + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.2;
    const attack = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur + (o.release ?? 0));
    let node: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(o.dest ?? this.sfxBus);
    osc.start(start);
    osc.stop(start + dur + (o.release ?? 0) + 0.05);
  }

  private noise(start: number, dur: number, o: NoiseOpts = {}): void {
    const ctx = this.ctx!;
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 2000, start);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, start + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.dest ?? this.sfxBus);
    src.start(start, Math.random() * 1.5);
    src.stop(start + dur + 0.05);
  }

  private bell(freq: number, start: number, dur: number, gain: number, dest?: AudioNode): void {
    this.tone(freq, start, dur, { type: 'sine', gain, dest });
    // Inharmonic partials give the metallic ring; skip any above the audible range.
    if (freq * 2.76 < 16000) this.tone(freq * 2.76, start, dur * 0.4, { type: 'sine', gain: gain * 0.25, dest });
    if (freq * 5.4 < 16000) this.tone(freq * 5.4, start, dur * 0.2, { type: 'sine', gain: gain * 0.1, dest });
  }

  // ---------------------------------------------------------------- public api

  /** Play a sound; `minGap` avoids machine-gun repeats of the same effect. */
  play(name: SfxName, opts: { volume?: number; pitch?: number; pan?: number } = {}): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[name] ?? 0.03;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < gap) return;
    this.lastPlayed.set(name, now);
    const vol = opts.volume ?? 1;
    if (vol <= 0.01) return;
    let dest: AudioNode = this.sfxBus;
    const needsGain = vol !== 1 || (opts.pan ?? 0) !== 0;
    if (needsGain) {
      const g = this.ctx.createGain();
      g.gain.value = vol;
      if (opts.pan && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = clamp(opts.pan, -1, 1);
        g.connect(p);
        p.connect(this.sfxBus);
      } else {
        g.connect(this.sfxBus);
      }
      dest = g;
      // Disconnect the temporary chain after the sound is done.
      window.setTimeout(() => g.disconnect(), 4000);
    }
    this.synth(name, now + 0.005, opts.pitch ?? 1, dest);
  }

  /** Positional play: attenuated by distance to the listener (camera focus). */
  playAt(name: SfxName, x: number, z: number, volume = 1): void {
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const att = Math.pow(clamp(1 - d / 20, 0, 1), 1.6);
    if (att < 0.04) return;
    // Pan relative to camera yaw: camera right vector is (cos yaw, -sin yaw).
    const right = dx * Math.cos(this.listener.yaw) - dz * Math.sin(this.listener.yaw);
    this.play(name, { volume: volume * att, pan: clamp(right / 10, -0.8, 0.8) });
  }

  private synth(name: SfxName, t: number, p: number, dest: AudioNode): void {
    switch (name) {
      case 'click':
        this.tone(1100 * p, t, 0.035, { type: 'square', gain: 0.07, freqEnd: 700 * p, filter: 3500, dest });
        break;
      case 'pop':
        this.tone(380 * p, t, 0.09, { type: 'sine', gain: 0.22, freqEnd: 950 * p, dest });
        break;
      case 'rotate':
        this.tone(520 * p, t, 0.07, { type: 'triangle', gain: 0.14, freqEnd: 780 * p, dest });
        break;
      case 'whoosh':
        this.noise(t, 0.22, { type: 'bandpass', freq: 600, freqEnd: 2600, q: 0.8, gain: 0.12, attack: 0.05, dest });
        break;
      case 'coin':
        this.tone(midi(91) * p, t, 0.09, { type: 'square', gain: 0.05, filter: 6000, dest });
        this.tone(midi(96) * p, t + 0.07, 0.22, { type: 'square', gain: 0.05, filter: 6000, dest });
        this.tone(midi(96) * p, t + 0.07, 0.25, { type: 'sine', gain: 0.12, dest });
        break;
      case 'cash': {
        this.noise(t, 0.06, { type: 'highpass', freq: 3000, gain: 0.18, dest });
        this.bell(midi(100) * p, t + 0.03, 0.5, 0.12, dest);
        this.bell(midi(103) * p, t + 0.1, 0.6, 0.1, dest);
        for (let i = 0; i < 4; i++) this.tone(midi(88 + i * 3) * p, t + 0.12 + i * 0.045, 0.08, { type: 'square', gain: 0.035, filter: 5000, dest });
        break;
      }
      case 'purchase':
        this.tone(midi(72) * p, t, 0.1, { type: 'triangle', gain: 0.16, dest });
        this.tone(midi(79) * p, t + 0.08, 0.2, { type: 'triangle', gain: 0.16, dest });
        this.noise(t, 0.05, { type: 'highpass', freq: 4000, gain: 0.08, dest });
        break;
      case 'spin':
        for (let i = 0; i < 9; i++) {
          this.noise(t + i * 0.07 + i * i * 0.004, 0.02, { type: 'bandpass', freq: 3200 * p, q: 6, gain: 0.09, dest });
        }
        break;
      case 'tick':
        this.noise(t, 0.018, { type: 'bandpass', freq: 2600 * p, q: 5, gain: 0.12, dest });
        break;
      case 'win': {
        const notes = [72, 76, 79, 84];
        notes.forEach((n, i) => this.tone(midi(n) * p, t + i * 0.075, 0.12, { type: 'square', gain: 0.06, filter: 4200, dest }));
        this.bell(midi(96) * p, t + 0.3, 0.4, 0.06, dest);
        break;
      }
      case 'bigwin': {
        const notes = [72, 76, 79, 84, 79, 84, 88, 91];
        notes.forEach((n, i) => this.tone(midi(n) * p, t + i * 0.08, 0.14, { type: 'square', gain: 0.07, filter: 4500, dest }));
        [60, 64, 67, 72].forEach((n) => this.tone(midi(n) * p, t + 0.64, 0.6, { type: 'sawtooth', gain: 0.035, filter: 2400, dest }));
        for (let i = 0; i < 6; i++) this.bell(midi(96 + (i % 3) * 4) * p, t + 0.6 + i * 0.07, 0.3, 0.04, dest);
        break;
      }
      case 'jackpot': {
        const run = [60, 64, 67, 72, 76, 79, 84, 88, 91, 96];
        run.forEach((n, i) => this.tone(midi(n), t + i * 0.06, 0.16, { type: 'square', gain: 0.07, filter: 5000, dest }));
        const chordT = t + 0.65;
        [[60, 64, 67, 72], [65, 69, 72, 77], [67, 71, 74, 79], [72, 76, 79, 84]].forEach((ch, ci) => {
          ch.forEach((n) => this.tone(midi(n), chordT + ci * 0.28, ci === 3 ? 1.2 : 0.24, { type: 'sawtooth', gain: 0.045, filter: 2800, attack: 0.02, dest }));
        });
        for (let i = 0; i < 18; i++) this.bell(midi(pickOf([96, 100, 103, 108])), chordT + 0.2 + i * 0.09, 0.35, 0.05, dest);
        this.noise(chordT + 0.84, 1.4, { type: 'bandpass', freq: 1400, q: 0.6, gain: 0.08, attack: 0.3, dest });
        break;
      }
      case 'place':
        this.tone(170 * p, t, 0.16, { type: 'sine', gain: 0.35, freqEnd: 55, dest });
        this.noise(t, 0.08, { type: 'lowpass', freq: 900, gain: 0.15, dest });
        this.tone(midi(88) * p, t + 0.08, 0.12, { type: 'sine', gain: 0.07, dest });
        this.tone(midi(95) * p, t + 0.14, 0.2, { type: 'sine', gain: 0.07, dest });
        break;
      case 'sell':
        [91, 88, 84, 79].forEach((n, i) => this.tone(midi(n) * p, t + i * 0.06, 0.1, { type: 'square', gain: 0.045, filter: 4000, dest }));
        this.noise(t + 0.22, 0.05, { type: 'highpass', freq: 3500, gain: 0.1, dest });
        break;
      case 'error':
        this.tone(150, t, 0.12, { type: 'sawtooth', gain: 0.12, filter: 700, dest });
        this.tone(115, t + 0.13, 0.16, { type: 'sawtooth', gain: 0.12, filter: 700, dest });
        break;
      case 'levelup': {
        [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), t + i * 0.07, 0.18, { type: 'triangle', gain: 0.14, dest }));
        [72, 76, 79, 84].forEach((n) => this.tone(midi(n), t + 0.5, 0.9, { type: 'triangle', gain: 0.07, attack: 0.02, dest }));
        for (let i = 0; i < 5; i++) this.bell(midi(96 + i * 2), t + 0.55 + i * 0.08, 0.4, 0.04, dest);
        break;
      }
      case 'objective':
        this.bell(midi(84), t, 0.5, 0.12, dest);
        this.bell(midi(91), t + 0.1, 0.5, 0.11, dest);
        this.bell(midi(96), t + 0.2, 0.8, 0.1, dest);
        break;
      case 'bust':
        for (let i = 0; i < 4; i++) {
          this.tone((i % 2 ? 680 : 920) * p, t + i * 0.16, 0.15, { type: 'square', gain: 0.06, filter: 2200, dest });
        }
        break;
      case 'repair':
        for (let i = 0; i < 3; i++) {
          this.noise(t + i * 0.11, 0.05, { type: 'bandpass', freq: 2600 + i * 300, q: 9, gain: 0.25, dest });
          this.tone(1300 + i * 90, t + i * 0.11, 0.07, { type: 'sine', gain: 0.05, dest });
        }
        break;
      case 'fixed':
        this.bell(midi(88), t, 0.35, 0.1, dest);
        this.bell(midi(93), t + 0.12, 0.5, 0.1, dest);
        break;
      case 'dice':
        for (let i = 0; i < 6; i++) this.noise(t + i * 0.05 + Math.random() * 0.03, 0.025, { type: 'highpass', freq: 2500, gain: 0.12, dest });
        break;
      case 'cards':
        this.noise(t, 0.1, { type: 'bandpass', freq: 1500, freqEnd: 4200, q: 1.2, gain: 0.1, attack: 0.02, dest });
        break;
      case 'chips':
        for (let i = 0; i < 4; i++) this.noise(t + i * 0.035, 0.03, { type: 'bandpass', freq: 4200 + Math.random() * 800, q: 12, gain: 0.14, dest });
        break;
      case 'break':
        this.noise(t, 0.35, { type: 'lowpass', freq: 1400, freqEnd: 200, gain: 0.3, dest });
        this.tone(320, t, 0.4, { type: 'sawtooth', gain: 0.08, freqEnd: 60, filter: 1200, dest });
        this.noise(t + 0.1, 0.25, { type: 'highpass', freq: 5000, gain: 0.06, dest });
        break;
      case 'drink':
        this.bell(midi(98) * p, t, 0.25, 0.07, dest);
        this.bell(midi(101) * p, t + 0.06, 0.3, 0.06, dest);
        break;
      case 'paint':
        this.noise(t, 0.08, { type: 'bandpass', freq: 900 * p, q: 0.7, gain: 0.08, attack: 0.02, dest });
        break;
      case 'doorbell':
        this.bell(midi(76), t, 0.6, 0.1, dest);
        this.bell(midi(72), t + 0.3, 0.8, 0.1, dest);
        break;
      case 'claw':
        this.tone(220 * p, t, 0.5, { type: 'square', gain: 0.03, freqEnd: 260 * p, filter: 900, dest });
        break;
      case 'gunshot':
        this.noise(t, 0.18, { type: 'lowpass', freq: 5200 * p, freqEnd: 500, gain: 0.5, dest });
        this.tone(160 * p, t, 0.12, { type: 'triangle', gain: 0.35, freqEnd: 50, dest });
        this.noise(t + 0.05, 0.35, { type: 'bandpass', freq: 900, q: 0.4, gain: 0.06, dest });
        break;
      case 'gunHeavy':
        this.noise(t, 0.32, { type: 'lowpass', freq: 3600 * p, freqEnd: 260, gain: 0.65, dest });
        this.tone(95 * p, t, 0.28, { type: 'sine', gain: 0.55, freqEnd: 32, dest });
        this.noise(t + 0.08, 0.7, { type: 'bandpass', freq: 600, q: 0.4, gain: 0.08, dest });
        break;
      case 'shotgun':
        this.noise(t, 0.4, { type: 'lowpass', freq: 3000 * p, freqEnd: 200, gain: 0.7, dest });
        this.tone(80 * p, t, 0.3, { type: 'sine', gain: 0.5, freqEnd: 30, dest });
        // Pump: two clacks
        this.noise(t + 0.42, 0.05, { type: 'highpass', freq: 2500, gain: 0.18, dest });
        this.noise(t + 0.55, 0.05, { type: 'highpass', freq: 2000, gain: 0.18, dest });
        break;
      case 'smg':
        this.noise(t, 0.09, { type: 'lowpass', freq: 6000 * p, freqEnd: 700, gain: 0.36, dest });
        this.tone(190 * p, t, 0.06, { type: 'triangle', gain: 0.22, freqEnd: 70, dest });
        break;
      case 'laser':
        this.tone(1800 * p, t, 0.18, { type: 'sawtooth', gain: 0.07, freqEnd: 300, filter: 4000, dest });
        this.tone(2400 * p, t, 0.12, { type: 'square', gain: 0.03, freqEnd: 600, dest });
        break;
      case 'paintball':
        this.noise(t, 0.06, { type: 'bandpass', freq: 1800 * p, q: 1.2, gain: 0.28, dest });
        this.tone(420 * p, t, 0.05, { type: 'sine', gain: 0.08, freqEnd: 200, dest });
        break;
      case 'confettiGun':
        this.noise(t, 0.25, { type: 'bandpass', freq: 900 * p, freqEnd: 3000, q: 0.6, gain: 0.35, dest });
        this.tone(300 * p, t, 0.1, { type: 'sine', gain: 0.2, freqEnd: 120, dest });
        for (let i = 0; i < 4; i++) this.tone(midi(84 + [0, 4, 7, 12][i]) * p, t + 0.06 + i * 0.05, 0.1, { type: 'triangle', gain: 0.05, dest });
        break;
      case 'reload':
        this.noise(t, 0.04, { type: 'highpass', freq: 3000, gain: 0.22, dest });
        this.tone(900 * p, t + 0.02, 0.03, { type: 'square', gain: 0.04, dest });
        this.noise(t + 0.22, 0.05, { type: 'highpass', freq: 2200, gain: 0.25, dest });
        this.tone(600 * p, t + 0.24, 0.04, { type: 'square', gain: 0.05, dest });
        break;
      case 'empty':
        this.noise(t, 0.025, { type: 'highpass', freq: 4000, gain: 0.2, dest });
        break;
      case 'siren':
        // Wail up and down.
        this.tone(640, t, 0.55, { type: 'sawtooth', gain: 0.045, freqEnd: 1250, filter: 2600, dest });
        this.tone(1250, t + 0.55, 0.55, { type: 'sawtooth', gain: 0.045, freqEnd: 640, filter: 2600, dest });
        break;
      case 'whiz':
        this.noise(t, 0.12, { type: 'bandpass', freq: 3200, freqEnd: 1200, q: 2, gain: 0.25, dest });
        break;
      case 'busted':
        for (let i = 0; i < 4; i++) this.tone(i % 2 ? 784 : 988, t + i * 0.22, 0.2, { type: 'square', gain: 0.06, filter: 2400, dest });
        this.tone(110, t, 0.5, { type: 'sine', gain: 0.4, freqEnd: 55, dest });
        break;
      case 'hitmarker':
        this.tone(1900 * p, t, 0.05, { type: 'square', gain: 0.05, filter: 3500, dest });
        this.noise(t, 0.03, { type: 'highpass', freq: 6000, gain: 0.12, dest });
        break;
      case 'headshot':
        this.bell(2400 * p, t, 0.3, 0.1, dest);
        this.tone(1200 * p, t, 0.08, { type: 'square', gain: 0.05, filter: 3000, dest });
        break;
      case 'hurt':
        this.tone(120 * p, t, 0.18, { type: 'sine', gain: 0.35, freqEnd: 60, dest });
        this.noise(t, 0.1, { type: 'lowpass', freq: 600, gain: 0.3, dest });
        break;
      case 'knockout':
        this.tone(90 * p, t, 0.4, { type: 'sine', gain: 0.45, freqEnd: 40, dest });
        this.noise(t, 0.25, { type: 'lowpass', freq: 400, gain: 0.35, dest });
        for (let i = 0; i < 3; i++) this.bell((1400 + i * 300) * p, t + 0.15 + i * 0.09, 0.4, 0.05, dest);
        break;
      case 'heartbeat':
        this.tone(55, t, 0.12, { type: 'sine', gain: 0.4, freqEnd: 40, dest });
        this.tone(50, t + 0.2, 0.12, { type: 'sine', gain: 0.3, freqEnd: 38, dest });
        break;
      case 'ping':
        this.bell(1650 * p, t, 0.35, 0.12, dest);
        this.noise(t, 0.04, { type: 'highpass', freq: 5000, gain: 0.1, dest });
        break;
      case 'ricochet':
        this.tone(2600 * p, t, 0.28, { type: 'sine', gain: 0.06, freqEnd: 900, dest });
        this.noise(t, 0.05, { type: 'highpass', freq: 3000, gain: 0.12, dest });
        break;
      case 'glass':
        for (let i = 0; i < 6; i++) this.bell((2200 + Math.random() * 2600) * p, t + i * 0.025, 0.25, 0.04, dest);
        this.noise(t, 0.3, { type: 'highpass', freq: 4000, gain: 0.2, dest });
        break;
      case 'balloon':
        this.noise(t, 0.08, { type: 'bandpass', freq: 1200 * p, q: 0.8, gain: 0.5, dest });
        this.tone(220, t, 0.05, { type: 'sine', gain: 0.2, freqEnd: 90, dest });
        break;
      case 'carAlarm':
        for (let i = 0; i < 8; i++) this.tone(i % 2 ? 1100 : 1500, t + i * 0.16, 0.14, { type: 'square', gain: 0.035, filter: 3000, dest });
        break;
      case 'honk':
        this.tone(330 * p, t, 0.32, { type: 'sawtooth', gain: 0.05, filter: 1400, dest });
        this.tone(415 * p, t, 0.32, { type: 'sawtooth', gain: 0.04, filter: 1400, dest });
        break;
      case 'keyBeep':
        this.tone(1320 * p, t, 0.07, { type: 'square', gain: 0.05, filter: 5000, dest });
        break;
      case 'keyError':
        this.tone(180, t, 0.35, { type: 'square', gain: 0.07, filter: 1200, dest });
        this.tone(170, t, 0.35, { type: 'sawtooth', gain: 0.04, filter: 900, dest });
        break;
      case 'vaultClunk':
        this.tone(70 * p, t, 0.3, { type: 'sine', gain: 0.5, freqEnd: 40, dest });
        this.noise(t, 0.12, { type: 'lowpass', freq: 900, gain: 0.45, dest });
        this.noise(t + 0.01, 0.05, { type: 'highpass', freq: 3500, gain: 0.12, dest });
        break;
      case 'vaultHiss':
        this.noise(t, 1.1, { type: 'highpass', freq: 3000, freqEnd: 7000, gain: 0.12, attack: 0.08, dest });
        break;
      case 'vaultWheel':
        for (let i = 0; i < 10; i++) this.noise(t + i * 0.07, 0.03, { type: 'bandpass', freq: 2200 + (i % 3) * 300, q: 3, gain: 0.12, dest });
        this.tone(110, t, 0.75, { type: 'sawtooth', gain: 0.02, filter: 400, dest });
        break;
      case 'alarm':
        for (let i = 0; i < 6; i++) this.tone(i % 2 ? 660 : 880, t + i * 0.25, 0.23, { type: 'sawtooth', gain: 0.06, filter: 2500, dest });
        break;
    }
  }

  // ---------------------------------------------------------------- ambience

  private startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    this.ambienceStarted = true;
    // Crowd murmur: band-limited noise with slow wobble.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain);
    lfoGain.connect(f.frequency);
    src.connect(f);
    f.connect(g);
    g.connect(this.ambBus);
    src.start();
    lfo.start();
    const tick = () => {
      if (!this.ctx) return;
      const target = 0.012 + this.bustle * 0.05;
      g.gain.setTargetAtTime(target, this.ctx.currentTime, 1.5);
      // Distant slot machine jingles give the room life.
      if (this.bustle > 0.05 && this.ctx.state === 'running' && Math.random() < 0.25 + this.bustle * 0.5) {
        const t0 = this.ctx.currentTime + Math.random() * 0.8;
        const base = pickOf([79, 81, 84, 86, 88]);
        const vol = 0.012 + this.bustle * 0.018;
        for (let i = 0; i < 3; i++) {
          this.tone(midi(base + [0, 4, 7, 12][i]), t0 + i * 0.07, 0.12, { type: 'square', gain: vol, filter: 3000, dest: this.ambBus });
        }
      }
      window.setTimeout(tick, 1400 + Math.random() * 1600);
    };
    tick();
  }

  // ---------------------------------------------------------------- music

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on && this.musicTimer === null) this.startMusicScheduler();
    if (!on && this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private startMusicScheduler(): void {
    if (!this.ctx) return;
    this.nextBeatTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 60);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const spb = 60 / 92; // seconds per beat
    while (this.nextBeatTime < ctx.currentTime + 0.25) {
      this.playBeat(this.beatIndex, this.nextBeatTime, spb);
      this.nextBeatTime += spb;
      this.beatIndex++;
    }
  }

  private playBeat(i: number, t: number, spb: number): void {
    const dest = this.musicBus;
    const bar = Math.floor(i / 4) % PROGRESSION.length;
    const beat = i % 4;
    const chord = PROGRESSION[bar];
    const swing = spb * 0.64;
    // Ride cymbal: ding ... ding-da ding
    this.noise(t, 0.16, { type: 'highpass', freq: 7000, gain: 0.05, dest });
    if (beat === 1 || beat === 3) {
      this.noise(t + swing, 0.09, { type: 'highpass', freq: 7500, gain: 0.03, dest });
      // Brush snare
      this.noise(t, 0.18, { type: 'bandpass', freq: 1800, q: 0.6, gain: 0.035, attack: 0.02, dest });
    }
    if (beat === 0) this.tone(90, t, 0.22, { type: 'sine', gain: 0.22, freqEnd: 45, dest });
    // Walking bass
    const bassNotes = [chord.root, chord.root + chord.tones[1], chord.root + 7, chord.root + (beat === 3 ? 11 : 12)];
    let bn = bassNotes[beat];
    if (beat === 3) {
      const next = PROGRESSION[(bar + 1) % PROGRESSION.length].root;
      bn = next + (Math.random() < 0.5 ? 1 : -1);
    }
    this.tone(midi(bn - 24), t, spb * 0.85, { type: 'triangle', gain: 0.2, filter: 700, attack: 0.01, dest });
    // Electric piano comping (Charleston rhythm)
    if (beat === 0 || (beat === 1 && Math.random() < 0.6) || beat === 2) {
      const at = beat === 1 ? t + swing : t;
      const len = beat === 0 ? spb * 0.9 : spb * 0.45;
      for (const n of chord.tones) {
        const f = midi(chord.root + n + 12);
        this.tone(f, at, len, { type: 'sine', gain: 0.03, attack: 0.01, release: 0.25, dest });
        this.tone(f * 2, at, len * 0.4, { type: 'sine', gain: 0.008, dest });
      }
    }
    // Sparse vibraphone melody
    if (Math.random() < 0.34) {
      const scale = chord.tones.concat([14]);
      const n = chord.root + 24 + scale[Math.floor(Math.random() * scale.length)];
      const at = t + (Math.random() < 0.5 ? 0 : swing);
      this.tone(midi(n), at, spb * 1.4, { type: 'sine', gain: 0.035, attack: 0.005, dest });
      this.tone(midi(n) * 4, at, spb * 0.3, { type: 'sine', gain: 0.004, dest });
    }
  }
}

const PROGRESSION: { root: number; tones: number[] }[] = [
  { root: 62, tones: [0, 3, 7, 10] }, // Dm7
  { root: 67, tones: [0, 4, 10, 14] }, // G9
  { root: 60, tones: [0, 4, 7, 11] }, // Cmaj7
  { root: 69, tones: [0, 4, 10, 13] }, // A7b9
  { root: 62, tones: [0, 3, 7, 10] }, // Dm7
  { root: 67, tones: [0, 4, 10, 14] }, // G9
  { root: 64, tones: [0, 3, 7, 10] }, // Em7
  { root: 69, tones: [0, 4, 10, 13] }, // A7b9
];

const MIN_GAP: Partial<Record<SfxName, number>> = {
  smg: 0.04, ping: 0.03, glass: 0.06, honk: 1, carAlarm: 1.2, alarm: 1.4, keyBeep: 0.02, siren: 1, whiz: 0.08,
  coin: 0.05, spin: 0.12, tick: 0.05, win: 0.15, chips: 0.1, cards: 0.08, dice: 0.2, paint: 0.06, click: 0.03,
};

function pickOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const audio = new AudioEngine();
