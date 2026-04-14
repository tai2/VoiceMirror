import * as Sentry from "@sentry/react-native";

export function captureException(
  error: unknown,
  context: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setContext("operation", context);
    Sentry.captureException(error);
  });
}

export function captureMessage(
  message: string,
  context: Record<string, unknown>,
  level: Sentry.SeverityLevel = "error",
): void {
  Sentry.withScope((scope) => {
    scope.setContext("operation", context);
    scope.setLevel(level);
    Sentry.captureMessage(message);
  });
}

export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = "info",
): void {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level,
  });
}
