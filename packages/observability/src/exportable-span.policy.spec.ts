import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpanStatusCode } from '@opentelemetry/api';
import { IMPORT_SUMMARY_ATTRIBUTE, IMPORT_SUMMARY_VALUE, shouldExportEndedSpan } from './exportable-span.policy.js';

describe('shouldExportEndedSpan', () => {
  it('deve exportar span com erro', () => {
    assert.equal(shouldExportEndedSpan({ attributes: {}, status: { code: SpanStatusCode.ERROR } }), true);
  });

  it('deve exportar resumo de importação', () => {
    assert.equal(shouldExportEndedSpan({
      attributes: { [IMPORT_SUMMARY_ATTRIBUTE]: IMPORT_SUMMARY_VALUE },
      status: { code: SpanStatusCode.UNSET },
    }), true);
  });

  it('não deve exportar sucesso comum', () => {
    assert.equal(shouldExportEndedSpan({ attributes: {}, status: { code: SpanStatusCode.OK } }), false);
  });
});
