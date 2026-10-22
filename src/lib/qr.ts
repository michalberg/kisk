import qrcode from 'qrcode-generator';

const cache = new Map<string, string>();

/** QR code as a crisp SVG (one path), dark modules in currentColor. */
export function qrSvg(text: string): string {
  const hit = cache.get(text);
  if (hit) return hit;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 2; // quiet zone in modules
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  }
  const size = n + q * 2;
  const svg = `<svg class="qr" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR kód"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="currentColor"/></svg>`;
  cache.set(text, svg);
  return svg;
}
