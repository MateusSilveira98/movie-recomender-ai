const baseUrl = process.env.BFF_SMOKE_BASE_URL;

if (!baseUrl) {
  throw new Error('BFF_SMOKE_BASE_URL deve apontar para o BFF publicado.');
}

const response = await fetch(new URL('/health', baseUrl));

if (!response.ok) {
  throw new Error(`O healthcheck do BFF retornou ${response.status}.`);
}

const body = await response.json() as { status?: unknown };

if (body.status !== 'ok') {
  throw new Error('O healthcheck do BFF não retornou o status esperado.');
}
