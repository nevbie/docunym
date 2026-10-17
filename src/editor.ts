// Review screen: shows the picture with the found data, lets the user toggle hits, draw extra areas,
// zoom, switch between black bars and dummy text, and export the result as a new picture.
import {
  anonymousFileName, CATEGORY_OF, Dummies, findPersonalData, manualFinding,
  type Box, type Category, type Finding, type OcrLine,
} from './core/detect';
import { ColorSampler, drawRedactions, type Mode } from './render';

export const CATEGORY_LABEL: Record<Category, string> = { name: 'Namen', address: 'Adressen', number: 'Zahlen', contact: 'Kontakt' };
export const CATEGORY_COLOR: Record<Category, string> = { name: '#f2a541', address: '#4aa3df', number: '#b48cf2', contact: '#5cc98a' };

const MAX_EXPORT = 4000;

interface Snapshot { findings: Finding[]; manual: Box[] }

export class Editor {
  readonly lines: OcrLine[];
  findings: Finding[];
  manual: Box[] = [];
  mode: Mode = 'black';
  preview = false;
  onChange: () => void = () => {};

  private dummies = new Dummies();
  private colors: ColorSampler;
  private history: Snapshot[] = [];
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { kind: 'tap' | 'draw' | 'pan' | 'pinch'; sx: number; sy: number; start: { x: number; y: number }; dist?: number; cur?: { x: number; y: number } } | null = null;
  private raf = 0;
  private resizeObserver: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, readonly source: HTMLCanvasElement, lines: OcrLine[]) {
    this.lines = lines;
    this.findings = findPersonalData(lines, this.dummies);
    this.colors = new ColorSampler(source);
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => { this.resize(); this.fit(); });
    this.resizeObserver.observe(canvas.parentElement!);
    this.resize();
    this.fit();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.raf);
  }

  // ---- state -------------------------------------------------------------

  private remember() {
    this.history.push({ findings: this.findings.map((f) => ({ ...f })), manual: this.manual.map((b) => ({ ...b })) });
    if (this.history.length > 100) this.history.shift();
  }
  canUndo(): boolean { return this.history.length > 0; }
  undo(): void {
    const s = this.history.pop();
    if (!s) return;
    this.findings = s.findings;
    this.manual = s.manual;
    this.changed();
  }
  private changed() { this.onChange(); this.draw(); }

  counts(): Record<Category, { total: number; active: number }> {
    const c = { name: { total: 0, active: 0 }, address: { total: 0, active: 0 }, number: { total: 0, active: 0 }, contact: { total: 0, active: 0 } };
    for (const f of this.findings) { const k = c[CATEGORY_OF[f.kind]]; k.total++; if (f.active) k.active++; }
    return c;
  }
  toggleCategory(cat: Category): void {
    const list = this.findings.filter((f) => CATEGORY_OF[f.kind] === cat);
    if (!list.length) return;
    this.remember();
    const on = !list.some((f) => f.active);
    for (const f of list) f.active = on;
    this.changed();
  }
  /** Marks all recognised text (e.g. for a chat screenshot). */
  markAllText(): void {
    this.remember();
    const have = new Set(this.findings.map((f) => `${f.line}:${f.word}`));
    for (const f of this.findings) f.active = true;
    this.lines.forEach((l, li) => l.words.forEach((_, wi) => {
      if (!have.has(`${li}:${wi}`)) this.findings.push(manualFinding(this.lines, li, wi, this.dummies));
    }));
    this.changed();
  }
  setMode(m: Mode): void { this.mode = m; this.changed(); }
  setPreview(p: boolean): void { this.preview = p; this.draw(); }

  // ---- view --------------------------------------------------------------

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }
  fit(): void {
    const { width: cw, height: ch } = this.canvas;
    this.scale = Math.min(cw / this.source.width, ch / this.source.height) * 0.97;
    this.tx = (cw - this.source.width * this.scale) / 2;
    this.ty = (ch - this.source.height * this.scale) / 2;
    this.draw();
  }
  zoom(factor: number, cx = this.canvas.width / 2, cy = this.canvas.height / 2): void {
    const min = Math.min(this.canvas.width / this.source.width, this.canvas.height / this.source.height) * 0.5;
    const s = Math.min(8, Math.max(min, this.scale * factor));
    this.tx = cx - (cx - this.tx) * (s / this.scale);
    this.ty = cy - (cy - this.ty) * (s / this.scale);
    this.scale = s;
    this.draw();
  }

  draw(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.paint());
  }

  private paint() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.tx, this.ty);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.source, 0, 0);
    const px = 1 / this.scale;
    if (this.preview) {
      drawRedactions(ctx, this.findings, this.manual, this.mode, this.colors);
    } else {
      for (const f of this.findings) {
        const col = CATEGORY_COLOR[CATEGORY_OF[f.kind]];
        const b = f.bbox;
        if (f.active) {
          ctx.globalAlpha = 0.38;
          ctx.fillStyle = col;
          ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        } else {
          ctx.setLineDash([4 * px, 3 * px]);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
      ctx.setLineDash([]);
      for (const b of this.manual) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#000';
        ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#e5484d';
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
    }
    const g = this.gesture;
    if (g?.kind === 'draw' && g.cur) {
      const b = this.rect(g.start, g.cur);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
  }

  // ---- input -------------------------------------------------------------

  private toImage(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / r.width;
    const sx = (e.clientX - r.left) * dpr, sy = (e.clientY - r.top) * dpr;
    return { sx, sy, x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale };
  }
  private rect(a: { x: number; y: number }, b: { x: number; y: number }): Box {
    const c = (v: number, max: number) => Math.min(max, Math.max(0, v));
    return {
      x0: c(Math.min(a.x, b.x), this.source.width), y0: c(Math.min(a.y, b.y), this.source.height),
      x1: c(Math.max(a.x, b.x), this.source.width), y1: c(Math.max(a.y, b.y), this.source.height),
    };
  }
  private pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private down = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toImage(e);
    this.pointers.set(e.pointerId, { x: p.sx, y: p.sy });
    if (this.pointers.size === 2) {
      const i = this.pinchInfo();
      this.gesture = { kind: 'pinch', sx: i.cx, sy: i.cy, start: p, dist: i.dist };
      this.draw();
    } else if (this.pointers.size === 1) {
      // Mouse with right/middle button or a pen with button pans; everything else taps or draws.
      this.gesture = { kind: e.button === 1 || e.button === 2 ? 'pan' : 'tap', sx: p.sx, sy: p.sy, start: { x: p.x, y: p.y } };
    }
  };

  private move = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.toImage(e);
    const last = this.pointers.get(e.pointerId)!;
    this.pointers.set(e.pointerId, { x: p.sx, y: p.sy });
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch' && this.pointers.size === 2) {
      const i = this.pinchInfo();
      this.tx += i.cx - g.sx;
      this.ty += i.cy - g.sy;
      g.sx = i.cx; g.sy = i.cy;
      if (g.dist) this.zoom(i.dist / g.dist, i.cx, i.cy);
      g.dist = i.dist;
      this.draw();
    } else if (g.kind === 'pan') {
      this.tx += p.sx - last.x;
      this.ty += p.sy - last.y;
      this.draw();
    } else if (g.kind === 'tap' && Math.hypot(p.sx - g.sx, p.sy - g.sy) > 12) {
      g.kind = 'draw';
    }
    if (g.kind === 'draw') { g.cur = { x: p.x, y: p.y }; this.draw(); }
  };

  private up = (e: PointerEvent) => {
    const p = this.toImage(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      // Keep panning with the remaining finger, never draw after a pinch.
      if (this.pointers.size === 1) { const [r] = [...this.pointers.values()]; this.gesture = { kind: 'pan', sx: r.x, sy: r.y, start: g.start }; }
      else this.gesture = null;
      return;
    }
    this.gesture = null;
    if (g.kind === 'tap') this.tap(p.x, p.y);
    else if (g.kind === 'draw') {
      const b = this.rect(g.start, { x: p.x, y: p.y });
      if (b.x1 - b.x0 > 3 && b.y1 - b.y0 > 3) { this.remember(); this.manual.push(b); this.changed(); }
      else this.draw();
    }
  };

  private cancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.gesture = null;
    this.draw();
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.toImage(e);
    this.zoom(Math.exp(-e.deltaY * 0.0015), p.sx, p.sy);
  };

  private tap(x: number, y: number) {
    const inside = (b: Box, slack: number) => x >= b.x0 - slack && x <= b.x1 + slack && y >= b.y0 - slack && y <= b.y1 + slack;
    const slack = 6 / this.scale;
    for (let i = this.manual.length - 1; i >= 0; i--) {
      if (inside(this.manual[i], 0)) { this.remember(); this.manual.splice(i, 1); this.changed(); return; }
    }
    const f = this.findings.find((t) => inside(t.bbox, slack));
    if (f) { this.remember(); f.active = !f.active; this.changed(); return; }
    for (let li = 0; li < this.lines.length; li++) {
      const wi = this.lines[li].words.findIndex((w) => inside(w.bbox, slack));
      if (wi >= 0) { this.remember(); this.findings.push(manualFinding(this.lines, li, wi, this.dummies)); this.changed(); return; }
    }
  }

  // ---- export ------------------------------------------------------------

  /**
   * Renders the anonymised picture into a fresh canvas and encodes it as JPEG.
   * Canvas encoding writes no EXIF data (no GPS, date, camera model) – the file has no link to the original.
   */
  async export(): Promise<{ blob: Blob; name: string }> {
    const s = Math.min(1, MAX_EXPORT / Math.max(this.source.width, this.source.height));
    const out = document.createElement('canvas');
    out.width = Math.round(this.source.width * s);
    out.height = Math.round(this.source.height * s);
    const ctx = out.getContext('2d')!;
    ctx.scale(s, s);
    ctx.drawImage(this.source, 0, 0);
    drawRedactions(ctx, this.findings, this.manual, this.mode, this.colors);
    const blob = await new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', 0.9));
    out.width = out.height = 0;
    return { blob, name: anonymousFileName() };
  }
}
