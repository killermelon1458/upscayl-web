/** Inspect image headers only; never decode pixels to estimate output size. */
export function imageDimensions(data: Buffer, extension: string) {
  let width = 0;
  let height = 0;
  if (
    extension === "png" &&
    data.length >= 24 &&
    data.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
  } else if (extension === "webp") {
    for (let offset = 12; offset + 8 <= data.length; ) {
      const chunk = data.toString("ascii", offset, offset + 4);
      const size = data.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + size > data.length) break;
      if (chunk === "VP8X" && size >= 10) {
        width = 1 + data.readUIntLE(start + 4, 3);
        height = 1 + data.readUIntLE(start + 7, 3);
        break;
      }
      if (
        chunk === "VP8 " &&
        size >= 10 &&
        data.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 1, 0x2a]))
      ) {
        width = data.readUInt16LE(start + 6) & 0x3fff;
        height = data.readUInt16LE(start + 8) & 0x3fff;
        break;
      }
      if (chunk === "VP8L" && size >= 5 && data[start] === 0x2f) {
        const bits = data.readUInt32LE(start + 1);
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
        break;
      }
      offset = start + size + (size % 2);
    }
  } else if (["jpg", "jpeg", "jfif"].includes(extension)) {
    let offset = 2;
    while (offset + 4 <= data.length && data[offset] === 0xff) {
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) break;
      const size = data.readUInt16BE(offset);
      if (size < 2 || offset + size > data.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        size >= 7
      ) {
        height = data.readUInt16BE(offset + 3);
        width = data.readUInt16BE(offset + 5);
        break;
      }
      offset += size;
    }
  }
  return width > 0 && height > 0 ? { width, height } : undefined;
}
