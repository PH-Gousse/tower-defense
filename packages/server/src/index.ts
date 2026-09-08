import { MatchRoom } from './match'
import { isCode, makeCode } from './codes'

/**
 * Worker entry. Routes `/r/:code` to the Durable Object for that room.
 *
 * There is deliberately no "is this code taken" endpoint. Durable Objects are
 * addressed by name and every name resolves, so asking would instantiate the
 * object for it — the check would create the thing it was checking for. Codes
 * are generated blind and the room itself refuses a second lobby. At a billion
 * codes and a handful of concurrent matches, a collision is a curiosity.
 *
 * Only `MatchRoom` and the default handler may be exported from here. Workers
 * rejects any other named export at module load -- "the provided value is not
 * of type 'function or ExportedHandler'" -- and takes the whole Worker down
 * before a request arrives, so the code helpers live in `codes.ts`.
 */

interface Env {
  readonly MATCH: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request): Promise<Response> }
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    // A code to put on screen. Generated blind, never checked for collisions.
    if (url.pathname === '/new') {
      const code = makeCode((n) => crypto.getRandomValues(new Uint32Array(n)))
      return new Response(JSON.stringify({ code }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    const match = url.pathname.match(/^\/r\/([A-Za-z0-9]+)$/)
    if (match) {
      const code = (match[1] as string).toUpperCase()
      if (!isCode(code)) return new Response('bad room code', { status: 400, headers: CORS })
      const stub = env.MATCH.get(env.MATCH.idFromName(code))
      return stub.fetch(request)
    }

    return new Response('line tower wars relay', { headers: CORS })
  },
}

export { MatchRoom }
