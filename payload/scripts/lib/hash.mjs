import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(absPath) {
  return sha256(readFileSync(absPath));
}

export function byteCompare(a, b) {
  return Buffer.compare(Buffer.from(String(a)), Buffer.from(String(b)));
}
