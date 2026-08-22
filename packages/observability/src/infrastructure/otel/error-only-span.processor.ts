import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { shouldExportEndedSpan } from '../../domain/services/exportable-span.policy.js';

export class ErrorOnlySpanProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  onEnd(span: ReadableSpan): void {
    if (!shouldExportEndedSpan({
      attributes: span.attributes as Record<string, unknown>,
      status: { code: span.status.code },
    })) {
      return;
    }

    this.delegate.onEnd(span);
  }

  onStart(span: Span, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
