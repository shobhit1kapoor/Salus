import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "salus_api_" });

const requests = new Counter({
  name: "salus_api_http_requests_total",
  help: "Total Salus API requests.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry]
});

const duration = new Histogram({
  name: "salus_api_http_request_duration_seconds",
  help: "Salus API response duration in seconds.",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry]
});

export function observeRequest(method: string, route: string, statusCode: number, elapsedMilliseconds: number) {
  const labels = { method, route, status_code: String(statusCode) };
  requests.inc(labels);
  duration.observe(labels, elapsedMilliseconds / 1000);
}
