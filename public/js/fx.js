// Sound, motion and speech-out helpers shared by the dialogue player and 문장만들기.
// Everything is synthesized (Web Audio / canvas / speechSynthesis) — no asset files.

let actx = null;
// Create/resume the AudioContext on a user gesture (mic tap etc.) so iOS lets it play later.
export function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) {} }

// Success chime: short rising two-note sine tone (G5 → D6).
export function chime() {
  if (!actx) return;
  try {
    const t0 = actx.currentTime + 0.01;
    [[784, 0], [1175, 0.11]].forEach(([f, dt]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(0.25, t0 + dt + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.32);
      o.connect(g).connect(actx.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.35);
    });
  } catch (e) {}
}
// Soft "bonk" for a wrong word-block answer.
export function thud() {
  if (!actx) return;
  try {
    const t0 = actx.currentTime + 0.01, o = actx.createOscillator(), g = actx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(330, t0); o.frequency.exponentialRampToValueAtTime(196, t0 + 0.18);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
    o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.3);
  } catch (e) {}
}
// Light tap tick for placing a block.
export function tick() {
  if (!actx) return;
  try {
    const t0 = actx.currentTime + 0.005, o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine"; o.frequency.value = 1320;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.07, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.07);
  } catch (e) {}
}
// "빰빠밤~": rising arpeggio into a held major chord.
export function fanfare() {
  unlockAudio(); if (!actx) return;
  try {
    const t0 = actx.currentTime + 0.05;
    [[392, 0, 0.13], [523, 0.15, 0.13], [659, 0.3, 0.13], [784, 0.45, 0.9], [523, 0.45, 0.9], [659, 0.45, 0.9]].forEach(([f, dt, len]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(0.18, t0 + dt + 0.02); g.gain.setValueAtTime(0.18, t0 + dt + len * 0.6);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + len);
      o.connect(g).connect(actx.destination); o.start(t0 + dt); o.stop(t0 + dt + len + 0.05);
    });
  } catch (e) {}
}
export function haptic(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

// Canvas confetti, ~5 s. One animation per canvas.
const rafs = new WeakMap();
export function startConfetti(cv) {
  const ctx = cv.getContext("2d"), dpr = window.devicePixelRatio || 1;
  const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
  const colors = ["#58CC02", "#1CB0F6", "#FF9600", "#FF4B4B", "#CE82FF", "#FFC800"];
  const ps = Array.from({ length: 170 }, () => ({
    x: Math.random() * W, y: -Math.random() * H * 0.8, w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr,
    vy: (2 + Math.random() * 3) * dpr, vx: (Math.random() - 0.5) * 2 * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.25,
    c: colors[Math.floor(Math.random() * colors.length)], sway: Math.random() * 6,
  }));
  const start = performance.now();
  cancelAnimationFrame(rafs.get(cv));
  const frame = now => {
    const el = (now - start) / 1000; ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = el > 4 ? Math.max(0, 1 - (el - 4) / 1.5) : 1;
    ps.forEach(p => {
      p.y += p.vy; p.x += p.vx + Math.sin(el * 3 + p.sway) * 0.6 * dpr; p.r += p.vr;
      if (p.y > H && el < 3) { p.y = -20 * dpr; p.x = Math.random() * W; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(el * 4 + p.sway))); ctx.restore();
    });
    if (el < 5.5) rafs.set(cv, requestAnimationFrame(frame)); else ctx.clearRect(0, 0, W, H);
  };
  rafs.set(cv, requestAnimationFrame(frame));
}
export function stopConfetti(cv) { cancelAnimationFrame(rafs.get(cv)); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); }

// Text to speech (en-US, a natural voice when there is one).
export function say(text, rate = 0.95) {
  try {
    if (!("speechSynthesis" in window)) return; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = rate;
    const vs = speechSynthesis.getVoices();
    const v = vs.find(v => /en[-_]US/i.test(v.lang) && /Google|Samantha|Aria|Jenny|Natural/i.test(v.name)) || vs.find(v => /en[-_]US/i.test(v.lang));
    if (v) u.voice = v; speechSynthesis.speak(u);
  } catch (e) {}
}
export function hush() { try { speechSynthesis.cancel(); } catch (e) {} }
try { speechSynthesis.getVoices(); } catch (e) {}
