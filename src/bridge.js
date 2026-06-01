export function connectBridge(route) {
  const ws = new WebSocket(`ws://${location.host}/frames`);
  ws.binaryType = 'arraybuffer';
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'route', route })));
  return {
    send(rgba) {
      if (ws.readyState !== 1) return;
      const n = rgba.length / 4; const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i*3]=rgba[i*4]; rgb[i*3+1]=rgba[i*4+1]; rgb[i*3+2]=rgba[i*4+2]; }
      ws.send(rgb);
    }
  };
}
