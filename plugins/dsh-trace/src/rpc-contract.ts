/**
 * Shared browser/host RPC contract for the trace endpoints.
 *
 * DSH carries plugin RPC on the Connection `/api` route: one exact POST path per
 * endpoint, authenticated by the shared carrier's Host/Origin fence and browser
 * session. The dedicated `connection.rpc.handle()` channel is deliberately not
 * used — in DSH `0.1.5-rc.2` its registration resolves `webServer` through the
 * Connection plugin's own fiber chain (a sibling-provided service is unreachable
 * there), so `handle()` throws inside the plugin's asynchronous effect and the
 * routes never mount.
 */

/** Shared `/api` channel both halves address. */
export const API_CHANNEL = '/api'

/** Namespace this plugin owns below the shared channel. */
export const TRACE_RPC_NAMESPACE = 'dsh-trace'

/** Every endpoint the host half owns and the browser half may call. */
export const TRACE_RPC_ENDPOINTS = [
  'requests.list',
  'requests.get',
  'requests.clear',
] as const

export type TraceRpcEndpoint = (typeof TRACE_RPC_ENDPOINTS)[number]

/**
 * Absolute host route path of one endpoint.
 * @param endpoint - endpoint name.
 * @returns path registered on the shared channel.
 */
export function traceRpcPath(endpoint: TraceRpcEndpoint): string {
  return `${API_CHANNEL}/${TRACE_RPC_NAMESPACE}/${endpoint}`
}

/**
 * Endpoint address the browser half passes to `connection.rpc.call`.
 * @param endpoint - endpoint name.
 * @returns `<namespace>/<endpoint>` address.
 */
export function traceRpcAddress(endpoint: TraceRpcEndpoint): string {
  return `${TRACE_RPC_NAMESPACE}/${endpoint}`
}
