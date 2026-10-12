import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let str = "";
  let t = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = t % 32;
    str = ENCODING[mod]! + str;
    t = (t - mod) / 32;
  }
  return str;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let str = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING[bytes[i]! % 32]!;
  }
  return str;
}

export function newId(): string {
  return encodeTime(Date.now()) + encodeRandom();
}
