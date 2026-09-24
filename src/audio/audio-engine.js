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
    if (!this.musicStarted) this.startMusic();
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
    const played = this.playRandomSample(["metal-click-1", "handle-coins-1"], {
      volume: 0.12,
      rate: 1.16,
    });
    if (!played) {
      this.tone({ frequency: 470, duration: 0.07, type: "triangle", volume: 0.055 });
      this.tone({ frequency: 710, duration: 0.1, type: "sine", volume: 0.028 });
    }
  }

  cancel() {
    const played = this.playSample("metal-click-1", { volume: 0.07, rate: 0.78 });
    if (!played) this.tone({ frequency: 220, duration: 0.08, type: "triangle", volume: 0.035 });
  }

  /**
   * 走子音效, 按兵种给不同听感。
   *
   * 为什么改: 原来 move() 不收任何参数, 不管走的是战象还是骑兵, 都从
   * ["move-wood-light-1","footstep-wood-1","footstep-grass-1"] 里随机取,
   * 音量统一 0.15。结果一支 3.85 米高的战象和一个步兵踩地的声音一模一样。
   *
   * 音效库里只有 11 个采样, 没有蹄声、没有象步、没有车轮声, 所以这里
   * 的做法是"用现有采样 + 程序化合成"拼出战种特征:
   *   · 重量   —— 基频越低、尾巴越长
   *   · 蹄声   —— 两声紧挨的短促点击(四足交替)
   *   · 车轮   —— 低频持续隆隆声
   *   · 炮车   —— 沉重的木质滚动
   */
  move(type) {
    const profiles = {
      // 步兵: 布鞋踩土, 最干最轻, 没有低频尾巴
      soldier:  { pool: ["footstep-grass-1", "footstep-wood-1", "footstep-rpg-1", "footstep-rpg-2"], volume: 0.13, rate: 1.18, tail: 0 },
      // 军师: 文士缓步 —— 音量最小、音调最高, 用料最"软"
      // 实测原来和骑兵撞在一起(中频 1917 vs 1734), 所以把它的
      // 音调再抬高、音量再压低, 和骑兵的"硬蹄"彻底分开
      advisor:  { pool: ["footstep-grass-1", "cloth-1", "cloth-2"], volume: 0.075, rate: 1.42, tail: 0, soft: 0.05 },
      // 将军: 重甲, 中频为主, 带一点金属摩擦
      general:  { pool: ["footstep-wood-1", "move-wood-light-1", "metal-latch-1"], volume: 0.21, rate: 0.86, tail: 0.10 },
      // 骑兵: 马蹄双击, 高频清脆 + 短促蹄响
      horse:    { pool: ["move-wood-light-1", "footstep-rpg-1"], volume: 0.22, rate: 1.34, hoof: true, clip: 0.11 },
      // 战车: 木轮滚动, 中低频为主
      // 原来和炮车几乎一样(低频 1732 vs 1737), 所以把两者的
      // 滚动成分和音调拉开: 战车偏高偏轻快, 炮车最低最闷
      chariot:  { pool: ["move-wood-heavy-1", "metal-pot-heavy-1"], volume: 0.25, rate: 1.16, hoof: true, rumble: 0.09, rumbleHz: 420 },
      // 炮车: 最闷最沉, 低频轰鸣, 无马蹄
      cannon:   { pool: ["move-wood-heavy-1", "metal-pot-heavy-1"], volume: 0.30, rate: 0.62, rumble: 0.22, rumbleHz: 150 },
      // 战象: 一声闷响带长尾, 低频最重
      //
      // 实测过一版: 只把音量调大、音调调到 0.50, 结果频谱距离和步兵只有 6,
      // 几乎听不出区别 —— 因为步兵的脚步本身也有低频成分, 单纯"更响更低"
      // 拉不开距离。所以改成给它一条**步兵完全没有的低频结构**:
      // 一个 34Hz 的次低频正弦(接近人耳下限的"胸口震动") + 长达 1.1 秒的
      // 尾巴, 再叠两次错开的踏地, 模拟四足交替的沉重步伐。
      elephant: {
        pool: ["impact-soft-heavy-1"], volume: 0.30, rate: 0.44,
        tail: 0.30, tailHz: 34, tailDur: 1.15,
        rumble: 0.08, rumbleHz: 95, steps: 2,
      },
    };
    const p = profiles[type] || profiles.soldier;

    const played = this.playRandomSample(p.pool, {
      volume: p.volume,
      // rate 越大音调越高、听起来越轻; 于是体型越大 rate 越低
      rate: p.rate * (0.94 + Math.random() * 0.12),
      pan: (Math.random() - 0.5) * 0.32,
    });
    if (!played) {
      this.noise({ duration: 0.22, volume: 0.05, lowpass: 740, highpass: 110 });
      this.tone({ frequency: 150, duration: 0.13, type: "sine", volume: 0.045 });
      return;
    }

    // 身体发出的低频"重量感"
    if (p.tail) {
      this.tone({
        frequency: p.tailHz || 96 - p.tail * 120,
        duration: p.tailDur || 0.18 + p.tail * 0.9,
        type: "sine",
        volume: p.tail,
      });
    }
    // 多足交替的沉重步点: 战象走一步实际上是四条腿轮流落地,
    // 用错开的第二次踏地表现"不止一脚", 单声脚步做不到这一点
    if (p.steps) {
      for (let i = 1; i < p.steps; i += 1) {
        window.setTimeout(() => {
          this.playRandomSample(p.pool, {
            volume: p.volume * (0.8 - i * 0.18),
            rate: p.rate * (1.0 + i * 0.09),
            pan: (Math.random() - 0.5) * 0.5,
          });
        }, 190 * i + Math.random() * 40);
      }
    }
    // 衣料摩擦: 军师这种轻装单位特有的"沙沙"感, 给它的中频
    // 补一层软噪声, 和骑兵的硬质蹄声区分开
    if (p.soft) {
      this.noise({ duration: 0.3, volume: p.soft, lowpass: 2600, highpass: 900 });
    }
    // 四足动物的第二声蹄音: 紧跟在第一声之后, 稍轻
    if (p.hoof) {
      window.setTimeout(() => {
        this.playRandomSample(p.pool, {
          volume: p.volume * 0.62,
          rate: p.rate * (1.02 + Math.random() * 0.1),
          pan: (Math.random() - 0.5) * 0.4,
        });
      }, 110 + Math.random() * 50);
    }
    // 骑兵额外的短促清脆点击, 强化"蹄铁"质感
    if (p.clip) {
      this.tone({ frequency: 2400, duration: 0.035, type: "square", volume: p.clip, release: 0.05 });
    }
    // 车轮/重物的持续滚动声
    if (p.rumble) {
      this.rumble(p.rumble, 0.42, p.rumbleHz || 260);
    }
  }

  /**
   * 低频滚动噪声, 用来表现木轮碾地、重物拖行。
   * 用低通滤过的白噪声, 比正弦更像"摩擦"而不是"音调"。
   *
   * cutoff 决定"这是哪种滚动": 420Hz 是轻快的木轮, 150Hz 是沉重的铁包木轮,
   * 110Hz 是巨物拖行。战车和炮车原来共用一套参数, 听起来分不出,
   * 现在靠这个参数把它们拉开。
   */
  rumble(volume = 0.14, duration = 0.42, cutoff = 260) {
    if (!this.context || this.muted) return;
    const sampleCount = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, sampleCount, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let value = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      // 一阶低通做平滑随机游走, 得到低沉而不刺耳的隆隆声
      value += (Math.random() * 2 - 1) * 0.22;
      value *= 0.93;
      const envelope = 1 - i / sampleCount;
      channel[i] = value * envelope;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(0);
  }

  /**
   * 吃子音效, 按**进攻方**兵种给不同听感。
   *
   * 为什么改: 原来只分 heavy / light 两档 (elephant/chariot/cannon 算重),
   * 于是将军劈砍和士兵戳刺听起来完全一样, 战象的践踏和战车的撞击也一样。
   * 现在七个兵种各有自己的音色组合。
   */
  capture(type) {
    const profiles = {
      // 步兵: 短促的金属戳刺, 音调最高
      soldier:  { pool: ["capture-metal-medium-1", "knife-slice-1"], volume: 0.34, rate: 1.22, ring: 0.05, ringHz: 2600 },
      // 军师: 最轻, 偏"格挡"而非"击杀"; 配音调更高的轻响和它区分
      advisor:  { pool: ["capture-plate-medium-1", "metal-click-1"], volume: 0.22, rate: 1.40, ring: 0, soft: 0.06 },
      // 将军: 重兵器劈砍, 有金属长鸣
      general:  { pool: ["capture-metal-heavy-1", "draw-knife-1"], volume: 0.48, rate: 0.98, ring: 0.12, ringHz: 1850 },
      // 骑兵: 冲锋撞击, 快而脆, 带蹄声余韵
      horse:    { pool: ["capture-metal-medium-1", "impact-soft-heavy-1", "knife-slice-2"], volume: 0.44, rate: 1.16, ring: 0.08, ringHz: 2200, thud: 0.10 },
      // 战车: 木石碾压, 中低频
      //
      // 实测和炮车的吃子频谱距离只有 15, 两者共用同一组采样是主因。
      // 拆开: 战车保留"碾压"的宽频噪声(木轮碎裂), 炮车改用
      // 更纯的低频爆响 + 长时间金属余鸣, 一个"散"一个"沉"。
      chariot:  { pool: ["capture-plate-heavy-1", "metal-pot-heavy-1"], volume: 0.50, rate: 1.06, ring: 0.09, ringHz: 1500, thud: 0.13, thudHz: 78, debris: 0.13 },
      // 炮车: 铁件崩裂, 最闷的低频, 无碎屑噪声
      cannon:   { pool: ["impact-mining-1", "capture-metal-heavy-1", "metal-pot-heavy-1"], volume: 0.58, rate: 0.62, ring: 0.05, ringHz: 900, thud: 0.24, thudHz: 46 },
      // 战象: 最沉, 踩踏式的低频冲击, 没有金属声
      elephant: { pool: ["impact-soft-heavy-1", "impact-mining-1"], volume: 0.62, rate: 0.48, ring: 0, thud: 0.36, thudHz: 40 },
    };
    const p = profiles[type] || profiles.soldier;

    const played = this.playRandomSample(p.pool, {
      volume: p.volume,
      rate: p.rate * (0.96 + Math.random() * 0.1),
      pan: (Math.random() - 0.5) * 0.22,
    });
    if (!played) {
      this.noise({
        duration: p.thud > 0.2 ? 0.42 : 0.26,
        volume: p.thud > 0.2 ? 0.12 : 0.075,
        lowpass: p.thud > 0.2 ? 720 : 1200,
        highpass: 60,
      });
      this.tone({
        frequency: p.thud > 0.2 ? 72 : 108,
        duration: p.thud > 0.2 ? 0.38 : 0.22,
        type: "triangle",
        volume: p.thud > 0.2 ? 0.15 : 0.08,
      });
      return;
    }

    // 轻装单位命中时的布革摩擦
    if (p.soft) {
      this.noise({ duration: 0.26, volume: p.soft, lowpass: 2800, highpass: 1100 });
    }
    // 碎裂飞溅的高频噪声: 战车撞碎木石时特有, 炮车没有
    if (p.debris) {
      this.noise({ duration: 0.34, volume: p.debris, lowpass: 5200, highpass: 1600 });
    }
    // 重兵器命中后金属余鸣, 频率按兵器重量递减
    if (p.ring) {
      this.tone({
        frequency: p.ringHz || 1750,
        duration: 0.42,
        type: "triangle",
        volume: p.ring,
        release: 0.5,
      });
    }
    // 落地/践踏的低频冲击, 让重单位"砸下去"有实感
    if (p.thud) {
      this.tone({
        frequency: p.thudHz || 58,
        duration: 0.16 + p.thud * 0.7,
        type: "sine",
        volume: p.thud,
      });
    }
  }

  cannon() {
    const played = this.playRandomSample(["capture-plate-heavy-1", "metal-pot-heavy-1"], {
      volume: 0.62,
      rate: 0.62,
    });
    if (played) {
      window.setTimeout(
        () => this.playRandomSample(["impact-mining-1", "metal-pot-heavy-1"], { volume: 0.35, rate: 0.55 }),
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
    if (this.playSample("metal-latch-1", { volume: 0.18, rate: 0.72 })) return;
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
    this.playSample("handle-coins-2", { volume: 0.08, rate: 0.72 });
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
    this.playSample("cloth-1", { volume: 0.08, rate: 0.72 });
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

  /**
   * 背景音乐: 五声音阶的战阵主题。
   *
   * 为什么用程序化生成而不是放音频文件:
   *   现有的 startAmbient 只有一条低频 drone(82Hz/123Hz 两个正弦)加风声,
   *   那是"氛围", 不是"音乐" —— 没有旋律、没有节拍、没有推进, 听久了只是
   *   一层嗡嗡声。而一段能循环几分钟不腻的配乐, 用 ogg 至少几百 KB,
   *   还会和现有的 11 个音效抢加载带宽。
   *   这里改用 Web Audio 现场合成: 音高取自中国五声音阶(宫商角徵羽),
   *   配一个缓慢的鼓点, 长度无限且零字节。
   *
   * 三个声部:
   *   · 古筝式拨弦 —— 主旋律, 随机游走五声音阶, 带长衰减
   *   · 低音鼓点    —— 每两拍一记, 给出战阵的行进感
   *   · 持续低音    —— 撑住和声底, 复用已有 drone
   *
   * 强度跟随战况: 开局平缓(只有旋律+低音), 进入中局后加入鼓点,
   * 将军被吃时整体提高音量和密度。
   */
  startMusic() {
    if (!this.context || this.musicStarted) return;
    this.musicStarted = true;
    this.musicIntensity = 0.6;

    // 五声音阶: 宫 商 角 徵 羽(对应 C D E G A), 跨三个八度
    // 中国古乐的味道主要来自"没有 fa 和 si"这两级
    this.musicScale = [
      130.81, 146.83, 164.81, 196.0, 220.0,     // C3 D3 E3 G3 A3
      261.63, 293.66, 329.63, 392.0, 440.0,     // C4 D4 E4 G4 A4
      523.25, 587.33, 659.25, 783.99, 880.0,    // C5 D5 E5 G5 A5
    ];
    this.musicIndex = 6; // 从中音区起步

    const musicGain = this.context.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(this.master);
    this.musicGain = musicGain;
    // 淡入, 避免开局突然响起
    musicGain.gain.setTargetAtTime(0.16, this.context.currentTime, 2.5);

    // 旋律每 1.6~2.6 秒一个音, 节奏故意不均匀 —— 均匀就成了练习曲,
    // 不匀才有"人拨弦"的感觉
    const scheduleNote = () => {
      if (!this.musicStarted) return;
      const step = this.musicScale.length;
      // 随机游走: 相邻音之间最多跳两个音级, 偶尔来一个大跳做点缀
      const drift = Math.random() < 0.18
        ? (Math.random() < 0.5 ? -3 : 3)
        : Math.round((Math.random() - 0.5) * 4);
      this.musicIndex = Math.max(2, Math.min(step - 3, this.musicIndex + drift));
      this.pluck(this.musicScale[this.musicIndex]);

      // 密度跟着强度走: 紧张时音更密
      const base = 2600 - this.musicIntensity * 1100;
      const delay = base + Math.random() * 900;
      this.musicTimer = window.setTimeout(scheduleNote, delay);
    };
    this.musicTimer = window.setTimeout(scheduleNote, 1200);

    // 鼓点: 每 2.4 秒一记, 强度低时跳过, 让音乐有"从静谧到临战"的层次
    const scheduleDrum = () => {
      if (!this.musicStarted) return;
      if (this.musicIntensity > 0.42) this.drum();
      this.drumTimer = window.setTimeout(scheduleDrum, 2400);
    };
    this.drumTimer = window.setTimeout(scheduleDrum, 3600);
  }

  /**
   * 一记拨弦: 三角形波 + 快起长落的包络, 加一点失谐让它像丝弦而非电子音。
   */
  pluck(frequency) {
    if (!this.context || this.muted || !this.musicGain) return;
    const now = this.context.currentTime;
    const duration = 2.4;
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    // 拨弦的高频衰减比低频快, 用滤波器扫频模拟
    filter.frequency.setValueAtTime(frequency * 7, now);
    filter.frequency.exponentialRampToValueAtTime(frequency * 1.6, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(filter).connect(this.musicGain);
    // 两个略微失谐的振荡器叠加, 产生"弦的厚度"
    [0, 4].forEach((detune) => {
      const osc = this.context.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + duration + 0.05);
    });
  }

  /** 低音鼓: 频率下滑的正弦 + 一点噪声, 给出战鼓的实心感 */
  drum() {
    if (!this.context || this.muted || !this.musicGain) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(96, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.34);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.42 * this.musicIntensity, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);
    osc.connect(gain).connect(this.musicGain);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  /**
   * 调整音乐强度(0~1)。战况越紧张, 旋律越密、鼓点越响。
   * 由 controller 在吃子/将军时调用。
   */
  setMusicIntensity(value) {
    this.musicIntensity = Math.max(0, Math.min(1, value));
  }

  dispose() {
    this.musicStarted = false;
    window.clearTimeout(this.musicTimer);
    window.clearTimeout(this.drumTimer);
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
  "cloth-1": "assets/audio/kenney-rpg/cloth1.ogg",
  "cloth-2": "assets/audio/kenney-rpg/cloth2.ogg",
  "draw-knife-1": "assets/audio/kenney-rpg/drawKnife1.ogg",
  "footstep-rpg-1": "assets/audio/kenney-rpg/footstep00.ogg",
  "footstep-rpg-2": "assets/audio/kenney-rpg/footstep01.ogg",
  "handle-coins-1": "assets/audio/kenney-rpg/handleCoins.ogg",
  "handle-coins-2": "assets/audio/kenney-rpg/handleCoins2.ogg",
  "knife-slice-1": "assets/audio/kenney-rpg/knifeSlice.ogg",
  "knife-slice-2": "assets/audio/kenney-rpg/knifeSlice2.ogg",
  "metal-click-1": "assets/audio/kenney-rpg/metalClick.ogg",
  "metal-latch-1": "assets/audio/kenney-rpg/metalLatch.ogg",
  "metal-pot-heavy-1": "assets/audio/kenney-rpg/metalPot1.ogg",
});
