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
  | 'hitmarker' | 'headshot' | 'hurt' | 'knockout' | 'heartbeat' | 'siren' | 'whiz' | 'busted'
  | 'thud' | 'drumhit' | 'cymbal' | 'strum' | 'piano' | 'clack' | 'shutter' | 'blip' | 'splash' | 'sizzle'
  | 'crash' | 'explosion' | 'backfire' | 'turbo' | 'shift' | 'ignition' | 'metalHit' | 'cannon';

/** How a car's engine sounds: pitch, rumble, rasp, whine. */
export type EngineProfile = 'four' | 'v8' | 'sport' | 'diesel' | 'electric' | 'buggy' | 'tank';

/** Engine voice settings per profile. */
const ENGINE_VOICE: Record<EngineProfile, { idle: number; span: number; sub: number; rasp: number; whine: number; cut: number }> = {
  four: { idle: 34, span: 130, sub: 0.35, rasp: 0.35, whine: 0, cut: 1 },
  v8: { idle: 26, span: 95, sub: 0.75, rasp: 0.55, whine: 0, cut: 0.8 },
  sport: { idle: 42, span: 190, sub: 0.3, rasp: 0.7, whine: 0.1, cut: 1.35 },
  diesel: { idle: 22, span: 70, sub: 0.8, rasp: 0.25, whine: 0, cut: 0.6 },
  electric: { idle: 60, span: 520, sub: 0, rasp: 0, whine: 1, cut: 1.2 },
  buggy: { idle: 38, span: 150, sub: 0.25, rasp: 0.9, whine: 0, cut: 1.1 },
  tank: { idle: 18, span: 48, sub: 1, rasp: 0.4, whine: 0.25, cut: 0.5 },
};

