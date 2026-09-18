/**
 * Host transport for the delegation endpoints: one exact, authenticated POST
 * route per endpoint on the Connection `/api` carrier.
 *
 * The carrier owns trust, authentication, and body buffering; this module owns
 * the `client-request` / `server-response` envelope and dispatch, mirroring the
 * shapes DSH's own shared-channel dispatcher produces.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import { API_CHANNEL, DELEGATE_RPC_ENDPOINTS, delegateRpcAddress, delegateRpcPath, type DelegateRpcEndpoint } from '../rpc-contract.ts'
import type { DelegatePresetStore } from './preset-store.ts'
import { handleDelegateRpc, type WorkspaceRegistryLike } from './rpc.ts'
import type { DelegationRuntime } from './runtime.ts'

/** Correlated client request accepted by one route. */
interface ClientEnvelope {
  readonly rpcId: string
  readonly payload: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Envelope answer for a request the plugin rejects before dispatch. */
function envelopeFailure(rpcId: string, code: string, message: string): Response {
  const result: ConnectionRpcResult<unknown> = { ok: false, error: { code, message, details: {} } }
  return Response.json({ type: 'server-response', rpcId, result })
}

/**
 * Read one client envelope, distinguishing a malformed body from a request the
 * plugin can answer with a correlated failure.
 * @param value - decoded JSON body.
 * @param endpoint - endpoint this route owns.
 * @returns the envelope, `undefined` for a malformed body, or a correlated failure response.
 */
function readEnvelope(value: unknown, endpoint: DelegateRpcEndpoint): ClientEnvelope | Response | undefined {
  if (!isRecord(value)) return undefined
  const rpcId = typeof value['rpcId'] === 'string' && value['rpcId'].length > 0
    ? value['rpcId']
    : 'invalid-request'
  const address = delegateRpcAddress(endpoint)
  if (value['type'] !== 'client-request') {
    return envelopeFailure(rpcId, 'gateway/bad-request', 'invalid client-request message')
  }
  // The shared-channel caller passes `<namespace>/<endpoint>` as the method, so
  // the envelope addresses the endpoint exactly as the browser requested it.
  if (value['method'] !== address) {
    return envelopeFailure(
      rpcId,
      'gateway/bad-request',
      `method ${JSON.stringify(String(value['method']))} does not match endpoint ${JSON.stringify(address)}`,
    )
  }
  return { rpcId, payload: value['payload'] }
}

/** Dispatch one decoded request and write the correlated answer. */
async function respond(
  runtime: DelegationRuntime,
  presets: DelegatePresetStore,
  workspaces: WorkspaceRegistryLike,
  endpoint: DelegateRpcEndpoint,
  request: Request,
): Promise<Response> {
  const decoded = await request.json().catch(() => undefined)
  const envelope = readEnvelope(decoded, endpoint)
  if (envelope === undefined) return new Response('body is not a client-request envelope', { status: 400 })
  if (envelope instanceof Response) return envelope
  const result = await handleDelegateRpc(runtime, presets, workspaces, endpoint, envelope.payload, request.signal)
  return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result })
}

/**
 * Register every delegation endpoint on the shared channel.
 *
 * Registration failures are returned to the caller as a rejected setup so the
 * owning lifecycle can log them; DSH swallows asynchronous effect failures, so
 * this is the only place a missing route can be reported.
 * @param ctx - host context carrying the injected Connection service.
 * @param runtime - live delegation runtime the endpoints drive.
 * @param presets - preset store the endpoints read and write.
 * @param workspaces - workspace registry projecting session → workspace.
 * @returns disposer removing every registered route.
 */
export function registerDelegateRoutes(
  ctx: Context,
  runtime: DelegationRuntime,
  presets: DelegatePresetStore,
  workspaces: WorkspaceRegistryLike,
): () => Promise<void> {
  const disposers = DELEGATE_RPC_ENDPOINTS.map(endpoint => ctx.effect(
    () => ctx.connection.fetch.register({
      path: delegateRpcPath(endpoint),
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => {
        const dispatch = (): Promise<Response> => respond(
          runtime,
          presets,
          workspaces,
          endpoint,
          request,
        )
        return dispatch().catch((error: unknown) => new Response(
          `dsh-delegate-agent handler failure: ${error instanceof Error ? error.message : String(error)}`,
          { status: 500 },
        ))
      },
    }),
    `dsh-delegate-agent: ${API_CHANNEL} ${endpoint} route`,
  ))
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
