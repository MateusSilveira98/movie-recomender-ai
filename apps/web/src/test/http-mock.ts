import { vi } from 'vitest';

export interface MockedRequest {
  body: string | null;
  credentials: RequestCredentials | undefined;
  headers: Headers;
  method: string;
  path: string;
}

export type HttpRoute = (request: MockedRequest) => Response | Promise<Response>;

export function mockHttp(routes: Record<string, HttpRoute>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = init?.method ?? 'GET';
    const path = `${url.pathname}${url.search}`;
    const route = routes[`${method} ${path}`];

    if (!route) {
      throw new Error(`Mock HTTP ausente para ${method} ${path}.`);
    }

    return route({
      body: typeof init?.body === 'string' ? init.body : null,
      credentials: init?.credentials,
      headers: new Headers(init?.headers),
      method,
      path,
    });
  });
}

export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}
