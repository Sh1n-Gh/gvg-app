const { PublicError } = require('./errors');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 8192;
const MAX_PIXELS = 16000000;
const DIRECTORY = path.join(__dirname, '../public/uploads/map-images');
const fail = (status, message) => new PublicError(message, status);
let processing = 0;

async function normalize(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail(400, 'Chỉ chấp nhận file PNG hoặc JPEG hợp lệ');
  if (buffer.length > MAX_BYTES) throw fail(413, 'Ảnh vượt quá giới hạn 5 MB');
  const png = buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (!png && !jpeg) throw fail(400, 'Chỉ chấp nhận file PNG hoặc JPEG hợp lệ');
  try {
    const input = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
    const meta = await input.metadata();
    if (meta.format !== (png ? 'png' : 'jpeg') || (meta.pages || 1) !== 1) throw fail(400, 'Ảnh không hợp lệ hoặc có nhiều frame');
    if (!meta.width || !meta.height || meta.width > MAX_SIDE || meta.height > MAX_SIDE || meta.width * meta.height > MAX_PIXELS) {
      throw fail(413, 'Ảnh tối đa 8192 px mỗi chiều và 16 triệu pixel');
    }
    // Apply EXIF orientation before stripping all source metadata (Sharp default).
    const pipeline = input.rotate().timeout({ seconds: 10 });
    const data = await (png ? pipeline.png() : pipeline.jpeg({ quality: 90 })).toBuffer();
    if (data.length > MAX_BYTES) throw fail(413, 'Ảnh sau chuẩn hóa vượt quá giới hạn 5 MB');
    return { data, extension: png ? 'png' : 'jpg' };
  } catch (err) {
    if (err.status) throw err;
    if (/pixel limit/i.test(err.message)) throw fail(413, 'Ảnh vượt giới hạn 16 triệu pixel');
    throw fail(400, 'Không giải mã được ảnh PNG/JPEG');
  }
}

function createStore(directory = DIRECTORY, { maxBytes = 512 * 1024 * 1024, maxFiles = 2000 } = {}) {
  return {
    directory,
    async save(buffer) {
      if (processing >= 2) throw fail(429, 'Đang xử lý ảnh, vui lòng thử lại');
      processing++;
      try {
        const { data, extension } = await normalize(buffer);
        fs.mkdirSync(directory, { recursive: true });
        // No await between quota check and exclusive write: single-process admission.
        let bytes = 0, count = 0;
        for (const name of fs.readdirSync(directory)) {
          if (name === '.gitkeep') continue;
          const stat = fs.lstatSync(path.join(directory, name));
          if (!stat.isFile()) throw fail(409, 'Kho ảnh cần được kiểm tra');
          bytes += stat.size; count++;
        }
        if (count >= maxFiles || bytes + data.length > maxBytes) throw fail(409, 'Kho ảnh đã đầy, vui lòng liên hệ quản trị');
        const name = `${randomUUID()}.${extension}`;
        fs.writeFileSync(path.join(directory, name), data, { flag: 'wx', mode: 0o600 });
        return `/uploads/map-images/${name}`;
      } finally { processing--; }
    },
    serve(req, res) {
      // Terminal handler: never fall through to general static serving.
      const name = req.path.slice(1);
      if (!/^[a-zA-Z0-9-]+\.(png|jpg|jpeg)$/.test(name)) return res.sendStatus(404);
      const file = path.join(directory, name);
      try { if (!fs.lstatSync(file).isFile()) return res.sendStatus(404); }
      catch { return res.sendStatus(404); }
      res.set('Content-Type', name.endsWith('.png') ? 'image/png' : 'image/jpeg');
      res.set('X-Content-Type-Options', 'nosniff');
      res.sendFile(file, err => { if (err && !res.headersSent) res.sendStatus(404); });
    },
  };
}

module.exports = { MAX_BYTES, MAX_SIDE, MAX_PIXELS, normalize, createStore };
