export type PlaceHit = { plz: string; place: string };

export type CsvIssue = { line: number; message: string };

export type SquawkMap = ReadonlyMap<string, PlaceHit>;

export type LocalityMap = ReadonlyMap<string, string>;

export type ParseResult =
  | { ok: true; mapping: SquawkMap }
  | { ok: false; errors: CsvIssue[] };

const HEADER = "squawk,plz,place";

/** The AMTOVZ file names this column PLZ4. "PLZ 4.00" is the same 4-digit postal code. */
const PLZ_COLUMN_NAMES = ["PLZ 4.00", "PLZ4", "PLZ 4"];

const RESERVED_EMERGENCY = new Set(["7500", "7600", "7700"]);

export function isReservedEmergency(squawk: string): boolean {
  return RESERVED_EMERGENCY.has(squawk);
}

export function parseSquawkCsv(text: string): ParseResult {
  const errors: CsvIssue[] = [];
  const mapping = new Map<string, PlaceHit>();
  const rows = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, raw }))
    .filter((row) => row.raw.trim() !== "");

  if (rows.length === 0) {
    return { ok: false, errors: [{ line: 1, message: "CSV is empty" }] };
  }

  const header = rows[0];
  if (!header) {
    return { ok: false, errors: [{ line: 1, message: "CSV is empty" }] };
  }
  if (parseCsvLine(header.raw, ",").map((cell) => cell.trim()).join(",") !== HEADER) {
    errors.push({ line: header.line, message: `Header must be ${HEADER}` });
  }

  const seen = new Map<string, number>();
  let dataRows = 0;

  for (const row of rows.slice(1)) {
    const cells = parseCsvLine(row.raw, ",");
    if (cells.length !== 3) {
      errors.push({ line: row.line, message: "Expected 3 columns" });
      continue;
    }

    const squawk = cells[0]?.trim() ?? "";
    const plz = cells[1]?.trim() ?? "";
    const place = cells[2]?.trim() ?? "";
    let rowOk = true;

    if (!/^[0-7]{4}$/.test(squawk)) {
      errors.push({ line: row.line, message: `Invalid squawk "${squawk}"` });
      rowOk = false;
    }
    if (!/^\d{4}$/.test(plz)) {
      errors.push({ line: row.line, message: `Invalid PLZ "${plz}"` });
      rowOk = false;
    }
    if (place.length === 0) {
      errors.push({ line: row.line, message: "Place is empty" });
      rowOk = false;
    }
    if (!rowOk) continue;

    dataRows += 1;
    const firstLine = seen.get(squawk);
    if (firstLine !== undefined) {
      errors.push({
        line: row.line,
        message: `Duplicate squawk ${squawk} (first seen on line ${firstLine})`,
      });
      continue;
    }
    seen.set(squawk, row.line);
    mapping.set(squawk, { plz, place });
  }

  if (dataRows === 0) {
    errors.push({ line: header.line, message: "CSV has no data rows" });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, mapping };
}

export function lookupSquawk(mapping: SquawkMap, squawk: string): PlaceHit | null {
  return mapping.get(squawk) ?? null;
}

export function parseLocalityCsv(
  text: string,
): { ok: true; places: LocalityMap } | { ok: false; errors: CsvIssue[] } {
  const errors: CsvIssue[] = [];
  const rows = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, raw }))
    .filter((row) => row.raw.trim() !== "");

  if (rows.length === 0) {
    return { ok: false, errors: [{ line: 1, message: "Locality CSV is empty" }] };
  }

  const header = rows[0];
  if (!header) {
    return { ok: false, errors: [{ line: 1, message: "Locality CSV is empty" }] };
  }

  const headerCells = parseCsvLine(header.raw, ";").map((cell) => cell.trim());
  const plzIndex = PLZ_COLUMN_NAMES.map((name) => headerCells.indexOf(name)).find((index) => index >= 0) ?? -1;
  const placeIndex = headerCells.indexOf("Ortschaftsname");
  if (plzIndex < 0) {
    errors.push({ line: header.line, message: "Missing PLZ 4.00 column" });
  }
  if (placeIndex < 0) {
    errors.push({ line: header.line, message: "Missing Ortschaftsname column" });
  }
  if (errors.length > 0) return { ok: false, errors };

  const places = new Map<string, string>();
  const settled = new Set<string>();

  for (const row of rows.slice(1)) {
    const cells = parseCsvLine(row.raw, ";").map((cell) => cell.trim());
    const plz = cells[plzIndex] ?? "";
    const place = cells[placeIndex] ?? "";
    if (settled.has(plz)) continue;

    if (!/^\d{4}$/.test(plz) || place.length === 0) {
      errors.push({ line: row.line, message: `Invalid locality row for "${plz}"` });
      if (/^\d{4}$/.test(plz)) settled.add(plz);
      continue;
    }

    settled.add(plz);
    places.set(plz, place);
  }

  if (places.size === 0) {
    errors.push({ line: header.line, message: "Locality CSV has no postal codes" });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, places };
}

export function placeForPlz(places: LocalityMap, plz: string, fallback: string): string {
  return places.get(plz) ?? fallback;
}

/**
 * A squawk is written in octal. The postal code is that same numeral read as decimal,
 * so 7000 stays 7000 rather than being converted from base 8.
 */
export function squawkAsDecimalPlz(squawk: string): string | null {
  return /^[0-7]{4}$/.test(squawk) ? squawk : null;
}

/** Look up that decimal code in PLZ4. The place is the first row for the code. */
export function lookupPlz(places: LocalityMap, code: string): PlaceHit | null {
  const plz = squawkAsDecimalPlz(code);
  if (!plz) return null;
  const place = places.get(plz);
  if (!place) return null;
  return { plz, place };
}

export function formatCsvErrors(errors: readonly CsvIssue[]): string {
  return errors.map((error) => `line ${error.line}: ${error.message}`).join("\n");
}

export function assertCsvContract(text: string): void {
  const result = parseSquawkCsv(text);
  if (!result.ok) {
    throw new Error(`squawk-plz.csv failed the contract:\n${formatCsvErrors(result.errors)}`);
  }
}

function parseCsvLine(line: string, delimiter: "," | ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}
