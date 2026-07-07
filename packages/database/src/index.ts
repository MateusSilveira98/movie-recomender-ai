export interface DatabaseHealth {
  provider: 'local-placeholder';
  status: 'ready';
}

export function getDatabaseHealth(): DatabaseHealth {
  return {
    provider: 'local-placeholder',
    status: 'ready',
  };
}
