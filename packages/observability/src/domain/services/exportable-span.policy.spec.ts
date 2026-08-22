import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IMPORT_SUMMARY_ATTRIBUTE,
  IMPORT_SUMMARY_VALUE,
  SPAN_ERROR_STATUS_CODE,
  shouldExportEndedSpan,
} from './exportable-span.policy.js';

describe('shouldExportEndedSpan', () => {
  it('deve exportar span com erro', () => {
    assert.equal(shouldExportEndedSpan({ attributes: {}, status: { code: SPAN_ERROR_STATUS_CODE } }), true);
  });

  it('deve exportar resumo de importação', () => {
    assert.equal(shouldExportEndedSpan({
      attributes: { [IMPORT_SUMMARY_ATTRIBUTE]: IMPORT_SUMMARY_VALUE },
      status: { code: 0 },
    }), true);
  });

  it('não deve exportar sucesso comum', () => {
    assert.equal(shouldExportEndedSpan({ attributes: {}, status: { code: 1 } }), false);
  });
});