/** A running engine (one at a time: the car you drive). */
interface EngineVoice {
  profile: EngineProfile;
  out: GainNode;
  saw: OscillatorNode;
  saw2: OscillatorNode;
  sub: OscillatorNode;
  whine: OscillatorNode;
  whineGain: GainNode;
  rasp: GainNode;
  raspFilter: BiquadFilterNode;
  lp: BiquadFilterNode;
  noise: AudioBufferSourceNode;
  skid: GainNode;
  skidFilter: BiquadFilterNode;
  am: OscillatorNode;
  amDepth: GainNode;
}

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
      case 'thud':
        this.tone(95 * p, t, 0.16, { type: 'sine', gain: 0.5, freqEnd: 50, dest });
        this.noise(t, 0.07, { type: 'lowpass', freq: 900, gain: 0.35, dest });
        break;
      case 'drumhit':
        this.tone(140 * p, t, 0.18, { type: 'sine', gain: 0.5, freqEnd: 55, dest });
        this.noise(t, 0.09, { type: 'bandpass', freq: 1800 * p, q: 0.7, gain: 0.35, dest });
        break;
      case 'cymbal':
        this.noise(t, 0.9, { type: 'highpass', freq: 6000, gain: 0.22, dest });
        break;
      case 'strum':
        for (let i = 0; i < 5; i++) this.tone([196, 247, 294, 392, 494][i] * p, t + i * 0.018, 0.7, { type: 'sawtooth', gain: 0.03, filter: 1800, dest });
        break;
      case 'piano': {
        const root = [262, 294, 330, 349, 392, 440][Math.floor(Math.random() * 6)] * p;
        for (const [k, m] of [[0, 1], [1, 1.26], [2, 1.5]] as const) this.bell(root * m, t + k * 0.06, 0.9, 0.06, dest);
        break;
      }
      case 'clack':
        this.noise(t, 0.04, { type: 'bandpass', freq: 2600 * p, q: 3, gain: 0.5, dest });
        this.tone(1900 * p, t, 0.04, { type: 'sine', gain: 0.08, dest });
        break;
      case 'shutter':
        this.noise(t, 0.03, { type: 'highpass', freq: 3000, gain: 0.35, dest });
        this.noise(t + 0.07, 0.04, { type: 'highpass', freq: 2500, gain: 0.3, dest });
        break;
      case 'blip':
        this.tone(880 * p, t, 0.06, { type: 'square', gain: 0.05, freqEnd: 1320 * p, filter: 4000, dest });
        break;
      case 'splash':
        this.noise(t, 0.5, { type: 'lowpass', freq: 1500, freqEnd: 400, gain: 0.3, dest });
        break;
      case 'sizzle':
        this.noise(t, 0.8, { type: 'highpass', freq: 4000, gain: 0.12, dest });
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
      case 'crash':
        // Crumpling metal: a dull hit, a scrape and a few clanks.
        this.tone(70 * p, t, 0.3, { type: 'sine', gain: 0.6, freqEnd: 35, dest });
        this.noise(t, 0.35, { type: 'bandpass', freq: 900 * p, freqEnd: 300, q: 1.2, gain: 0.45, dest });
        this.noise(t + 0.02, 0.18, { type: 'highpass', freq: 3500, gain: 0.18, dest });
        for (let i = 0; i < 3; i++) this.tone((330 + Math.random() * 500) * p, t + 0.03 + i * 0.05, 0.12, { type: 'square', gain: 0.04, filter: 2600, freqEnd: 180, dest });
        break;
      case 'metalHit':
        this.tone(1300 * p, t, 0.08, { type: 'triangle', gain: 0.12, freqEnd: 700, dest });
        this.noise(t, 0.05, { type: 'bandpass', freq: 3000, q: 2, gain: 0.2, dest });
        break;
      case 'explosion':
        // A deep boom, a roar of fire and debris crackling down.
        this.tone(90 * p, t, 1.3, { type: 'sine', gain: 0.9, freqEnd: 24, attack: 0.01, dest });
        this.tone(55 * p, t, 0.9, { type: 'triangle', gain: 0.5, freqEnd: 20, dest });
        this.noise(t, 1.8, { type: 'lowpass', freq: 2400, freqEnd: 120, q: 0.5, gain: 0.85, attack: 0.008, dest });
        this.noise(t + 0.05, 0.6, { type: 'bandpass', freq: 600, freqEnd: 200, q: 0.8, gain: 0.4, dest });
        for (let i = 0; i < 9; i++) this.noise(t + 0.25 + Math.random() * 1.2, 0.04, { type: 'highpass', freq: 2500 + Math.random() * 3000, gain: 0.08 + Math.random() * 0.1, dest });
        break;
      case 'cannon':
        this.tone(70 * p, t, 0.9, { type: 'sine', gain: 0.9, freqEnd: 22, dest });
        this.noise(t, 0.7, { type: 'lowpass', freq: 3000, freqEnd: 150, gain: 0.8, attack: 0.003, dest });
        break;
      case 'backfire':
        this.noise(t, 0.06, { type: 'lowpass', freq: 1400 * p, gain: 0.5, attack: 0.002, dest });
        this.tone(120 * p, t, 0.07, { type: 'sine', gain: 0.35, freqEnd: 60, dest });
        if (Math.random() < 0.5) this.noise(t + 0.08, 0.04, { type: 'lowpass', freq: 1200 * p, gain: 0.3, dest });
        break;
      case 'turbo':
        // Blow-off valve: a hiss falling away.
        this.noise(t, 0.35, { type: 'bandpass', freq: 5200 * p, freqEnd: 1800, q: 3, gain: 0.12, attack: 0.01, dest });
        break;
      case 'shift':
        this.tone(220 * p, t, 0.04, { type: 'square', gain: 0.05, filter: 1200, dest });
        this.noise(t, 0.03, { type: 'highpass', freq: 2000, gain: 0.06, dest });
        break;
      case 'ignition':
        // Starter motor whirring, then the engine catches.
        for (let i = 0; i < 5; i++) this.tone(48 * p, t + i * 0.09, 0.07, { type: 'sawtooth', gain: 0.08, filter: 600, dest });
        this.tone(40 * p, t + 0.45, 0.4, { type: 'sawtooth', gain: 0.14, freqEnd: 70 * p, filter: 900, dest });
        break;
      case 'alarm':
        for (let i = 0; i < 6; i++) this.tone(i % 2 ? 660 : 880, t + i * 0.25, 0.23, { type: 'sawtooth', gain: 0.06, filter: 2500, dest });
        break;
    }
  }

  // ---------------------------------------------------------------- engine

  private eng: EngineVoice | null = null;
  private engStop = 0;

  private startEngine(profile: EngineProfile): EngineVoice | null {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return null;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.sfxBus);
    // Engine body: two detuned saws (the firing pulses) and a sub, through a low-pass.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.value = 400;
    // Each firing pulse throbs the level a little (amplitude modulation at the firing rate).
    const body = ctx.createGain();
    body.gain.value = 0.7;
    const am = ctx.createOscillator();
    am.type = 'sine';
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.3;
    am.connect(amDepth);
    amDepth.connect(body.gain);
    lp.connect(body);
    body.connect(out);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const saw2 = ctx.createOscillator();
    saw2.type = 'sawtooth';
    saw2.detune.value = 9;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const v = ENGINE_VOICE[profile];
    const g1 = ctx.createGain();
    g1.gain.value = profile === 'electric' ? 0 : 0.5;
    const g2 = ctx.createGain();
    g2.gain.value = profile === 'electric' ? 0 : 0.32;
    const gs = ctx.createGain();
    gs.gain.value = v.sub;
    saw.connect(g1);
    saw2.connect(g2);
    sub.connect(gs);
    g1.connect(lp);
    g2.connect(lp);
    gs.connect(lp);
    // Electric motors and turbos: a tonal whine.
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain);
    whineGain.connect(out);
    // Intake / exhaust rasp: noise around the engine note, and the tyres' skid.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    const raspFilter = ctx.createBiquadFilter();
    raspFilter.type = 'bandpass';
    raspFilter.Q.value = 1.4;
    const rasp = ctx.createGain();
    rasp.gain.value = 0;
    noise.connect(raspFilter);
    raspFilter.connect(rasp);
    rasp.connect(out);
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 1100;
    skidFilter.Q.value = 6;
    const skid = ctx.createGain();
    skid.gain.value = 0;
    noise.connect(skidFilter);
    skidFilter.connect(skid);
    skid.connect(this.sfxBus);
    for (const o of [saw, saw2, sub, whine, am]) o.start();
    noise.start();
    return { profile, out, saw, saw2, sub, whine, whineGain, rasp, raspFilter, lp, noise, skid, skidFilter, am, amDepth };
  }

  private killEngine(e: EngineVoice): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    e.out.gain.setTargetAtTime(0, t, 0.15);
    e.skid.gain.setTargetAtTime(0, t, 0.1);
    window.setTimeout(() => {
      for (const o of [e.saw, e.saw2, e.sub, e.whine, e.am]) o.stop();
      e.noise.stop();
      e.out.disconnect();
      e.skid.disconnect();
    }, 1200);
  }

  /**
   * The engine of the car you're driving, every frame: revs (0..1 of the limiter), how hard
   * you're on the gas (0..1), and tyre skid (0..1). Pass null when you get out.
   */
  engine(s: { profile: EngineProfile; rpm: number; throttle: number; skid: number; damage?: number } | null): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!s) {
      if (this.eng) {
        this.killEngine(this.eng);
        this.eng = null;
      }
      return;
    }
    if (this.eng && this.eng.profile !== s.profile) {
      this.killEngine(this.eng);
      this.eng = null;
    }
    if (!this.eng) {
      if (ctx.currentTime < this.engStop) return;
      this.eng = this.startEngine(s.profile);
      this.engStop = ctx.currentTime + 0.05;
      if (!this.eng) return;
    }
    const e = this.eng;
    const v = ENGINE_VOICE[s.profile];
    const t = ctx.currentTime;
    const rpm = clamp(s.rpm, 0, 1.05);
    const thr = clamp(s.throttle, 0, 1);
    // A damaged engine misfires: the note wobbles.
    const rough = (s.damage ?? 0) > 0.6 ? (Math.random() - 0.5) * (s.damage ?? 0) * 0.25 : 0;
    const f = (v.idle + rpm * v.span) * (1 + rough);
    const k = 0.04;
    e.saw.frequency.setTargetAtTime(f, t, k);
    e.saw2.frequency.setTargetAtTime(f * 2, t, k);
    e.sub.frequency.setTargetAtTime(f * 0.5, t, k);
    e.am.frequency.setTargetAtTime(f * 0.5, t, k);
    e.lp.frequency.setTargetAtTime((260 + rpm * 1500 + thr * 900) * v.cut, t, k);
    e.raspFilter.frequency.setTargetAtTime(f * 6, t, k);
    e.rasp.gain.setTargetAtTime(v.rasp * (0.01 + thr * 0.06 + rpm * 0.03), t, 0.05);
    e.whine.frequency.setTargetAtTime(s.profile === 'electric' ? 180 + rpm * 1400 : f * 9, t, k);
    e.whineGain.gain.setTargetAtTime(v.whine * (0.012 + rpm * 0.03 + thr * 0.01), t, 0.05);
    e.out.gain.setTargetAtTime(0.09 + thr * 0.09 + rpm * 0.06, t, 0.06);
    e.skid.gain.setTargetAtTime(clamp(s.skid, 0, 1) * 0.16, t, 0.05);
    e.skidFilter.frequency.setTargetAtTime(900 + s.skid * 500, t, 0.1);
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
  explosion: 0.08, crash: 0.12, backfire: 0.07, turbo: 0.4, metalHit: 0.03,
  smg: 0.04, ping: 0.03, glass: 0.06, honk: 1, carAlarm: 1.2, alarm: 1.4, keyBeep: 0.02, siren: 1, whiz: 0.08,
  coin: 0.05, spin: 0.12, tick: 0.05, win: 0.15, chips: 0.1, cards: 0.08, dice: 0.2, paint: 0.06, click: 0.03,
};

function pickOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const audio = new AudioEngine();
