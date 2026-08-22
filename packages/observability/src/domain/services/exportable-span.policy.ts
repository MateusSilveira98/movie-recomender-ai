export const IMPORT_SUMMARY_ATTRIBUTE = 'app.telemetry.export';
export const IMPORT_SUMMARY_VALUE = 'import-summary';

export const SPAN_ERROR_STATUS_CODE = 2;

export interface EndedSpanSnapshot {
  attributes: Record<string, unknown>;
  status: { code: number };
}

export function shouldExportEndedSpan(span: EndedSpanSnapshot): boolean {
  return isErrorSpan(span) || isImportSummarySpan(span);
}

function isErrorSpan(span: EndedSpanSnapshot): boolean {
  return span.status.code === SPAN_ERROR_STATUS_CODE;
}

function isImportSummarySpan(span: EndedSpanSnapshot): boolean {
  return span.attributes[IMPORT_SUMMARY_ATTRIBUTE] === IMPORT_SUMMARY_VALUE;
}
