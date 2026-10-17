// Shared namespace and small helpers. Every script in js/ attaches to window.BV.
var BV = window.BV = {};

BV.TILE = 32;
BV.VIEW_W = 640;
BV.VIEW_H = 360;
BV.GRAVITY = 2000;
BV.MAX_FALL = 900;

BV.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
BV.lerp = (a, b, t) => a + (b - a) * t;
BV.rand = (lo, hi) => lo + Math.random() * (hi - lo);
BV.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
BV.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
BV.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
BV.overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// Deterministic PRNG so the painted backdrop looks the same every run.
BV.seeded = function (seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
