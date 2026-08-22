import type { HttpRequestTelemetry } from '../../domain/models/application-telemetry.model.js';
import { recordHttpRequest } from '../../infrastructure/otel/otel-application-metrics.adapter.js';
import { finishServerSpan, startServerSpan } from '../../infrastructure/otel/otel-application-spans.adapter.js';

export function startHttpRequest(method: string, route: string): HttpRequestTelemetry {
  const span = startServerSpan(method, route);

  return {
    complete(input) {
      span.updateName(`HTTP ${method} ${input.route}`);
      span.setAttribute('http.route', input.route);
      recordHttpRequest({
        durationMs: input.durationMs,
        method,
        route: input.route,
        status: input.status,
      });
      finishServerSpan(span, input.status);
    },
  };
}
