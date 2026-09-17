export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.ambientStarted = false;
    this.ambientNodes = [];
    this.samples = new Map();
    this.samplesReady = false;
    this.sampleLoadPromise = null;
  }

  async loadSamples() {
    if (this.sampleLoadPromise) return this.sampleLoadPromise;
    this.sampleLoadPromise = Promise.all(
      Object.entries(SAMPLE_LIBRARY).map(async ([key, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return;
          const bytes = await response.arrayBuffer();
          const buffer = await this.context.decodeAudioData(bytes);
          this.samples.set(key, buffer);
        } catch {
          // Procedural fallbacks keep the game playable if a sample is absent.
        }
      })
    ).then(() => {
      this.samplesReady = true;
      return this.samples;
    });
    return this.sampleLoadPromise;
  }

  playSample(key, { volume = 0.1, rate = 1, pan = 0, offset = 0 } = {}) {
    if (!this.context || this.muted) return false;
    const buffer = this.samples.get(key);
    if (!buffer) return false;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner?.();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain);
    if (panner) {
      panner.pan.value = pan;
      gain.connect(panner).connect(this.master);
    } else {
      gain.connect(this.master);
    }
    source.start(0, offset);
    return true;
  }

  playRandomSample(keys, options = {}) {
    const available = keys.filter((key) => this.samples.has(key));
    if (!available.length) return false;
    const key = available[Math.floor(Math.random() * available.length)];
    return this.playSample(key, options);
  }

  async unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.58;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    if (!this.samplesReady) void this.loadSamples();
    if (!this.ambientStarted) this.startAmbient();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.58, this.context.currentTime, 0.08);
    }
  }

  tone({
    frequency = 220,
    duration = 0.18,
    type = "sine",
    volume = 0.1,
    attack = 0.008,
    release = 0.12,
    detune = 0,
  }) {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.detune.setValueAtTime(detune, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + release + 0.03);
  }

  noise({ duration = 0.2, volume = 0.08, lowpass = 900, highpass = 80 } = {}) {
    if (!this.context || this.muted) return;
    const sampleCount = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, sampleCount, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }
    const source = this.context.createBufferSource();
    const low = this.context.createBiquadFilter();
    const high = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    low.type = "lowpass";
    low.frequency.value = lowpass;
    high.type = "highpass";
    high.frequency.value = highpass;
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      this.context.currentTime + duration
    );
    source.connect(high).connect(low).connect(gain).connect(this.master);
    source.start();
  }

  startAmbient() {
    if (!this.context || this.ambientStarted) return;
    this.ambientStarted = true;

    const droneGain = this.context.createGain();
    droneGain.gain.value = 0.025;
    droneGain.connect(this.master);

    [82.41, 123.47].forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index === 0 ? -8 : 6;
      filter.type = "lowpass";
      filter.frequency.value = 230;
      gain.gain.value = index === 0 ? 0.75 : 0.28;
      oscillator.connect(filter).connect(gain).connect(droneGain);
      oscillator.start();
      this.ambientNodes.push(oscillator);
    });

    const windGain = this.context.createGain();
    windGain.gain.value = 0.012;
    windGain.connect(this.master);
    const windBuffer = this.context.createBuffer(
      2,
      this.context.sampleRate * 3,
      this.context.sampleRate
    );
    for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
      const channel = windBuffer.getChannelData(channelIndex);
      let value = 0;
      for (let i = 0; i < channel.length; i += 1) {
        value += (Math.random() * 2 - 1) * 0.035;
        value *= 0.997;
        channel[i] = value;
      }
    }
    const wind = this.context.createBufferSource();
    const windFilter = this.context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 520;
    windFilter.Q.value = 0.45;
    wind.buffer = windBuffer;
    wind.loop = true;
    wind.connect(windFilter).connect(windGain);
    wind.start();
    this.ambientNodes.push(wind);
  }

  select() {
    this.tone({ frequency: 470, duration: 0.07, type: "triangle", volume: 0.055 });
    this.tone({ frequency: 710, duration: 0.1, type: "sine", volume: 0.028 });
  }

  cancel() {
    this.tone({ frequency: 220, duration: 0.08, type: "triangle", volume: 0.035 });
  }

  move() {
    const played = this.playRandomSample(
      ["move-wood-light-1", "footstep-wood-1", "footstep-grass-1"],
      {
        volume: 0.15,
        rate: 0.92 + Math.random() * 0.14,
        pan: (Math.random() - 0.5) * 0.32,
      }
    );
    if (played) return;
    this.noise({ duration: 0.22, volume: 0.05, lowpass: 740, highpass: 110 });
    this.tone({ frequency: 150, duration: 0.13, type: "sine", volume: 0.045 });
  }

  capture(type) {
    const heavy = ["elephant", "chariot", "cannon"].includes(type);
    const played = this.playRandomSample(
      heavy
        ? ["capture-metal-heavy-1", "capture-plate-heavy-1", "impact-mining-1"]
        : ["capture-metal-medium-1", "capture-plate-medium-1", "impact-soft-heavy-1"],
      {
        volume: heavy ? 0.52 : 0.34,
        rate: heavy ? 0.86 + Math.random() * 0.1 : 0.96 + Math.random() * 0.12,
        pan: (Math.random() - 0.5) * 0.22,
      }
    );
    if (played) return;
    this.noise({
      duration: heavy ? 0.42 : 0.26,
      volume: heavy ? 0.12 : 0.075,
      lowpass: heavy ? 720 : 1200,
      highpass: 60,
    });
    this.tone({
      frequency: heavy ? 72 : 108,
      duration: heavy ? 0.38 : 0.22,
      type: "triangle",
      volume: heavy ? 0.15 : 0.08,
    });
  }

  cannon() {
    const played = this.playSample("capture-plate-heavy-1", {
      volume: 0.62,
      rate: 0.62,
    });
    if (played) {
      window.setTimeout(
        () => this.playSample("impact-mining-1", { volume: 0.35, rate: 0.55 }),
        70
      );
      this.tone({ frequency: 54, duration: 0.5, type: "sine", volume: 0.12 });
      return;
    }
    this.noise({ duration: 0.72, volume: 0.24, lowpass: 520, highpass: 38 });
    this.tone({ frequency: 52, duration: 0.55, type: "sine", volume: 0.22 });
    this.tone({
      frequency: 96,
      duration: 0.3,
      type: "sawtooth",
      volume: 0.05,
      detune: -12,
    });
  }

  check() {
    [0, 0.12, 0.24].forEach((offset, index) => {
      window.setTimeout(() => {
        this.tone({
          frequency: 280 + index * 75,
          duration: 0.18,
          type: "triangle",
          volume: 0.06,
        });
      }, offset * 1000);
    });
  }

  victory() {
    [261.63, 329.63, 392, 523.25].forEach((frequency, index) => {
      window.setTimeout(() => {
        this.tone({
          frequency,
          duration: 0.45,
          type: "triangle",
          volume: 0.075,
          release: 0.5,
        });
      }, index * 150);
    });
  }

  defeat() {
    [220, 185, 146.83].forEach((frequency, index) => {
      window.setTimeout(() => {
        this.tone({
          frequency,
          duration: 0.5,
          type: "sine",
          volume: 0.07,
          release: 0.6,
        });
      }, index * 220);
    });
  }

  dispose() {
    this.ambientNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // Node may already have stopped.
      }
    });
    this.context?.close();
  }
}

const SAMPLE_LIBRARY = Object.freeze({
  "move-wood-light-1": "assets/audio/impact/move-wood-light-1.ogg",
  "move-wood-heavy-1": "assets/audio/impact/move-wood-heavy-1.ogg",
  "capture-metal-heavy-1": "assets/audio/impact/capture-metal-heavy-1.ogg",
  "capture-metal-medium-1": "assets/audio/impact/capture-metal-medium-1.ogg",
  "capture-plate-heavy-1": "assets/audio/impact/capture-plate-heavy-1.ogg",
  "capture-plate-medium-1": "assets/audio/impact/capture-plate-medium-1.ogg",
  "impact-soft-heavy-1": "assets/audio/impact/impact-soft-heavy-1.ogg",
  "impact-mining-1": "assets/audio/impact/impact-mining-1.ogg",
  "bell-heavy-1": "assets/audio/impact/bell-heavy-1.ogg",
  "footstep-grass-1": "assets/audio/impact/footstep-grass-1.ogg",
  "footstep-wood-1": "assets/audio/impact/footstep-wood-1.ogg",
});
