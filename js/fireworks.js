class FireworksEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true});


    // ---- audio/user-gesture hook (for mobile autoplay restrictions) ----
    this._gestureDone = false;
    this.onUserGesture = null; // set via setOnUserGesture(fn)
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.w = 0; this.h = 0;
	this.waterLine = 0.72; // 屏幕高度的 72% 作为“地平线/水面上沿”
	
	this.timeSec = 0;
	this.reflectBoost = 0;
	
    this.rockets = [];
    this.particles = [];
    this.smokes = [];
    this.flashes = [];

    this.type = "goldWillow";
    this.userType = this.type;
    this._idleSince = 0;
    this._idleCleared = false;
    this._showIdx = 0;
    this.userType = this.type;
    this._cleanupBoost = 0; // seconds remaining for extra fade
    this._lastShowType = null;
    this._showLast = 0;
    this.power = 1.0;
    this.lowPower = false;

    // 摄影感关键：更慢的背景淡出 + additive 叠加
    this.bgFade = 0.06;
    this.lastT = performance.now();

    this.showMode = false;
    this.showStart = 0;
    this.showPlan = [
      { t: 0.00, type: 'random' },
      { t: 0.75, type: 'random' },
      { t: 1.50, type: 'random' },
      { t: 2.25, type: 'random' },
      { t: 3.00, type: 'random' },
      { t: 3.75, type: 'random' },
      { t: 4.50, type: 'random' },
      { t: 5.25, type: 'random' },
      { t: 6.00, type: 'random' },
      { t: 6.75, type: 'random' },
      { t: 7.50, type: 'random' },
      { t: 8.25, type: 'random' },
      { t: 9.00, type: 'random' },
      { t: 9.75, type: 'random' },
      { t: 10.50, type: 'random' },
      { t: 11.25, type: 'random' },
      { t: 12.00, type: 'random' },
      { t: 12.75, type: 'random' },
      { t: 13.50, type: 'random' },
      { t: 14.25, type: 'random' },
      { t: 15.00, type: 'random' },
      { t: 15.75, type: 'random' },
      { t: 16.50, type: 'random' },
      { t: 17.25, type: 'random' },
      { t: 18.00, type: 'random' },
      { t: 18.75, type: 'random' },
      { t: 19.50, type: 'random' },
      { t: 20.25, type: 'random' }
    ];

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize, { passive: true });
    window.addEventListener('orientationchange', this._resize, { passive: true });
    this._resize();

    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  setType(type) { this.type = type; this.userType = type; }
  setPower(v) { this.power = Math.max(0.6, Math.min(1.8, v)); }
  setLowPower(on) {
    this.lowPower = !!on;
    this.bgFade = this.lowPower ? 0.10 : 0.06;
  }
  isLowPower() { return this.lowPower; }


  // Called once on the first real user interaction (tap/click).
  setOnUserGesture(fn) { this.onUserGesture = (typeof fn === 'function') ? fn : null; }

  // Notify engine that a user gesture occurred (safe to call repeatedly).
  notifyUserGesture() {
    if (this._gestureDone) return;
    this._gestureDone = true;
    try { this.onUserGesture && this.onUserGesture(); } catch (e) {}
  }


  clear() {
    this.rockets.length = 0;
    this.particles.length = 0;
    this.smokes.length = 0;
    this.flashes.length = 0;
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.clearRect(0, 0, this.w, this.h);

  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.floor(rect.width * this.dpr);
    this.h = Math.floor(rect.height * this.dpr);
    this.canvas.width = this.w;
    this.canvas.height = this.h;

    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.clearRect(0, 0, this.w, this.h);

  }

  getPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: x * this.w, y: y * this.h };
  }

  // ---------- show control ----------
  startShow() {
    this.showMode = true;
    this.showStart = performance.now();
    // Save current user type so we can restore after the show
    this._savedUserType = this.userType || this.type;
    this._lastShowType = null;
    this._showIdx = 0;
    this._showLast = 0;
  }
  stopShow() {
    this.showMode = false;
    // Restore user's selected type
    if (this._savedUserType) this.type = this._savedUserType;

    // Hard clear once when show ends: removes residual trails / reflections / waterline seam
    this.clear();

    // Reset timers/state
    this._cleanupBoost = 0;
    this._idleSince = 0;
    this._idleCleared = false;
  }
