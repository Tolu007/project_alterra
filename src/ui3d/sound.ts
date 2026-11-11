// The sound of the street, made in the browser with the Web Audio API: there are no sound files to download.
// A bed of city hum that follows the traffic, horns, generators and crickets at night, birds at dawn and
// rain in the rainy season, plus small sounds for what you do. Nothing plays until the first tap or key
// (browsers insist), and it stops when the tab is hidden.

export type Sfx = 'tap' | 'cash' | 'spend' | 'arrive' | 'talk' | 'done' | 'bad' | 'ride';

export interface Street {
  /** Hour of the day, 0 to 24. */
  hour: number;
  rainy: boolean;
  /** How much traffic is out, 0 to 1. */
  busy: number;
  /** Hours of grid power a day here: the fewer, the more generators you hear. */
  grid: number;
  /** A big, loud district (Lagos) or a quieter town. */
  loud: number;
}

const KEY = 'nh-sound';

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers: Record<'hum' | 'rain' | 'crickets' | 'gen', GainNode> | null = null;
  private street: Street = { hour: 12, rainy: false, busy: 0.5, grid: 12, loud: 1 };
  private timer = 0;
  private listeners = new Set<() => void>();
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(KEY) === 'off';
    } catch {
      // No storage: sound stays on for this visit.
    }
  }

  /** Call from a tap or a key press: browsers only let sound start then. */
  wake() {
    if (this.muted || typeof window === 'undefined') return;
    if (!this.ctx) this.build();
    if (this.ctx?.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(KEY, m ? 'off' : 'on');
    } catch {
      // Not remembered, that is all.
    }
    if (m) void this.ctx?.suspend();
    else this.wake();
    this.listeners.forEach((fn) => fn());
  }

  /** What the street is like now; the bed of sound eases towards it. */
  set(street: Street) {
    this.street = street;
    this.mix();
  }

  private noise(ctx: AudioContext, brown: boolean): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  private build() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    this.master = master;
    const layer = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(master);
      return g;
    };
    const layers = { hum: layer(), rain: layer(), crickets: layer(), gen: layer() };
    this.layers = layers;
    const loop = (buf: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };
    const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const osc = (type: OscillatorType, freq: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.start();
      return o;
    };
    /** A gain that swells and fades with a slow wave: 0 to 1. */
    const wobble = (rate: number, type: OscillatorType = 'sine') => {
      const g = ctx.createGain();
      g.gain.value = 0.5;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      osc(type, rate).connect(depth).connect(g.gain);
      return g;
    };
    // The city: a low rumble of far-off engines and voices.
    loop(this.noise(ctx, true)).connect(filter('lowpass', 420)).connect(layers.hum);
    // Rain on zinc roofs.
    loop(this.noise(ctx, false)).connect(filter('bandpass', 2600, 0.4)).connect(layers.rain);
    // Crickets: a high note chopped fast, in slow waves.
    osc('sine', 4300).connect(wobble(27, 'square')).connect(wobble(0.6)).connect(layers.crickets);
    osc('sine', 3900).connect(wobble(31, 'square')).connect(wobble(0.37)).connect(layers.crickets);
    // Generators: "I better pass my neighbour" down the street.
    const gen = filter('lowpass', 260);
    osc('sawtooth', 47).connect(gen);
    osc('sawtooth', 71).connect(gen);
    gen.connect(wobble(11)).connect(layers.gen);
    this.mix(0.1);
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.chance(), 450);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else if (!this.muted) void ctx.resume();
    });
  }

  private mix(ease = 2.5) {
    const { ctx, layers } = this;
    if (!ctx || !layers) return;
    const s = this.street;
    const night = s.hour >= 20 || s.hour < 5.5;
    const dusk = s.hour >= 18.5 || s.hour < 6.5;
    const want = {
      hum: (0.05 + 0.16 * s.busy) * s.loud,
      rain: s.rainy ? 0.07 : 0,
      crickets: night ? 0.012 : dusk ? 0.006 : 0,
      gen: Math.max(0, 1 - s.grid / 20) * (night ? 0.05 : 0.018),
    };
    for (const k of Object.keys(want) as (keyof typeof want)[]) layers[k].gain.setTargetAtTime(want[k], ctx.currentTime, ease);
  }

  /** Now and then: a horn somewhere, a bird at dawn. */
  private chance() {
    const { ctx } = this;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const s = this.street;
    if (Math.random() < 0.085 * s.busy * s.loud) this.horn();
    if (s.hour >= 5.5 && s.hour < 9 && !s.rainy && Math.random() < 0.06) this.bird();
  }

  /** One note with a quick attack and a fade. */
  private note(type: OscillatorType, freq: number, at: number, dur: number, vol: number, to?: number, pan = 0, cutoff?: number) {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let out: AudioNode = o.connect(g);
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      out = out.connect(f);
    }
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out = out.connect(p);
    }
    out.connect(master);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private horn() {
    const { ctx } = this;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const far = 0.012 + Math.random() * 0.03;
    const pan = Math.random() * 1.6 - 0.8;
    // Danfos and cars: two notes together. Okadas and kekes: a thin beep.
    const small = Math.random() < 0.35;
    const base = small ? 620 + Math.random() * 160 : 330 + Math.random() * 90;
    const beeps = Math.random() < 0.45 ? 2 : 1;
    const len = small ? 0.09 : 0.14 + Math.random() * 0.2;
    for (let i = 0; i < beeps; i++) {
      const at = t + i * (len + 0.07);
      this.note('square', base, at, len, far, undefined, pan, 1500);
      if (!small) this.note('square', base * 1.26, at, len, far * 0.8, undefined, pan, 1500);
    }
  }

  private bird() {
    const { ctx } = this;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const pan = Math.random() * 1.6 - 0.8;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = 2300 + Math.random() * 1400;
      this.note('sine', f, t + i * 0.13, 0.09, 0.02, f * (Math.random() < 0.5 ? 1.25 : 0.8), pan);
    }
  }

  /** A small sound for something you did. */
  play(kind: Sfx) {
    this.wake();
    const { ctx } = this;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + 0.01;
    switch (kind) {
      case 'tap':
        this.note('triangle', 520, t, 0.05, 0.05);
        break;
      case 'cash':
        // Credit alert.
        this.note('sine', 1320, t, 0.16, 0.09);
        this.note('sine', 1760, t + 0.09, 0.3, 0.09);
        break;
      case 'spend':
        this.note('triangle', 330, t, 0.16, 0.09, 220);
        break;
      case 'arrive':
        this.note('sine', 660, t, 0.18, 0.06);
        this.note('sine', 880, t + 0.1, 0.22, 0.05);
        break;
      case 'talk':
        this.note('triangle', 420, t, 0.07, 0.06, 520);
        this.note('triangle', 560, t + 0.09, 0.08, 0.06, 470);
        break;
      case 'done':
        [523, 659, 784, 1047].forEach((f, i) => this.note('sine', f, t + i * 0.09, 0.26, 0.07));
        break;
      case 'bad':
        this.note('sawtooth', 190, t, 0.2, 0.05, 140, 0, 900);
        break;
      case 'ride':
        // A keke kicking off.
        this.note('sawtooth', 70, t, 0.5, 0.06, 150, 0, 700);
        break;
    }
  }
}

export const sound = new Sound();
