const IDX = { R: 0, G: 1, B: 2 };
export function toDeviceOrder(rgb, order = 'RGB') {
  const a = [IDX[order[0]], IDX[order[1]], IDX[order[2]]];
  const out = Buffer.allocUnsafe(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    out[i]   = rgb[i + a[0]];
    out[i+1] = rgb[i + a[1]];
    out[i+2] = rgb[i + a[2]];
  }
  return out;
}
