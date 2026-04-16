# Error Handling System

This document describes the comprehensive error handling and error boundaries implementation in ENLAZE.

## Overview

The error handling system provides:
- **Global error boundaries** for app-wide and dashboard-specific error catching
- **Reusable error components** for consistent UI across the app
- **Error utilities** for logging, formatting, and user-friendly messages
- **Structured error responses** with icons, codes, and actionable messages

## Architecture

### Error Boundaries

#### Global Error Boundary (`app/error.tsx`)
Catches unhandled errors in the entire application (outside dashboard).

**Usage:**
- Root-level component errors
- Layout-level errors
- Non-dashboard page errors

**Features:**
- User-friendly error message with retry button
- Error code display for support reference
- Home button fallback
- Support contact information
- Responsive design with gradient background

**Error Flow:**
1. Error occurs in app component
2. `app/error.tsx` catches it
3. `logError()` logs to console/monitoring
4. User sees friendly message with retry option
5. User can retry or go to home page

#### Dashboard Error Boundary (`app/dashboard/error.tsx`)
Catches errors within the dashboard subtree specifically.

**Usage:**
- Dashboard page errors
- Dashboard layout errors
- Data fetching failures in dashboard

**Features:**
- Maintains dashboard navigation context (user can navigate away)
- "What happened" explanation for context
- Technical details in development mode
- Retry and return-to-dashboard options
- Help section with support link

#### Component-Level Error Boundary (`components/ErrorBoundary.tsx`)
Reusable error boundary for protecting specific sections.

**Usage:**
```tsx
import ErrorBoundary from "@/components/ErrorBoundary";

export default function MyPage() {
  return (
    <ErrorBoundary name="my-section" showDetails>
      <ExpensiveComponent />
    </ErrorBoundary>
  );
}
```

**Features:**
- Optional custom fallback UI
- Component name for logging
- Development-only error details
- Reset functionality

### Error Components

#### ErrorAlert (`components/ErrorAlert.tsx`)
Reusable inline alert component for errors, warnings, and info messages.

**Usage:**
```tsx
import ErrorAlert from "@/components/ErrorAlert";

export default function MyPage() {
  const [error, setError] = useState<Error | null>(null);

  return (
    <>
      {error && (
        <ErrorAlert
          title="Upload Failed"
          message="The file is too large. Maximum size is 10MB."
          variant="error"
          action={{
            label: "Try Again",
            onClick: () => handleUpload(),
          }}
          onDismiss={() => setError(null)}
        />
      )}
      {/* ... rest of page ... */}
    </>
  );
}
```

**Props:**
- `title` (string) - Alert title
- `message` (string) - Alert message
- `variant` ("error" | "warning" | "info") - Color scheme
- `dismissible` (boolean, default: true) - Show close button
- `onDismiss` (function) - Callback when dismissed
- `action` (object) - Optional action button
  - `label` (string) - Button text
  - `onClick` (function) - Click handler
- `className` (string) - Custom styling

**Variants:**
- `error` - Red background, for errors
- `warning` - Amber background, for warnings
- `info` - Sky background, for info messages

### Error Utilities (`lib/error-handler.ts`)

#### Error Detection Functions

**`isSupabaseError(error)`**
Checks if an error originated from Supabase.

```tsx
if (isSupabaseError(error)) {
  const supabaseError = error as { code?: string; status?: number };
  // Handle Supabase-specific error
}
```

**`isNetworkError(error)`**
Checks if an error is a network connectivity issue.

```tsx
if (isNetworkError(error)) {
  // Show "check your connection" message
}
```

**`isTimeoutError(error)`**
Checks if an error is a timeout.

```tsx
if (isTimeoutError(error)) {
  // Show "request took too long" message
}
```

#### Error Logging

**`logError(error, context)`**
Logs errors for debugging and monitoring.

```tsx
logError(error, {
  component: "DashboardHome",
  action: "loadDashboard",
  userId: "user-123",
  context: {
    dataType: "clients",
  },
});
```

**Features:**
- Console logging in development
- Future Sentry integration point for production
- Timestamps and structured data
- Contextual information

#### Error Formatting

**`getErrorMessage(error): string`**
Returns a user-friendly error message based on error type.

```tsx
const message = getErrorMessage(error);
// Returns: "Hubo un problema. Por favor, intenta de nuevo."
```

**Handles:**
- Network errors
- Timeouts
- Supabase-specific codes (PGRST116, PGRST110, etc.)
- HTTP status codes (401, 403, 404, 429, 5xx)
- Authentication errors
- Permission errors
- Validation errors

**`formatErrorForUI(error): FormattedError`**
Formats error for UI display with icon, title, and code.

```tsx
const formatted = formatErrorForUI(error);
// Returns:
// {
//   title: "Error de conexión",
//   message: "No hay conexión...",
//   icon: "error",
//   code: "NETWORK_ERROR"
// }
```

**Return Type:**
```tsx
interface FormattedError {
  title: string;           // UI-friendly title
  message: string;         // User-friendly message
  icon: "error" | "warning" | "info";  // Icon type
  code?: string;           // Error code for support
}
```

**`getRetryInfo(error): { shouldRetry: boolean; delayMs: number }`**
Determines if an error should be retried and how long to wait.

```tsx
const { shouldRetry, delayMs } = getRetryInfo(error);
if (shouldRetry) {
  setTimeout(() => {
    // Retry operation
  }, delayMs);
}
```

**Rules:**
- Network errors: retry after 2s
- Timeouts: retry after 3s
- Rate limits (429): retry after 5s
- Server errors (5xx): retry after 2s
- Auth errors (401, 403): don't retry
- Unknown errors: don't retry

