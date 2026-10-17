// Draws the redactions (black bars or dummy text) onto a canvas in image coordinates.
import { estimateColors, type Box, type Finding, type RGB } from './core/detect';

export type Mode = 'black' | 'replace';

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
const pad = (b: Box, f: number, min: number): Box => {
  const p = Math.max(min, (b.y1 - b.y0) * f);
  return { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p };
};
const fill = (ctx: CanvasRenderingContext2D, b: Box) => ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);

/** Paper and ink colours of the original picture around a box (cached per box). */
export class ColorSampler {
  private data: ImageData | null = null;
  private cache = new Map<string, { bg: RGB; fg: RGB }>();
  constructor(private source: HTMLCanvasElement) {}
  get(b: Box) {
    const key = `${b.x0},${b.y0},${b.x1},${b.y1}`;
    let c = this.cache.get(key);
    if (!c) {
      this.data ??= this.source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, this.source.width, this.source.height);
      c = estimateColors(this.data.data, this.data.width, this.data.height, b);
      this.cache.set(key, c);
    }
    return c;
  }
}

export function drawRedactions(
  ctx: CanvasRenderingContext2D, findings: Finding[], manual: Box[], mode: Mode, colors: ColorSampler,
): void {
  ctx.save();
  if (mode === 'black') {
    ctx.fillStyle = '#000';
    for (const f of findings) if (f.active) fill(ctx, pad(f.bbox, 0.18, 2));
    for (const b of manual) fill(ctx, b);
  } else {
    // First cover everything, then write – so a neighbour's cover never cuts into dummy text.
    for (const f of findings) {
      if (!f.active) continue;
      ctx.fillStyle = rgb(colors.get(f.bbox).bg);
      fill(ctx, pad(f.bbox, 0.15, 2));
    }
    for (const b of manual) {
      ctx.fillStyle = rgb(colors.get(b).bg);
      fill(ctx, b);
    }
    ctx.textBaseline = 'alphabetic';
    for (const f of findings) {
      if (!f.active || !f.replacement) continue;
      const size = Math.max(6, f.fontSize);
      ctx.font = `${size}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = rgb(colors.get(f.bbox).fg);
      const width = ctx.measureText(f.replacement).width;
      const room = (f.bbox.x1 - f.bbox.x0) + size * 0.1;
      const sx = width > room ? room / width : 1;
      ctx.save();
      ctx.translate(f.bbox.x0, f.baseline);
      ctx.scale(sx, 1);
      ctx.fillText(f.replacement, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}
