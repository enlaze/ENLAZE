/**
 * Vendor type stubs for packages that may or may not be installed.
 * Remove individual declarations once the corresponding package is installed.
 */

// xlsx (SheetJS) — install: npm install xlsx
declare module "xlsx" {
  export function read(data: ArrayBuffer | string, opts?: Record<string, unknown>): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  export const utils: {
    sheet_to_json<T = unknown>(sheet: unknown, opts?: Record<string, unknown>): T[];
  };
}