## Integration Examples

### Dashboard Page with Error Handling

See `app/dashboard/page.tsx` for full implementation.

**Key additions:**
1. Error state: `const [error, setError] = useState<Error | null>(null);`
2. Try-catch in data loading: `try { ... } catch (err) { ... }`
3. Error logging: `logError(err, { component, action })`
4. Error display: `<ErrorAlert ... />`
5. ErrorBoundary wrapper: `<ErrorBoundary name="...">...</ErrorBoundary>`

### Form with Error Handling

```tsx
"use client";

import { useState } from "react";
import { logError } from "@/lib/error-handler";
import ErrorAlert from "@/components/ErrorAlert";

export default function MyForm() {
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Your form submission logic
      await submitForm();
    } catch (err) {
      logError(err, { component: "MyForm", action: "submit" });
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <ErrorAlert
          title="Submission Failed"
          message={error.message}
          variant="error"
          action={{
            label: "Try Again",
            onClick: handleSubmit,
          }}
        />
      )}
      {/* Form fields... */}
    </form>
  );
}
```

### API Error Handling

```tsx
async function fetchData() {
  try {
    const response = await fetch("/api/data");
    
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      logError(error, { action: "fetchData" });
      throw error;
    }

    return await response.json();
  } catch (err) {
    if (isNetworkError(err)) {
      // Handle network error
    }
    throw err;
  }
}
```

## Error Messages

All error messages are in Spanish (es-ES) for the user interface.

**Common Messages:**
- Network errors: "No hay conexión. Comprueba tu red e intenta de nuevo."
- Timeouts: "La solicitud tardó demasiado. Por favor, intenta de nuevo."
- Auth errors: "Tu sesión ha expirado. Por favor, inicia sesión de nuevo."
- Permission errors: "No tienes permisos para realizar esta acción."
- Not found: "El recurso solicitado no existe."
- Validation: "Los datos enviados no son válidos."
- Server errors: "Error del servidor. Por favor, intenta de nuevo más tarde."

## Supabase Error Codes

The system handles these Supabase-specific error codes:

| Code  | Meaning | Message |
|-------|---------|---------|
| PGRST116 | Not found | "Los datos solicitados no existen." |
| PGRST110 | Permission denied | "No tienes permisos para acceder a estos datos." |
| 42501 | Permission denied | "Error de permisos. Contacta con el administrador." |
| 23505 | Duplicate key | "Este registro ya existe." |

## HTTP Status Codes

Handled automatically:

| Status | Meaning | Message |
|--------|---------|---------|
| 401 | Unauthorized | "Tu sesión ha expirado..." |
| 403 | Forbidden | "No tienes permisos..." |
| 404 | Not found | "El recurso solicitado no existe." |
| 409 | Conflict | "Conflicto: los datos han cambiado..." |
| 422 | Invalid data | "Los datos enviados son inválidos." |
| 429 | Rate limited | "Demasiadas solicitudes..." |
| 5xx | Server error | "Error del servidor..." |

## Development Features

### Error Details View

In development mode, error boundaries show technical stack traces:

```tsx
<ErrorBoundary name="my-section" showDetails>
  {/* Component that might error */}
</ErrorBoundary>
```

This reveals error.stack for debugging.

### Console Logging

Development mode logs full error objects to console:
```
[ERROR] {
  timestamp: "2024-04-16T10:30:00Z",
  error: { name, message, stack, code },
  context: { component, action, ... }
}
```

## Production Considerations

### Error Tracking Integration (Future)

The `logError()` function has a placeholder for Sentry integration:

```tsx
// In production:
if (process.env.NODE_ENV === "production") {
  // TODO: Send to Sentry
  // captureException(error, { extra: context });
}
```

To enable Sentry:
1. Install: `npm install @sentry/react`
2. Initialize in `app.tsx` or similar
3. Uncomment and implement the Sentry call in `error-handler.ts`

### Privacy

Error messages are user-friendly and don't expose:
- Database structure
- Server paths
- API details
- Sensitive data

Technical details are only shown in development mode.

## Testing Error Handling

### Simulate Network Error
```tsx
// In browser console:
navigator.onLine = false;
```

### Simulate Timeout
```tsx
const controller = new AbortController();
setTimeout(() => controller.abort(), 100);
fetch(url, { signal: controller.signal });
```

### Simulate Supabase Error
```tsx
const mockError = new Error("User not found");
(mockError as any).code = "PGRST116";
throw mockError;
```

## Best Practices

1. **Always log errors** with context using `logError()`
2. **Use error boundaries** around risky components
3. **Show user-friendly messages** using `getErrorMessage()`
4. **Format for UI** using `formatErrorForUI()`
5. **Handle specific error types** with detection functions
6. **Provide retry options** when appropriate
7. **Test error paths** during development
8. **Monitor errors** in production (future Sentry integration)

## Files Modified/Created

### New Files
- `lib/error-handler.ts` - Error utilities and logging
- `components/ErrorAlert.tsx` - Reusable alert component
- `components/ErrorBoundary.tsx` - Reusable error boundary
- `app/error.tsx` - Global error boundary
- `app/dashboard/error.tsx` - Dashboard error boundary

### Modified Files
- `app/dashboard/page.tsx` - Added error state, try-catch, error display

## Next Steps

1. Test error boundaries with various error scenarios
2. Integrate Sentry for production error tracking
3. Add error monitoring dashboard
4. Create error recovery workflows
5. Test with real network failures and timeouts
