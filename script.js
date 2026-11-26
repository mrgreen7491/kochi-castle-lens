(() => {
  'use strict';

  // ---- 出題リスト（画像を増やすときはここに1行足す） ----
  // file = assets_square フォルダー内のファイル名 / answer = 正解画面に出す日本語
  const IMAGE_DIR = 'assets_square/';
  const ITEMS = [
    { file: 'boshipan.png',        answer: 'ぼうしパン！' },
    { file: 'harimayabashi.png',   answer: 'はりまや橋！' },
    { file: 'katsuonotataki.png',  answer: 'カツオのたたき！' },
    { file: 'kochi-castle.png',    answer: '高知城！' },
    { file: 'kujira.png',          answer: '高知沖のくじら！' },
    { file: 'naruko.png',          answer: '鳴子！' },
    { file: 'sakamotoryoma.png',   answer: '坂本龍馬！' },
    { file: 'sawachuryori.png',    answer: '皿鉢料理！' },
    { file: 'tosaden.png',         answer: 'とさ電！' },
    { file: 'yosakoimatsuri.png',  answer: 'よさこい祭り！' }
  ].map((it) => ({ src: IMAGE_DIR + it.file, answer: it.answer }));

  // ---- 設定 ----
  const CONFIG = {
    duration: 60,            // 制限時間（秒）
    zoom: 2,                 // 拡大率
    // レンズ半径（表示している画像の高さに対する比）。経過時間の3段階
    stages: [
      { until: 20, radius: 0.12 },   // 0〜20秒：小さい
      { until: 40, radius: 0.19 },   // 20〜40秒：中くらい
      { until: 50, radius: 0.28 },   // 40〜50秒：大きい
      { until: 60, radius: 0.38 }    // 50〜60秒：さらに大きい（50秒で滑らかに拡大）
    ],
    growSeconds: 3,          // 段階の切り替わりにかけて大きくなる時間（秒）
    speedRatio: 0.12,        // レンズの速さ（画像の高さ/秒）
    bg: '#24323f'            // 背景色（style.cssの--bgと同じ）
  };

  // ---- ストップが早かったときの声かけ（上から順に判定。時間切れのときは出さない） ----
  const PRAISE = [
    { within: 20, text: 'もうわかったんですか？　すごい！',             sound: 'audio/20seconds.wav' },   // スタート〜20秒
    { within: 40, text: '良くわかりましたね。次もがんばりましょう！',     sound: 'audio/40seconds.wav' }    // 21〜40秒
  ];

  const $ = (id) => document.getElementById(id);
  const topMsgEl = $('top-message');
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const countdownEl = $('countdown');
  const answerEl = $('answer');
  const errorEl = $('error');
  const btnStart = $('btn-start');
  const btnStop = $('btn-stop');
  const btnReveal = $('btn-reveal');
  const btnRetry = $('btn-retry');

  // 画像を先に読み込んでおく（DOMには挿入しないので、ゲーム終了まで画面に出ない）
  const failedSrc = [];
  const failedAudio = [];
  function showErrors() {            // スタッフ向けの読み込みエラー表示（待機画面のみ表示）
    const parts = [];
    if (failedSrc.length) parts.push('がぞうが よみこめません（' + failedSrc.join('、') + '）');
    if (failedAudio.length) parts.push('おとが よみこめません（' + failedAudio.join('、') + '）');
    errorEl.textContent = parts.join('　');
  }

  const loaded = ITEMS.map((item) => {
    const img = new Image();
    const entry = { ...item, img, ready: false };
    img.onload = () => { entry.ready = true; onImageLoaded(); };
    img.onerror = () => { failedSrc.push(item.src); showErrors(); };
    img.src = item.src;
    return entry;
  });

  // 音声は先に読み込んでおく。読み込めなくてもゲームは続けられる（音が鳴らないだけ）
  PRAISE.forEach((p) => {
    p.audio = new Audio(p.sound);
    p.audio.preload = 'auto';
    p.audio.addEventListener('error', () => { failedAudio.push(p.sound); showErrors(); });
  });
  // 最後まで分からなかった（時間切れ）ときに、正解画面で鳴らす音声
  const NEXT_SOUND = 'audio/next.wav';
  const nextAudio = new Audio(NEXT_SOUND);
  nextAudio.preload = 'auto';
  nextAudio.addEventListener('error', () => { failedAudio.push(NEXT_SOUND); showErrors(); });

  function stopSounds() {
    PRAISE.map((p) => p.audio).concat(nextAudio).forEach((a) => {
      try { a.pause(); a.currentTime = 0; } catch (e) { /* 何もしない */ }
    });
  }

  // ---- 出題順：10枚を一巡するまで同じ画像を出さない（シャッフルした袋から1枚ずつ取り出す） ----
  let bag = [];
  let lastIndex = -1;
  function nextItem() {
    if (!bag.length) {
      bag = loaded.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {          // Fisher–Yates
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // 一巡の切れ目で、直前に出した画像が連続しないようにする
      if (bag.length > 1 && bag[bag.length - 1] === lastIndex) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
    }
    lastIndex = bag.pop();
    return loaded[lastIndex];
  }

  let current = null;        // 今回の出題
  let phase = 'ready';       // 'ready' | 'playing' | 'stopped' | 'answer'
  let W = 0, H = 0;
  let rect = { x: 0, y: 0, w: 0, h: 0 };   // 画像の表示領域（レンズの移動範囲）
  let R = 0;                                // 現在のレンズ半径(px)
  const lens = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  let startTime = 0;
  let elapsed = 0;           // 経過秒（停止すると固定）
  let timedOut = false;      // 時間切れで自動停止したか
  let lastFrame = 0;

  // ---------- 計算 ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

  // 経過秒 → レンズ半径比（段階の切り替わりは滑らかに拡大）
  function radiusRatioAt(t) {
    const s = CONFIG.stages;
    let ratio = s[0].radius;
    for (let i = 1; i < s.length; i++) {
      const boundary = s[i - 1].until;
      ratio += (s[i].radius - s[i - 1].radius) * smooth((t - boundary) / CONFIG.growSeconds);
    }
    return ratio;
  }

  function bounds() {
    const m = 1;
    return {
      minX: rect.x + R + m, maxX: rect.x + rect.w - R - m,
      minY: rect.y + R + m, maxY: rect.y + rect.h - R - m
    };
  }
  function clampTo(o, kx, ky) {
    const b = bounds();
    o[kx] = Math.min(Math.max(o[kx], b.minX), b.maxX);
    o[ky] = Math.min(Math.max(o[ky], b.minY), b.maxY);
  }

  // ---------- レイアウト ----------
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!current) return;
    const img = current.img;
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight) * 0.98;
    rect.w = img.naturalWidth * s;
    rect.h = img.naturalHeight * s;
    rect.x = (W - rect.w) / 2;
    rect.y = (H - rect.h) / 2;
    R = radiusRatioAt(elapsed) * rect.h;
    clampTo(lens, 'x', 'y');
    clampTo(lens, 'tx', 'ty');
  }

  // ---------- レンズの動き ----------
  function pickTarget() {
    const b = bounds();
    for (let i = 0; i < 30; i++) {
      const tx = rand(b.minX, b.maxX);
      const ty = rand(b.minY, b.maxY);
      if (Math.hypot(tx - lens.x, ty - lens.y) > rect.h * 0.25) { lens.tx = tx; lens.ty = ty; return; }
    }
    lens.tx = rand(b.minX, b.maxX);
    lens.ty = rand(b.minY, b.maxY);
  }

  function resetLens() {
    // 開始位置は画像内からランダム
    const b = bounds();
    lens.x = rand(b.minX, b.maxX);
    lens.y = rand(b.minY, b.maxY);
    lens.vx = 0; lens.vy = 0;
    pickTarget();
  }

  function updateLens(dt) {
    const speed = CONFIG.speedRatio * rect.h;
    let dx = lens.tx - lens.x, dy = lens.ty - lens.y;
    let dist = Math.hypot(dx, dy);
    if (dist < rect.h * 0.06) { pickTarget(); dx = lens.tx - lens.x; dy = lens.ty - lens.y; dist = Math.hypot(dx, dy); }
    const dvx = dist > 0 ? (dx / dist) * speed : 0;
    const dvy = dist > 0 ? (dy / dist) * speed : 0;
    const k = Math.min(1, dt * 1.2);          // ゆるやかに加減速（急な方向転換を避ける）
    lens.vx += (dvx - lens.vx) * k;
    lens.vy += (dvy - lens.vy) * k;
    lens.x += lens.vx * dt;
    lens.y += lens.vy * dt;
    clampTo(lens, 'x', 'y');
    clampTo(lens, 'tx', 'ty');
  }

  // ---------- 描画 ----------
  function draw() {
    ctx.fillStyle = CONFIG.bg;
    ctx.fillRect(0, 0, W, H);
    if (!current || phase === 'ready') return;

    const img = current.img;
    if (phase === 'answer') {
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);   // 全景
      return;
    }

    // playing / stopped：円の中だけ描く（停止中は最後の位置のまま）
    const k = rect.w / img.naturalWidth;
    const srcR = R / (k * CONFIG.zoom);
    const cx = (lens.x - rect.x) / k;
    const cy = (lens.y - rect.y) / k;

    ctx.save();
    ctx.beginPath();
    ctx.arc(lens.x, lens.y, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, cx - srcR, cy - srcR, srcR * 2, srcR * 2,
                  lens.x - R, lens.y - R, R * 2, R * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(lens.x, lens.y, R, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(4, R * 0.04);
    ctx.strokeStyle = '#f2b632';
    ctx.stroke();
  }

  function showCountdown() {
    countdownEl.textContent = Math.max(0, Math.ceil(CONFIG.duration - elapsed));
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (phase === 'playing') {
      elapsed = Math.min(CONFIG.duration, (performance.now() - startTime) / 1000);
      R = radiusRatioAt(elapsed) * rect.h;
      updateLens(dt);
      showCountdown();
      if (elapsed >= CONFIG.duration) { timedOut = true; stopGame(); }   // 時間切れ：自動停止
    }
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- 状態遷移 ----------
  function setPhase(p) {
    phase = p;
    document.body.dataset.phase = p;
  }

  function startGame() {
    if (phase !== 'ready') return;
    if (!loaded.every((e) => e.ready)) return;   // 10枚そろっているときだけ開始
    current = nextItem();
    elapsed = 0;
    timedOut = false;
    layout();
    R = radiusRatioAt(0) * rect.h;
    resetLens();
    startTime = performance.now();
    showCountdown();
    setPhase('playing');
  }

  function stopGame() {            // ストップ／時間切れ：レンズとタイマーを止める
    if (phase !== 'playing') return;
    setPhase('stopped');
    showCountdown();
  }

  // スタッフがストップを押したとき：早さに応じて声かけと音声を出す
  function stopByStaff() {
    if (phase !== 'playing') return;
    const sec = Math.min(CONFIG.duration, (performance.now() - startTime) / 1000);
    elapsed = sec;
    stopGame();
    const hit = PRAISE.find((p) => sec <= p.within);
    if (!hit) return;
    topMsgEl.textContent = hit.text;
    try {
      hit.audio.currentTime = 0;
      const pr = hit.audio.play();
      if (pr && pr.catch) pr.catch(() => { /* 再生できなくてもゲームは続ける */ });
    } catch (e) { /* 何もしない */ }
  }

  function revealAnswer() {
    if (phase !== 'stopped') return;
    setPhase('answer');
    answerEl.textContent = current.answer;   // この時点で初めて正解を表示
    topMsgEl.textContent = '正解は';          // 正解画面の上部（ストップ時の声かけは、ここで置き換わる）
    if (timedOut) {                          // 最後まで分からなかった場合：next.wav
      try {
        nextAudio.currentTime = 0;
        const pr = nextAudio.play();
        if (pr && pr.catch) pr.catch(() => { /* 再生できなくてもゲームは続ける */ });
      } catch (e) { /* 何もしない */ }
    }
  }

  function retry() {
    if (phase !== 'answer') return;
    answerEl.textContent = '';
    topMsgEl.textContent = '';
    stopSounds();
    setPhase('ready');
  }

  // ---------- イベント ----------
  btnStart.addEventListener('click', startGame);
  btnStop.addEventListener('click', stopByStaff);
  btnReveal.addEventListener('click', revealAnswer);
  btnRetry.addEventListener('click', retry);
  window.addEventListener('resize', layout);

  function onImageLoaded() {
    if (loaded.every((e) => e.ready)) btnStart.disabled = false;   // 10枚すべて読み込めたら有効
  }

  layout();
  setPhase('ready');
  requestAnimationFrame(frame);

  // 動作確認用（状態を読むだけ。画面には出ない）
  window.__lensDebug = () => ({
    phase, elapsed, R, ratio: R / (rect.h || 1), item: current ? current.src : null,
    lens: { x: lens.x, y: lens.y }, rect: { ...rect }
  });
})();
