const LOCAL_WEB_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

export function isAllowedWebOrigin(origin: string): boolean {
  return configuredWebOrigins().includes(origin) || (!isProductionEnvironment() && LOCAL_WEB_ORIGIN_PATTERN.test(origin));
}

export function isCrossSiteWebOrigin(origin: string | undefined): boolean {
  return Boolean(origin && !LOCAL_WEB_ORIGIN_PATTERN.test(origin));
}

function configuredWebOrigins(): string[] {
  return (process.env.WEB_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
}
