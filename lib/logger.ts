// Minimal structured logging for API routes. Vercel captures stdout/stderr
// from serverless functions as "Runtime Logs" (Project -> Deployments ->
// select a deployment -> Logs tab, or the Logs tab at the project level for
// recent invocations across deployments); writing JSON lines here makes
// those entries greppable instead of freeform text.

type LogFields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", route: string, message: string, fields?: LogFields) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    route,
    message,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logInfo(route: string, message: string, fields?: LogFields) {
  emit("info", route, message, fields);
}

export function logWarn(route: string, message: string, fields?: LogFields) {
  emit("warn", route, message, fields);
}

export function logError(route: string, message: string, err: unknown, fields?: LogFields) {
  const errFields =
    err instanceof Error
      ? { errorName: err.name, errorMessage: err.message, stack: err.stack }
      : { errorMessage: String(err) };
  emit("error", route, message, { ...errFields, ...fields });
}