showTick() {
  if (!this.showMode) return;

  const now = performance.now();
  const interval = this.lowPower ? 520 : 340; // how often to launch during show
  if (this._showLast && (now - this._showLast) < interval) return;
  this._showLast = now;

  // 1-2 launches per beat; occasional big burst
  const launches = (Math.random() < 0.35) ? 2 : 1;
  for (let i = 0; i < launches; i++) {
    this.type = this.randomShowType();
    const big = Math.random() < 0.14;
    this.launchAtRandom({ big, show: true });
  }
}



  // ---------- launch ----------
  launchAtRandom(opts = {}) {
    // 爆点固定在上半区，避免“在你脸前炸”
    const x = this.rand(this.w * 0.22, this.w * 0.78);
    const y = this.rand(this.h * 0.18, this.h * 0.45);
    this.launch(x, y, opts);
  }

  launch(x, y, opts = {}) {
    const big = !!opts.big;
    const show = !!opts.show;

    // 关键：发射点尽量在目标正下方 → 火箭更垂直、更像视频
    const sx = this.lerp(x, this.w * 0.5, 0.10) + this.rand(-22, 22) * this.dpr;
    const sy = this.h + this.rand(40, 90) * this.dpr;

    // show 模式再往中间收一点，更舞台
    const tx = show ? this.lerp(x, this.w * 0.5, 0.18) : x;
    const ty = show ? Math.min(y, this.h * 0.42) : Math.min(y, this.h * 0.55);

    // 上升速度
    const travel = big ? 0.020 : 0.018;

    this.rockets.push({
      x: sx, y: sy,
      px: sx, py: sy,
      tx, ty,
      vx: (tx - sx) * travel,
      vy: (ty - sy) * travel,
      age: 0,
      ttl: big ? 70 : 58,
      sparkle: 0
    });
  }

  // ---------- main loop ----------
  _tick(t) {
    const dt = Math.min(0.033, (t - this.lastT) / 1000);
    this.lastT = t;
	
	this.timeSec += dt;
	
	// 反射亮度自然衰减（爆炸后亮一下，然后慢慢回落）
	const decay = this.lowPower ? 2.6 : 2.1; // 数值越大，衰减越快
	this.reflectBoost = Math.max(0, this.reflectBoost - dt * decay);
	// 根据当前粒子数进入“忙碌模式”（自动降特效）
	const busyLine = this.lowPower ? 1400 : 4200;
	this.busy = this.particles.length > busyLine;

    this._fadeBackground();
    this.showTick();
    this._updateRockets(dt);
    this._updateParticles(dt);
    this._updateSmoke(dt);
    this._updateFlashes(dt);

    // --- idle auto-clear (single-fire): keep trails while fading, then clean the scene ---
    if (!this.showMode) {
      const hasActive =
        (this.rockets && this.rockets.length) ||
        (this.particles && this.particles.length) ||
        (this.smokes && this.smokes.length) ||
        (this.flashes && this.flashes.length);

      if (!hasActive) {
        if (!this._idleSince) this._idleSince = performance.now();
        const idleMs = performance.now() - this._idleSince;
        if (!this._idleCleared && idleMs > 900) {
          this.clear();
          this._idleCleared = true;
        }
      } else {
        this._idleSince = 0;
        this._idleCleared = false;
      }
    }

    requestAnimationFrame(this._tick);
  }

 _fadeBackground() {
  const ctx = this.ctx;

  // Extra fade when cleanup boost is active
  const boost = this._cleanupBoost > 0 ? 0.12 : 0;
  const fade = Math.min(0.28, this.bgFade + boost);

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0,0,0,${fade})`;
  ctx.fillRect(0, 0, this.w, this.h);

  // Prevent the waterline 'white edge' by gently clearing a narrow band each frame
  const waterY = this.h * this.waterLine;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, waterY - 2 * this.dpr, this.w, 5 * this.dpr);

  ctx.restore();

  // decay cleanup boost timer
  if (this._cleanupBoost > 0) this._cleanupBoost = Math.max(0, this._cleanupBoost - 1/60);
}


  _updateRockets(dt) {
    const ctx = this.ctx;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age++;

      r.px = r.x; r.py = r.y;
      r.x += r.vx;
      r.y += r.vy;

      // 火箭重力很小，保持“冲上去”的感觉
      r.vy += 6 * this.dpr * dt;

      // 画火箭拖尾（线段 + 小火花），更像视频
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "rgba(220,235,255,1)";
      ctx.lineWidth = 1.6 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(r.px, r.py);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();

      // 生成上升火花
      const sparks = this.lowPower ? 1 : 2;
      for (let s = 0; s < sparks; s++) {
        if (Math.random() < 0.7) {
          this._addStar(r.x, r.y, this.rand(-20, 20)*this.dpr, this.rand(10, 40)*this.dpr, {
            color: "rgba(240,250,255,1)",
            size: this.rand(0.7, 1.1) * this.dpr,
            alpha: this.rand(0.3, 0.7),
            ttl: this.rand(0.25, 0.45),
            trail: 0.55
          });
        }
      }
      ctx.globalAlpha = 1;

      // 到达爆点：break flash + explode
      const dx = r.tx - r.x, dy = r.ty - r.y;
      if (r.age > r.ttl || (dx*dx + dy*dy) < (24*this.dpr)*(24*this.dpr)) {
        this._flash(r.x, r.y);
        this._explode(r.x, r.y, r.ttl > 60);
        this._smokePuff(r.x, r.y);
        // After a burst, speed up fade briefly to clear residual trails
        this._cleanupBoost = Math.max(this._cleanupBoost, 0.55);
        this.rockets.splice(i, 1);
      }
    }
  }

  _updateParticles(dt) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "lighter";

    const air = 0.985;
    const gravity = 115 * this.dpr;

    // 粒子上限
    const maxP = this.lowPower ? 2400 : 6500;      // 提高上限（非低端机）
    const softCap = Math.floor(maxP * 1.25);       // 允许短时间峰值
    if (this.particles.length > softCap) {
      // 只在“严重超量”时才裁剪到 maxP，避免半途截断下坠
      this.particles.splice(0, this.particles.length - maxP);
    }

	

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      p.age += dt;
      if (p.age > p.ttl) { this.particles.splice(i, 1); continue; }

      // 记录上一帧位置用于“光丝拖尾”
      p.px = p.x; p.py = p.y;

      // wiggle（银鱼/柳条轻摆）
      if (p.wiggle) {
        p.vx += Math.sin((p.age * p.wiggleFreq) + p.wiggleSeed) * p.wiggleAmp * dt;
      }

      // 阻力（水平/垂直可分）
      p.vx *= air * p.dragX;
      p.vy *= air * p.dragY;

      p.vy += gravity * dt;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // 闪烁
      if (p.twinkle && Math.random() < 0.18) {
        p.alpha *= this.rand(0.75, 1.05);
      }

      p.alpha *= p.fade;
	  
	  // —— 动态湖面反射：随爆炸亮度变化 + 轻微水波扭曲 —— 
	  const waterY = this.h * this.waterLine;
	  
	  if (p.y < waterY) {
	    // 反射强度：基础很淡，爆炸时明显增强，然后衰减
	    const boost = this.reflectBoost;                 // 0..1
	    const baseA = 0.04 + 0.18 * boost;               // 反射透明度基准（可调）
	    const a = Math.min(0.22, p.alpha * baseA);       // 最终反射透明度（上限别太高）
	  
	    // 镜像到水面下，并压缩距离（像水面）
	    const ry = waterY + (waterY - p.y) * 0.58;
	  
	    // 波纹扭曲：越靠近水面越明显，爆炸时也更明显
	    const wave = (0.7 + 1.6 * boost);
	    const wobble = Math.sin(this.timeSec * 1.2 + ry * 0.035) * (2.2 * this.dpr) * wave;
	    const rx = p.x + wobble;
	  
	    const rpy = waterY + (waterY - p.py) * 0.58;
	    const rpx = p.px + Math.sin(this.timeSec * 1.2 + rpy * 0.035) * (2.2 * this.dpr) * wave;
	  
	    ctx.save();
	    ctx.globalCompositeOperation = "screen";
	  
	    // 反射拖尾：更短、更“贴水面”
	    ctx.globalAlpha = a;
	    ctx.strokeStyle = p.color;
	    ctx.lineWidth = p.size * (1.15 + 0.20 * boost);
	    ctx.beginPath();
	    ctx.moveTo(rpx, rpy);
	    ctx.lineTo(rx, ry);
	    ctx.stroke();
	  
	    // 反射点：略大、略虚，爆炸时更亮一点
	    ctx.globalAlpha = a * 0.85;
	    ctx.fillStyle = p.color;
	    ctx.beginPath();
	    ctx.arc(rx, ry, p.size * (1.35 + 0.25 * boost), 0, Math.PI * 2);
	    ctx.fill();
	  
	    // 小范围“水面辉光”（很淡，但能让反射更像视频）
	    if (!this.lowPower && boost > 0.05) {
	      ctx.globalAlpha = a * 0.35;
	      ctx.beginPath();
	      ctx.arc(rx, ry, p.size * (3.0 + 2.0 * boost), 0, Math.PI * 2);
	      ctx.fill();
	    }
	  
	    ctx.restore();
	  }


      // 画“光丝”（这是像视频的关键！）
      const trailLen = p.trail;
      ctx.globalAlpha = Math.min(1, p.alpha);

      if (trailLen > 0.01) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      // 画星点
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.75, 0, Math.PI * 2);
      ctx.fill();

      // 外圈辉光（适度）
      if (!this.lowPower && p.glow) {
        ctx.globalAlpha = p.alpha * 0.22;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // 清理
      if (p.alpha < 0.02 || p.y > this.h + 120*this.dpr || p.x < -120*this.dpr || p.x > this.w + 120*this.dpr) {
        this.particles.splice(i, 1);
      }
    }

    ctx.globalAlpha = 1;
  }

  _updateSmoke(dt) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "source-over";
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      if (s.age > s.ttl) { this.smokes.splice(i, 1); continue; }

      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy -= 6 * this.dpr * dt; // 慢慢上飘
      s.alpha *= 0.985;
	  
	  // —— 水面裁剪：烟雾进入水面区域就快速消失 ——
	  const waterY = this.h * this.waterLine;
	  if (s.y > waterY) {
	    s.alpha *= 0.70;
	    if (s.alpha < 0.02) { this.smokes.splice(i, 1); continue; }
	  }


      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = "rgba(180,190,210,1)";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _updateFlashes(dt) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      if (f.age > f.ttl) { this.flashes.splice(i, 1); continue; }
      const k = 1 - (f.age / f.ttl);
      ctx.globalAlpha = 0.35 * k;
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.6 - k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- visual helpers ----------
  _flash(x, y) {
    this.flashes.push({ x, y, r: 26*this.dpr, age: 0, ttl: 0.12 });
	// 爆点越亮，水面反射越亮
	this.reflectBoost = Math.min(1.0, this.reflectBoost + 0.55 * this.power);

  }

  _smokePuff(x, y) {
    const n = this.lowPower ? 8 : 14;
    for (let i = 0; i < n; i++) {
      this.smokes.push({
        x: x + this.rand(-12, 12)*this.dpr,
        y: y + this.rand(-10, 10)*this.dpr,
        vx: this.rand(-25, 25)*this.dpr,
        vy: this.rand(-30, 10)*this.dpr,
        r: this.rand(10, 22) * this.dpr,
        alpha: this.rand(0.06, 0.12),
        age: 0,
        ttl: this.rand(0.8, 1.6)
      });
    }
  }

  // ---------- explode patterns ----------
  _explode(x, y, big) {
    const base = (big ? 1.25 : 1.0) * this.power;
	
	// 粒子太多时自动降密度，保证老烟花能完整下坠
	const load = this.lowPower ? 2400 : 6500;
	const density = Math.max(0.35, 1 - (this.particles.length / load) * 0.8);
	const base2 = base * density;
	// 忙碌时让新烟花整体略收敛一点（更省）
	const base3 = this.busy ? base2 * 0.85 : base2;


    switch (this.type) {
	  case "wishTree": return this._wishTree(x, y, base3);
	  case "jellyfish": return this._jellyfish(x, y, base3);
      case "goldWillow": return this._goldWillow(x, y, base3);
      case "blueCore": return this._blueCore(x, y, base3);
      case "angelWings": return this._angelWings(x, y, base3);
      case "rainbowSmoke": return this._rainbowSmoke(x, y, base3);
      case "blueCluster": return this._blueCluster(x, y, base3);
      default: return this._goldWillow(x, y, base3);
    }
  }

  // 九天揽月：先在空中“开伞面”，再变成金柳下垂（最贴你说的）
  _goldWillow(x, y, k) {
    const shellN = this.lowPower ? 160 : 320;
    const willowN = this.lowPower ? 260 : 520;

    // 伞面：圆形外扩 + 轻微上扬（先在空中散开）
    for (let i = 0; i < shellN; i++) {
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(360, 520) * this.dpr * k;
      const vx = Math.cos(a) * sp;
      const vy = Math.sin(a) * sp - this.rand(120, 220) * this.dpr;

      this._addStar(x, y, vx, vy, {
        color: this.gold(),
        size: this.rand(1.0, 1.6) * this.dpr,
        alpha: this.rand(0.65, 1.0),
        ttl: this.rand(0.55, 0.9),
        fade: this.rand(0.980, 0.992),
        trail: 0.95,
        glow: true,
        twinkle: true,
        dragX: 0.992,
        dragY: 0.992
      });
    }

    // 柳条：更耐久、更长光丝、轻摆动、水平收敛 → 金丝雨
    for (let i = 0; i < willowN; i++) {
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(260, 460) * this.dpr * k;
      const vx = Math.cos(a) * sp * 0.9;
      const vy = Math.sin(a) * sp * 0.7 - this.rand(20, 90) * this.dpr;

      this._addStar(x, y, vx, vy, {
        color: this.gold(),
        size: this.rand(0.9, 1.35) * this.dpr,
        alpha: this.rand(0.45, 0.95),
        ttl: this.rand(1.3, 2.2),
        fade: this.rand(0.988, 0.996),
        trail: 1.15,
        glow: true,
        twinkle: true,
        wiggle: true,
        wiggleAmp: this.rand(120, 220) * this.dpr,
        wiggleFreq: this.rand(7, 12),
        dragX: 0.972,
        dragY: 0.994
      });
    }
  }

  // 蓝芯银鱼：蓝核爆开 + 银丝长拖尾
  _blueCore(x, y, k) {
    const coreN = this.lowPower ? 140 : 260;
    const fishN = this.lowPower ? 240 : 520;

    for (let i = 0; i < coreN; i++) {
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(260, 420) * this.dpr * k;
      this._addStar(x, y, Math.cos(a)*sp, Math.sin(a)*sp - this.rand(60, 140)*this.dpr, {
        color: "rgba(130,180,255,1)",
        size: this.rand(1.0, 1.9) * this.dpr,
        alpha: this.rand(0.55, 1.0),
        ttl: this.rand(0.7, 1.2),
        fade: this.rand(0.982, 0.992),
        trail: 1.0,
        glow: true,
        twinkle: true,
        dragX: 0.990,
        dragY: 0.990
      });
    }

    for (let i = 0; i < fishN; i++) {
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(320, 560) * this.dpr * k;
      this._addStar(x, y, Math.cos(a)*sp, Math.sin(a)*sp - this.rand(10, 90)*this.dpr, {
        color: "rgba(235,250,255,1)",
        size: this.rand(0.75, 1.2) * this.dpr,
        alpha: this.rand(0.35, 0.95),
        ttl: this.rand(1.2, 2.0),
        fade: this.rand(0.988, 0.997),
        trail: 1.25,
        glow: true,
        twinkle: true,
        wiggle: true,
        wiggleAmp: this.rand(140, 260) * this.dpr,
        wiggleFreq: this.rand(8, 13),
        dragX: 0.978,
        dragY: 0.994
      });
    }
  }

  // 天使翅膀：左右镜像、羽翼感光丝
  _angelWings(x, y, k) {
    const n = this.lowPower ? 220 : 420;

    for (let i = 0; i < n; i++) {
      const t = i / n;
      const ang = this.lerp(-0.18, 0.92, t) * Math.PI;
      const sp = this.lerp(260, 520, t) * this.dpr * k;

      const vx = Math.cos(ang) * sp;
      const vy = Math.sin(ang) * sp - this.rand(60, 140) * this.dpr;

      const color = (Math.random() < 0.55) ? "rgba(190,210,255,1)" : "rgba(255,150,205,1)";

      this._addStar(x, y, vx, vy, {
        color,
        size: this.rand(0.85, 1.35) * this.dpr,
        alpha: this.rand(0.45, 1.0),
        ttl: this.rand(1.0, 1.7),
        fade: this.rand(0.986, 0.996),
        trail: 1.15,
        glow: true,
        twinkle: true,
        dragX: 0.980,
        dragY: 0.994
      });

      this._addStar(x, y, -vx, vy, {
        color,
        size: this.rand(0.85, 1.35) * this.dpr,
        alpha: this.rand(0.45, 1.0),
        ttl: this.rand(1.0, 1.7),
        fade: this.rand(0.986, 0.996),
        trail: 1.15,
        glow: true,
        twinkle: true,
        dragX: 0.980,
        dragY: 0.994
      });
    }
  }

  // 黄金许愿树：先上喷，再下垂枝雨（更像“树”）
  _wishTree(x, y, k) {
    // 更像视频：强烈的“上冲金柱”+ 顶部冠状开花 + 下垂枝雨
    const fountainN = this.lowPower ? 380 : 720;
    const crownN    = this.lowPower ? 140 : 260;
    const rainN     = this.lowPower ? 260 : 520;
  
    // ① 上冲金柱（喷泉）
    for (let i = 0; i < fountainN; i++) {
      const spread = this.lowPower ? 0.22 : 0.28;        // 柱子的“窄”
      const a = this.rand(-Math.PI/2 - spread, -Math.PI/2 + spread);
      const sp = this.rand(520, 920) * this.dpr * k;     // 强冲力
      this._addStar(x, y, Math.cos(a)*sp*0.22, Math.sin(a)*sp*1.10, {
        color: "rgba(255,235,165,1)",
        size: this.rand(0.9, 1.6) * this.dpr,
        alpha: this.rand(0.40, 0.95),
        ttl: this.rand(1.2, 2.2),
        fade: this.rand(0.990, 0.997),
        trail: 1.25,                 // 光丝更明显
        glow: true,
        twinkle: true,
        wiggle: true,                // 轻摆动让柱子像“火花流”
        wiggleAmp: this.rand(90, 160) * this.dpr,
        wiggleFreq: this.rand(6, 10),
        dragX: 0.975,
        dragY: 0.995
      });
    }
  
    // ② 顶部冠状开花（像树顶“开伞”那一下）
    for (let i = 0; i < crownN; i++) {
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(260, 460) * this.dpr * k;
      this._addStar(x, y, Math.cos(a)*sp, Math.sin(a)*sp - this.rand(120, 220)*this.dpr, {
        color: this.gold(),
        size: this.rand(0.9, 1.5) * this.dpr,
        alpha: this.rand(0.55, 1.0),
        ttl: this.rand(0.9, 1.4),
        fade: this.rand(0.985, 0.995),
        trail: 1.05,
        glow: true,
        twinkle: true,
        dragX: 0.988,
        dragY: 0.992
      });
    }
  
    // ③ 下垂枝雨（许愿树的“枝条”）
    for (let i = 0; i < rainN; i++) {
      // 枝条要“从上向下垂”：初速度不要太向下，交给重力去拉
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(240, 420) * this.dpr * k;
  
      this._addStar(x, y, Math.cos(a)*sp*0.70, Math.sin(a)*sp*0.35 - this.rand(0, 120)*this.dpr, {
        color: this.gold(),
        size: this.rand(0.8, 1.25) * this.dpr,
        alpha: this.rand(0.35, 0.85),
        ttl: this.rand(1.8, 3.0),
        fade: this.rand(0.992, 0.998), // 更长寿，像视频的落雨
        trail: 1.35,                   // 长光丝
        glow: true,
        twinkle: true,
        wiggle: true,
        wiggleAmp: this.rand(120, 220) * this.dpr,
        wiggleFreq: this.rand(7, 12),
        dragX: 0.965,                  // 水平更快收敛：更像“直直落下”
        dragY: 0.995
      });
    }
  }

  _jellyfish(x, y, k) {
    // 更像视频：大伞盖 + 发光雾伞 + 宽幅触须帘
    const capN   = this.lowPower ? 220 : 480;   // 伞盖粒子更多
    const glowN  = this.lowPower ? 90  : 200;   // 雾伞（大颗粒低透明）
    const tentN  = this.lowPower ? 320 : 760;   // 触须更多更宽
    const coreN  = this.lowPower ? 30  : 70;
  
    // 伞盖尺寸（越大越像你说的“大伞”）
    const capR = (this.lowPower ? 120 : 160) * this.dpr * k;
  
    // ① 发光雾伞：大颗粒、低透明、短拖尾（形成“伞面发光”）
    for (let i = 0; i < glowN; i++) {
      // 在上半球、接近伞面范围内随机
      const a = this.rand(-Math.PI, 0);
      const rr = capR * this.rand(0.45, 1.05);
      const sx = x + Math.cos(a) * rr * this.rand(0.6, 1.0);
      const sy = y + Math.sin(a) * rr * this.rand(0.6, 1.0);
  
      // 雾伞基本不需要很大速度，只要“撑开”一点点
      const vx = this.rand(-90, 90) * this.dpr * k;
      const vy = this.rand(-220, -40) * this.dpr * k;
  
      this._addStar(sx, sy, vx, vy, {
        color: (Math.random() < 0.6) ? "rgba(195,210,255,1)" : "rgba(220,190,255,1)",
        size: this.rand(2.0, 4.2) * this.dpr,
        alpha: this.rand(0.06, 0.14),
        ttl: this.rand(0.9, 1.6),
        fade: this.rand(0.992, 0.998),
        trail: 0.10,                               // 雾不要长拖尾
        glow: true,
        twinkle: false,
        dragX: 0.992,
        dragY: 0.995
      });
    }
  
    // ② 伞盖骨架：更大半球扩张 + 轻微上扬（伞面变“大”）
    for (let i = 0; i < capN; i++) {
      // 上半球，但允许一点侧向“外翻”
      const a = this.rand(-Math.PI * 1.02, 0.02);
      // 越靠边速度越大，形成“伞沿”
      const edge = this.rand(0.2, 1.0);
      const sp = this.lerp(340, 720, edge) * this.dpr * k;
  
      const vx = Math.cos(a) * sp;
      const vy = Math.sin(a) * sp - this.rand(140, 260) * this.dpr * k;
  
      this._addStar(x, y, vx, vy, {
        color: "rgba(210,225,255,1)",
        size: this.rand(0.85, 1.45) * this.dpr,
        alpha: this.rand(0.40, 0.95),
        ttl: this.rand(1.3, 2.2),
        fade: this.rand(0.988, 0.996),
        trail: 0.70,
        glow: true,
        twinkle: true,
        dragX: 0.986,
        dragY: 0.992
      });
    }
  
    // ③ 触须帘：从“伞沿”生成，角度更宽（不再那么集中）
    for (let i = 0; i < tentN; i++) {
      // 触须出生点：分布在伞沿（上半球边缘）→ 看起来像“从伞盖下面垂下来”
      const edgeA = this.rand(-Math.PI, 0);
      const edgeR = capR * this.rand(0.72, 1.08);
      const sx = x + Math.cos(edgeA) * edgeR + this.rand(-8, 8) * this.dpr;
      const sy = y + Math.sin(edgeA) * edgeR + this.rand(8, 20) * this.dpr;
  
      // 触须方向：主要向下，但放宽散射范围（更“宽”的帘子）
      const down = Math.PI / 2;
      const a = this.rand(down - 0.95, down + 0.95);  // 比之前更宽 -> 不那么集中
  
      const sp = this.rand(260, 620) * this.dpr * k;
  
      // 水平不要太大，但要足够让帘子“铺开”
      const vx = Math.cos(a) * sp * 0.30;
      const vy = Math.sin(a) * sp * 0.72 - this.rand(0, 90) * this.dpr;
  
      this._addStar(sx, sy, vx, vy, {
        color: (Math.random() < 0.55) ? "rgba(245,250,255,1)" : "rgba(205,175,255,1)",
        size: this.rand(0.70, 1.15) * this.dpr,
        alpha: this.rand(0.25, 0.85),
        ttl: this.rand(2.6, 4.2),        // 更长寿 = 更长触须
        fade: this.rand(0.994, 0.999),
        trail: this.busy ? 1.10 : 1.45,                // 触须拖尾更长
        glow: true,
        twinkle: true,
        wiggle: true,
        wiggleAmp: this.rand(140, 260) * this.dpr,
        wiggleFreq: this.rand(7, 12),
        dragX: 0.970,                     // 水平衰减不要太狠，保持“帘子宽度”
        dragY: 0.996
      });
    }
  
    // ④ 中心亮核：增强“伞心”那种亮点
    for (let i = 0; i < coreN; i++) {
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(180, 340) * this.dpr * k;
      this._addStar(x, y, Math.cos(a)*sp*0.65, Math.sin(a)*sp*0.55 - this.rand(80, 180)*this.dpr, {
        color: "rgba(255,210,240,1)",
        size: this.rand(1.2, 2.4) * this.dpr,
        alpha: this.rand(0.35, 0.95),
        ttl: this.rand(1.0, 1.6),
        fade: this.rand(0.985, 0.995),
        trail: 1.05,
        glow: true,
        twinkle: true,
        dragX: 0.988,
        dragY: 0.992
      });
    }
  }




  // 此生不换：彩色烟染 + 白闪星点（更像你视频前面那种“彩烟感”）
  _rainbowSmoke(x, y, k) {
    const cloudN = this.lowPower ? 220 : 420;
    const sparkN = this.lowPower ? 80 : 140;

    for (let i = 0; i < cloudN; i++) {
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(160, 360) * this.dpr * k;
      this._addStar(x, y, Math.cos(a)*sp, Math.sin(a)*sp - this.rand(40, 120)*this.dpr, {
        color: this.rainbow(),
        size: this.rand(1.6, 3.2) * this.dpr,
        alpha: this.rand(0.18, 0.55),
        ttl: this.rand(1.0, 1.8),
        fade: this.rand(0.992, 0.998),
        trail: 0.20,
        glow: true,
        twinkle: false,
        dragX: 0.992,
        dragY: 0.992
      });
    }

    for (let i = 0; i < sparkN; i++) {
      const a = this.rand(0, Math.PI * 2);
      const sp = this.rand(260, 520) * this.dpr * k;
      this._addStar(x, y, Math.cos(a)*sp, Math.sin(a)*sp - this.rand(60, 160)*this.dpr, {
        color: "rgba(255,255,255,1)",
        size: this.rand(0.75, 1.2) * this.dpr,
        alpha: this.rand(0.35, 1.0),
        ttl: this.rand(0.7, 1.2),
        fade: this.rand(0.985, 0.995),
        trail: 1.0,
        glow: true,
        twinkle: true,
        dragX: 0.985,
        dragY: 0.990
      });
    }
  }

  // 蓝色群爆：多簇爆闪
  _blueCluster(x, y, k) {
    const clusters = this.lowPower ? 4 : 7;
    for (let c = 0; c < clusters; c++) {
      const cx = x + this.rand(-70, 70) * this.dpr;
      const cy = y + this.rand(-55, 55) * this.dpr;

      const n = this.lowPower ? 160 : 280;
      for (let i = 0; i < n; i++) {
        const a = this.rand(0, Math.PI * 2);
        const sp = this.rand(260, 520) * this.dpr * k;
        this._addStar(cx, cy, Math.cos(a)*sp, Math.sin(a)*sp - this.rand(40, 120)*this.dpr, {
          color: this.blue(),
          size: this.rand(0.85, 1.45) * this.dpr,
          alpha: this.rand(0.45, 1.0),
          ttl: this.rand(0.9, 1.5),
          fade: this.rand(0.985, 0.995),
          trail: 1.05,
          glow: true,
          twinkle: true,
          dragX: 0.985,
          dragY: 0.992
        });
      }

      // 白闪点
      const spark = this.lowPower ? 40 : 70;
      for (let i = 0; i < spark; i++) {
        const a = this.rand(0, Math.PI * 2);
        const sp = this.rand(240, 460) * this.dpr * k;
        this._addStar(cx, cy, Math.cos(a)*sp, Math.sin(a)*sp - this.rand(60, 140)*this.dpr, {
          color: "rgba(255,255,255,1)",
          size: this.rand(0.7, 1.2) * this.dpr,
          alpha: this.rand(0.35, 1.0),
          ttl: this.rand(0.6, 1.0),
          fade: this.rand(0.980, 0.992),
          trail: 1.15,
          glow: true,
          twinkle: true,
          dragX: 0.985,
          dragY: 0.990
        });
      }
    }
  }

  // ---------- particle primitive ----------
  _addStar(x, y, vx, vy, opt) {
    this.particles.push({
      x, y, px: x, py: y,
      vx, vy,
      color: opt.color,
      size: opt.size,
      alpha: opt.alpha ?? 1,
      ttl: opt.ttl ?? 1.2,
      age: 0,
      fade: opt.fade ?? 0.99,
      trail: opt.trail ?? 1.0,
      glow: (!this.busy) && !!opt.glow,
      twinkle: (!this.busy) && !!opt.twinkle,
      dragX: opt.dragX ?? 1.0,
      dragY: opt.dragY ?? 1.0,
      wiggle: (!this.busy) && !!opt.wiggle,
      wiggleAmp: opt.wiggleAmp ?? 0,
      wiggleFreq: opt.wiggleFreq ?? 0,
      wiggleSeed: this.rand(0, 10),
    });
  }

  // ---------- colors ----------
  gold() {
    const r = Math.floor(this.rand(235, 255));
    const g = Math.floor(this.rand(175, 225));
    const b = Math.floor(this.rand(70, 130));
    return `rgba(${r},${g},${b},1)`;
  }
  blue() {
    const r = Math.floor(this.rand(95, 140));
    const g = Math.floor(this.rand(150, 210));
    const b = Math.floor(this.rand(225, 255));
    return `rgba(${r},${g},${b},1)`;
  }
  rainbow() {
    const p = [
      "rgba(255,105,105,1)",
      "rgba(255,175,90,1)",
      "rgba(255,235,120,1)",
      "rgba(120,255,175,1)",
      "rgba(90,180,255,1)",
      "rgba(190,120,255,1)",
    ];
    return p[(Math.random() * p.length) | 0];
  }

  // ---------- show random type ----------
  randomShowType() {
    const types = [
      'wishTree','jellyfish','goldWillow','blueCore','angelWings','rainbowSmoke','blueCluster'
    ];
    // Avoid repeating the same type too often
    let t = types[(Math.random() * types.length) | 0];
    if (this._lastShowType && t === this._lastShowType && Math.random() < 0.75) {
      t = types[(Math.random() * types.length) | 0];
    }
    this._lastShowType = t;
    return t;
  }

  // ---------- utils ----------
  rand(a, b) { return a + Math.random() * (b - a); }
  lerp(a, b, t) { return a + (b - a) * t; }
}
