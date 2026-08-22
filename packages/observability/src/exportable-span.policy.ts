import { SpanStatusCode } from '@opentelemetry/api';

export const IMPORT_SUMMARY_ATTRIBUTE = 'app.telemetry.export';
export const IMPORT_SUMMARY_VALUE = 'import-summary';

export function shouldExportEndedSpan(span: {
  attributes: Record<string, unknown>;
  status: { code: number };
}): boolean {
  return span.status.code === SpanStatusCode.ERROR
    || span.attributes[IMPORT_SUMMARY_ATTRIBUTE] === IMPORT_SUMMARY_VALUE;
}
