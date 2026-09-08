/**
 * Room codes.
 *
 * Six characters from an alphabet with no `0/O` and no `1/l/I`: about a billion
 * combinations, short enough to read down a phone, long enough that a stranger
 * does not stumble into your match.
 *
 * These live in their own module rather than in the Worker entry because
 * Workers requires every named export from the entry point to be a Durable
 * Object class or a handler. Exporting a plain function there fails at module
 * load with "the provided value is not of type 'function or ExportedHandler'",
 * which takes the whole Worker down before a single request arrives.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export const CODE_LENGTH = 6

export function makeCode(random: (n: number) => Uint32Array): string {
  const bytes = random(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[(bytes[i] as number) % ALPHABET.length]
  }
  return out
}

export function isCode(s: string): boolean {
  if (s.length !== CODE_LENGTH) return false
  for (const ch of s) if (!ALPHABET.includes(ch)) return false
  return true
}
