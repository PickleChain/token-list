// Keccak-256 (the pre-NIST padding Ethereum uses) in plain JavaScript, so the
// validator needs no dependency. Node's crypto module only ships SHA3-256,
// which pads differently and gives different digests.

const RC = [
  [0x00000001, 0x00000000], [0x00008082, 0x00000000], [0x0000808a, 0x80000000], [0x80008000, 0x80000000],
  [0x0000808b, 0x00000000], [0x80000001, 0x00000000], [0x80008081, 0x80000000], [0x00008009, 0x80000000],
  [0x0000008a, 0x00000000], [0x00000088, 0x00000000], [0x80008009, 0x00000000], [0x8000000a, 0x00000000],
  [0x8000808b, 0x00000000], [0x0000008b, 0x80000000], [0x00008089, 0x80000000], [0x00008003, 0x80000000],
  [0x00008002, 0x80000000], [0x00000080, 0x80000000], [0x0000800a, 0x00000000], [0x8000000a, 0x80000000],
  [0x80008081, 0x80000000], [0x00008080, 0x80000000], [0x80000001, 0x00000000], [0x80008008, 0x80000000],
];

const ROT = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

// Each 64-bit lane is two 32-bit words: lo at 2*i, hi at 2*i+1.
function rotl(lo, hi, n) {
  if (n === 0) return [lo, hi];
  if (n >= 32) {
    [lo, hi] = [hi, lo];
    n -= 32;
    if (n === 0) return [lo, hi];
  }
  return [((lo << n) | (hi >>> (32 - n))) >>> 0, ((hi << n) | (lo >>> (32 - n))) >>> 0];
}

function keccakF(s) {
  const c = new Uint32Array(10);
  const b = new Uint32Array(50);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      c[2 * x] = s[2 * x] ^ s[2 * (x + 5)] ^ s[2 * (x + 10)] ^ s[2 * (x + 15)] ^ s[2 * (x + 20)];
      c[2 * x + 1] = s[2 * x + 1] ^ s[2 * (x + 5) + 1] ^ s[2 * (x + 10) + 1] ^ s[2 * (x + 15) + 1] ^ s[2 * (x + 20) + 1];
    }
    for (let x = 0; x < 5; x++) {
      const nx = (x + 1) % 5;
      const px = (x + 4) % 5;
      const [rlo, rhi] = rotl(c[2 * nx], c[2 * nx + 1], 1);
      const dlo = c[2 * px] ^ rlo;
      const dhi = c[2 * px + 1] ^ rhi;
      for (let y = 0; y < 25; y += 5) {
        s[2 * (x + y)] ^= dlo;
        s[2 * (x + y) + 1] ^= dhi;
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        const [lo, hi] = rotl(s[2 * i], s[2 * i + 1], ROT[i]);
        b[2 * j] = lo;
        b[2 * j + 1] = hi;
      }
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = x + y;
        const i1 = ((x + 1) % 5) + y;
        const i2 = ((x + 2) % 5) + y;
        s[2 * i] = b[2 * i] ^ (~b[2 * i1] & b[2 * i2]);
        s[2 * i + 1] = b[2 * i + 1] ^ (~b[2 * i1 + 1] & b[2 * i2 + 1]);
      }
    }
    s[0] ^= RC[round][0];
    s[1] ^= RC[round][1];
  }
}

/** Keccak-256 of a Uint8Array (or a string, read as UTF-8). Returns hex. */
export function keccak256(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Uint32Array(50);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      const p = off + 4 * i;
      s[i] ^= padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24);
    }
    keccakF(s);
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    const w = s[i];
    for (let k = 0; k < 4; k++) out += ((w >>> (8 * k)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

/** EIP-55 mixed-case checksum form of a 0x address. Throws on a malformed one. */
export function toChecksumAddress(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`not an address: ${address}`);
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256(lower);
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

export function isChecksumAddress(address) {
  try {
    return toChecksumAddress(address) === address;
  } catch {
    return false;
  }
}
