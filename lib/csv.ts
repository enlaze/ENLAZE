/**
 * CSV export utilities.
 * Produces Excel-compatible CSV (UTF-8 BOM + CRLF line endings).
 */

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === "object") {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }
  // Quote if contains comma, quote, newline, or leading whitespace
  if (/[",\n\r]/.test(str) || /^\s|\s$/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * Serialize rows to an Excel-friendly CSV string.
 * @param rows  The data
 * @param columns  Column definitions with header + value accessor
 * @param separator  ',' by default; ';' is also common in ES-locale Excel
 */
export function rowsToCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  separator = ",",
): string {
  const headerLine = columns
    .map((c) => escapeCsvCell(c.header))
    .join(separator);
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsvCell(c.value(row))).join(separator),
  );
  // UTF-8 BOM so Excel recognizes special chars; CRLF for Windows/Excel.
  return "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
}

/**
 * Trigger a browser download of the given CSV content.
 */
export function downloadCsv(
  filename: string,
  csvContent: string,
): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.setAttribute("href", url);
  link.setAttribute("download", safeName);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Free the object URL after download is initiated
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Shortcut: build CSV and trigger download in one call.
 */
export function exportRowsToCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
  separator: string = ",",
): void {
  const content = rowsToCsv(rows, columns, separator);
  downloadCsv(filename, content);
}
