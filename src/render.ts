// Draws the planned redactions (black bars, covers with dummy text or pseudonyms) onto a canvas
// in image coordinates.
import { estimateColors, type Box, type RGB } from './core/detect';
import type { DrawItem } from './core/plan';

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
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

export function drawItems(ctx: CanvasRenderingContext2D, items: DrawItem[], colors: ColorSampler): void {
  ctx.save();
  // First all covers, then the text – so a neighbour's cover never cuts into dummy text.
  for (const it of items) {
    ctx.fillStyle = it.type === 'black' ? '#000' : rgb(colors.get(it.box).bg);
    fill(ctx, it.box);
  }
  ctx.textBaseline = 'alphabetic';
  for (const it of items) {
    if (it.type !== 'cover' || !it.text) continue;
    const size = Math.max(6, it.fontSize);
    ctx.font = `${size}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = rgb(colors.get(it.box).fg);
    const width = ctx.measureText(it.text).width;
    const room = it.width + size * 0.1;
    // Squeeze long text a little; beyond that make it smaller (keeps "Person A" readable over "Max").
    const fit = width > room ? room / width : 1;
    const sx = Math.max(fit, 0.72);
    const sy = fit < 0.72 ? fit / 0.72 : 1;
    ctx.save();
    ctx.translate(it.x, it.baseline);
    ctx.scale(sx * sy, sy);
    ctx.fillText(it.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
