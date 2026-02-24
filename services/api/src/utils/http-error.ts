export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: Record<string, unknown>) {
  return new HttpError(400, "VALIDATION_FAILED", message, details);
}

export function unauthorized(message = "Unauthorized") {
  return new HttpError(401, "AUTH_INVALID_CREDENTIALS", message);
}

export function forbidden(message = "Forbidden") {
  return new HttpError(403, "AUTH_FORBIDDEN", message);
}

export function notFound(message = "Resource not found", details?: Record<string, unknown>) {
  return new HttpError(404, "RESOURCE_NOT_FOUND", message, details);
}
