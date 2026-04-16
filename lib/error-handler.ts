/**
 * Error handling utilities
 * Provides consistent error logging, formatting, and user-friendly messages
 */

/* ─────────────────────────────────────────────────────────────────────
 *  Types
 * ───────────────────────────────────────────────────────────────────── */

export interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  context?: Record<string, unknown>;
}

export interface FormattedError {
  title: string;
  message: string;
  icon: "error" | "warning" | "info";
  code?: string;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Error Detection
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Check if error is a Supabase error
 */
export function isSupabaseError(error: unknown): error is { code?: string; message?: string; status?: number } {
  if (!error || typeof error !== "object") return false;
  return "code" in error || "status" in error;
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes("fetch") || msg.includes("network") || msg.includes("offline");
  }
  return false;
}

/**
 * Check if error is a timeout
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.includes("timeout");
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Error Logging
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Log error to console and future Sentry integration
 * In production, this would send to error tracking service
 */
export function logError(error: unknown, context?: ErrorContext): void {
  const errorObj = normalizeError(error);
  const timestamp = new Date().toISOString();

  const logData = {
    timestamp,
    error: {
      name: errorObj.name,
      message: errorObj.message,
      stack: errorObj.stack,
      code: (error as Record<string, unknown>)?.code,
    },
    context,
  };

  // Always log to console in development
  if (process.env.NODE_ENV === "development") {
    console.error("[ERROR]", logData);
  }

  // In production, send to error tracking service (e.g., Sentry)
  if (process.env.NODE_ENV === "production") {
    // TODO: Send to Sentry or similar service
    // captureException(error, { extra: context });
    console.error("[PRODUCTION_ERROR]", logData);
  }
}

/**
 * Normalize various error types to Error object
 */
function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  if (typeof error === "object" && error !== null && "message" in error) {
    return new Error(String((error as Record<string, unknown>).message));
  }
  return new Error(String(error));
}

/* ─────────────────────────────────────────────────────────────────────
 *  Error Formatting
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Get user-friendly error message based on error type
 */
export function getErrorMessage(error: unknown): string {
  if (isNetworkError(error)) {
    return "No hay conexión. Comprueba tu red e intenta de nuevo.";
  }

  if (isTimeoutError(error)) {
    return "La solicitud tardó demasiado. Por favor, intenta de nuevo.";
  }

  if (isSupabaseError(error)) {
    const supabaseError = error as { code?: string; message?: string; status?: number };

    // Handle specific Supabase error codes
    if (supabaseError.code === "PGRST116") {
      return "Los datos solicitados no existen.";
    }
    if (supabaseError.code === "PGRST110") {
      return "No tienes permisos para acceder a estos datos.";
    }
    if (supabaseError.code === "42501") {
      return "Error de permisos. Contacta con el administrador.";
    }
    if (supabaseError.code === "23505") {
      return "Este registro ya existe.";
    }

    // Handle HTTP status codes
    if (supabaseError.status === 401) {
      return "Tu sesión ha expirado. Por favor, inicia sesión de nuevo.";
    }
    if (supabaseError.status === 403) {
      return "No tienes permisos para realizar esta acción.";
    }
    if (supabaseError.status === 404) {
      return "El recurso solicitado no existe.";
    }
    if (supabaseError.status === 409) {
      return "Conflicto: los datos han cambiado. Por favor, recarga e intenta de nuevo.";
    }
    if (supabaseError.status === 422) {
      return "Los datos enviados son inválidos.";
    }
    if (supabaseError.status === 429) {
      return "Demasiadas solicitudes. Por favor, espera un momento e intenta de nuevo.";
    }
    if (supabaseError.status && supabaseError.status >= 500) {
      return "Error del servidor. Por favor, intenta de nuevo más tarde.";
    }

    // Fallback to custom message if available
    if (supabaseError.message) {
      return supabaseError.message;
    }
  }

  if (error instanceof Error) {
    // Check for specific error patterns
    if (error.message.includes("auth")) {
      return "Error de autenticación. Por favor, verifica tus credenciales.";
    }
    if (error.message.includes("permission") || error.message.includes("PERMISSION")) {
      return "No tienes permisos para realizar esta acción.";
    }
    if (error.message.includes("validation")) {
      return "Los datos enviados no son válidos.";
    }
  }

  return "Algo salió mal. Por favor, intenta de nuevo.";
}

/**
 * Format error for UI display with icon and title
 */
export function formatErrorForUI(error: unknown): FormattedError {
  const message = getErrorMessage(error);

  if (isNetworkError(error)) {
    return {
      title: "Error de conexión",
      message,
      icon: "error",
      code: "NETWORK_ERROR",
    };
  }

  if (isTimeoutError(error)) {
    return {
      title: "Tiempo de espera agotado",
      message,
      icon: "warning",
      code: "TIMEOUT_ERROR",
    };
  }

  if (isSupabaseError(error)) {
    const supabaseError = error as { code?: string; status?: number };
    if (supabaseError.status === 401 || supabaseError.status === 403) {
      return {
        title: "Acceso denegado",
        message,
        icon: "error",
        code: supabaseError.code || "AUTH_ERROR",
      };
    }
    if (supabaseError.status === 404) {
      return {
        title: "No encontrado",
        message,
        icon: "info",
        code: supabaseError.code || "NOT_FOUND",
      };
    }
    if (supabaseError.status && supabaseError.status >= 500) {
      return {
        title: "Error del servidor",
        message,
        icon: "error",
        code: supabaseError.code || "SERVER_ERROR",
      };
    }
    return {
      title: "Error al cargar datos",
      message,
      icon: "error",
      code: supabaseError.code || "DATABASE_ERROR",
    };
  }

  return {
    title: "Error inesperado",
    message,
    icon: "error",
    code: "UNKNOWN_ERROR",
  };
}

/**
 * Get retry information for an error (should we retry? how long to wait?)
 */
export function getRetryInfo(error: unknown): { shouldRetry: boolean; delayMs: number } {
  // Network errors: retry after 2 seconds
  if (isNetworkError(error)) {
    return { shouldRetry: true, delayMs: 2000 };
  }

  // Timeout: retry after 3 seconds
  if (isTimeoutError(error)) {
    return { shouldRetry: true, delayMs: 3000 };
  }

  // Supabase errors
  if (isSupabaseError(error)) {
    const supabaseError = error as { status?: number };
    // Rate limit: wait before retry
    if (supabaseError.status === 429) {
      return { shouldRetry: true, delayMs: 5000 };
    }
    // Server error: retry with exponential backoff
    if (supabaseError.status && supabaseError.status >= 500) {
      return { shouldRetry: true, delayMs: 2000 };
    }
    // Auth error: don't retry, needs user action
    if (supabaseError.status === 401 || supabaseError.status === 403) {
      return { shouldRetry: false, delayMs: 0 };
    }
  }

  // Unknown errors: don't retry
  return { shouldRetry: false, delayMs: 0 };
}
