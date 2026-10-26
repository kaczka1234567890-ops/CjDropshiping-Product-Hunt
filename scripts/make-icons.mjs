import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, data, crc]);
}

function makeIcon(size, outPath) {
  const w = size;
  const h = size;
  const raw = Buffer.alloc(h * (1 + w * 4));
  const r = size * 0.18;
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const dx = Math.max(0, Math.max(r - x, x - (w - 1 - r)));
      const dy = Math.max(0, Math.max(r - y, y - (h - 1 - r)));
      const inside = dx * dx + dy * dy <= r * r || dx === 0 || dy === 0;
      let R;
      let G;
      let B;
      let A;
      const px = x / w;
      const py = y / h;
      const inP = px > 0.22 && px < 0.34 && py > 0.25 && py < 0.75;
      const inPtop = px > 0.22 && px < 0.46 && py > 0.25 && py < 0.4;
      const inH1 = px > 0.54 && px < 0.66 && py > 0.25 && py < 0.75;
      const inH2 = px > 0.74 && px < 0.86 && py > 0.25 && py < 0.75;
      const inHbar = px > 0.54 && px < 0.86 && py > 0.45 && py < 0.58;
      const letter = inP || inPtop || inH1 || inH2 || inHbar;
      if (!inside) {
        R = 0;
        G = 0;
        B = 0;
        A = 0;
      } else if (letter) {
        R = 255;
        G = 255;
        B = 255;
        A = 255;
      } else {
        R = 255;
        G = 119;
        B = 0;
        A = 255;
      }
      const o = row + 1 + x * 4;
      raw[o] = R;
      raw[o + 1] = G;
      raw[o + 2] = B;
      raw[o + 3] = A;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
  fs.writeFileSync(outPath, png);
  console.log("wrote", outPath, png.length, "bytes");
}

const dir = "extension/icons";
fs.mkdirSync(dir, { recursive: true });
makeIcon(16, path.join(dir, "icon16.png"));
makeIcon(48, path.join(dir, "icon48.png"));
makeIcon(128, path.join(dir, "icon128.png"));
console.log("done");
