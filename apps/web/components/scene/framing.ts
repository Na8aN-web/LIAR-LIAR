import { PerspectiveCamera, Vector3 } from 'three';

// Desktop framing: keep the whole circle in the part of the screen the panels don't cover.

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Panels that sit over the scene. Tall ones (lobby, chat, side panel) cover a side; short ones
 * (top bar) cover the top. The bottom action panel changes height as you pick a suspect, so it
 * isn't measured: a fixed allowance keeps the camera from jumping mid-round.
 */
const OVERLAYS = ['.lobby-main', '.lobby-chat', '.side-panel', '.topbar'];
const BOTTOM_ALLOWANCE = 150;
/** Insets snap to this many pixels, so small layout shifts never move the camera. */
const SNAP = 24;

export function measureInsets(w: number, h: number): Insets {
  const out: Insets = { left: 0, right: 0, top: 0, bottom: BOTTOM_ALLOWANCE };
  for (const sel of OVERLAYS) {
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.right <= 0 || r.left >= w) return;
      if (r.height > h * 0.5) {
        // A side panel: whichever edge it is nearer.
        if (r.left + r.width / 2 < w / 2) out.left = Math.max(out.left, r.right);
        else out.right = Math.max(out.right, w - r.left);
      } else if (r.top + r.height / 2 < h / 2) {
        out.top = Math.max(out.top, r.bottom);
      }
    });
  }
  const snap = (v: number) => Math.ceil(v / SNAP) * SNAP;
  return { left: snap(out.left), right: snap(out.right), top: snap(out.top), bottom: out.bottom };
}

export interface Framing {
  position: Vector3;
  /** View offset (pixels) that centres the picture in the uncovered area. */
  offsetX: number;
  offsetY: number;
}

/**
 * Lowest camera (from `minElevation`, rising in steps) and nearest distance at which every
 * seat, label included, projects inside the uncovered area with a margin. If a low camera
 * would have to back into the ring of buildings, it rises instead.
 */
export function fitCircle(opts: {
  radius: number;
  /** Height of the name labels above the ground. */
  labelTop: number;
  target: Vector3;
  width: number;
  height: number;
  fov: number;
  insets: Insets;
  /** Farthest the camera may be from the centre, horizontally. */
  maxHorizontal: number;
  minElevation: number;
}): Framing {
  const { radius, labelTop, target, width: w, height: h, fov, insets, maxHorizontal } = opts;
  const visW = Math.max(200, w - insets.left - insets.right);
  const visH = Math.max(200, h - insets.top - insets.bottom);
  // Half-extents of the uncovered area, as fractions of the full NDC range.
  const sx = (visW / w) * 0.92;
  const sy = (visH / h) * 0.9;
  const cam = new PerspectiveCamera(fov, w / h, 0.1, 200);
  const pts: Vector3[] = [];
  // Seats (with knees and seats a little outside the circle) and label tops.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const [r, y] of [
      [radius + 0.9, 0],
      [radius, labelTop],
    ]) {
      pts.push(new Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
    }
  }
  const v = new Vector3();
  const fits = (pos: Vector3) => {
    cam.position.copy(pos);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    for (const p of pts) {
      v.copy(p).project(cam);
      if (v.z > 1 || Math.abs(v.x) > sx || Math.abs(v.y) > sy) return false;
    }
    return true;
  };
  const at = (elev: number, d: number) => new Vector3(0, target.y + Math.sin(elev) * d, Math.cos(elev) * d);
  let best: Vector3 | null = null;
  for (let e = opts.minElevation; e <= 1.0; e += 0.04) {
    let lo = 4;
    let hi = 60;
    if (!fits(at(e, hi))) continue;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (fits(at(e, mid))) hi = mid;
      else lo = mid;
    }
    best = at(e, hi);
    if (Math.cos(e) * hi <= maxHorizontal) break;
  }
  best ??= at(0.6, 22);
  return {
    position: best,
    offsetX: -((insets.left + (w - insets.right)) / 2 - w / 2),
    offsetY: -((insets.top + (h - insets.bottom)) / 2 - h / 2),
  };
}
