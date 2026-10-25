type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!context) {
    const Ctor: AudioContextConstructor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function primeAudio(): void {
  getContext();
}

function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.09);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const envelope = Math.pow(1 - i / length, 2.6);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }
  noiseBuffer = buffer;
  return buffer;
}

function click(
  ctx: AudioContext,
  { when = 0, volume = 0.22, frequency = 1_900, length = 0.055 }: {
    when?: number;
    volume?: number;
    frequency?: number;
    length?: number;
  } = {},
): void {
  const start = ctx.currentTime + when;
  const source = ctx.createBufferSource();
  source.buffer = getNoise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(240, frequency * 0.36), start + length);
  filter.Q.value = 1.25;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
  source.stop(start + length + 0.01);
}

function tone(
  ctx: AudioContext,
  frequency: number,
  {
    when = 0,
    duration = 0.24,
    volume = 0.05,
    type = 'sine',
  }: { when?: number; duration?: number; volume?: number; type?: OscillatorType } = {},
): void {
  const start = ctx.currentTime + when;
  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playMoveSound(options: { capture?: boolean; check?: boolean } = {}): void {
  const ctx = getContext();
  if (!ctx) return;
  if (options.capture) {
    click(ctx, { volume: 0.3, frequency: 1_250, length: 0.08 });
    click(ctx, { when: 0.045, volume: 0.23, frequency: 620, length: 0.12 });
    tone(ctx, 116, { volume: 0.055, duration: 0.16, type: 'sine' });
  } else {
    click(ctx, { volume: 0.24, frequency: 1_750, length: 0.05 });
    tone(ctx, 164, { volume: 0.028, duration: 0.07 });
  }
  if (options.check) {
    tone(ctx, 1_120, { when: 0.08, volume: 0.028, duration: 0.3, type: 'sine' });
    tone(ctx, 1_684, { when: 0.12, volume: 0.018, duration: 0.35, type: 'sine' });
  }
}

export function playResultSound(winner: 'w' | 'b' | null): void {
  const ctx = getContext();
  if (!ctx) return;
  const notes = winner ? [261.63, 329.63, 392.0, 523.25] : [261.63, 311.13, 392.0];
  notes.forEach((frequency, index) => {
    tone(ctx, frequency, {
      when: index * 0.09,
      duration: 0.8,
      volume: 0.028,
      type: 'sine',
    });
  });
}

export function playInterfaceSound(kind: 'place' | 'undo' | 'new'): void {
  const ctx = getContext();
  if (!ctx) return;
  if (kind === 'undo') {
    click(ctx, { volume: 0.14, frequency: 900, length: 0.07 });
    return;
  }
  if (kind === 'new') {
    tone(ctx, 392, { volume: 0.022, duration: 0.3 });
    tone(ctx, 523.25, { when: 0.07, volume: 0.018, duration: 0.34 });
    return;
  }
  click(ctx, { volume: 0.12, frequency: 1_500, length: 0.04 });
}
