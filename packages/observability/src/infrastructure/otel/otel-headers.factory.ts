export function createAxiomOtlpHeaders(token: string, dataset: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-Axiom-Dataset': dataset,
  };
}

export function trimOtlpEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}
