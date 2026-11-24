import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCsvContract,
  closestPlz,
  isReservedEmergency,
  lookupPlz,
  lookupSquawk,
  squawkAsDecimalPlz,
  parseLocalityCsv,
  parseSquawkCsv,
  placeForPlz,
} from "./lookup";

const shipped = readFileSync(new URL("../data/squawk-plz.csv", import.meta.url), "utf8");
const localities = readFileSync(new URL("../data/AMTOVZ_CSV_LV95.csv", import.meta.url), "utf8");

describe("parseSquawkCsv", () => {
  it("loads the shipped example table", () => {
    const result = parseSquawkCsv(shipped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mapping.size).toBeGreaterThan(0);
    for (const hit of result.mapping.values()) {
      expect(hit.place.startsWith("EXAMPLE")).toBe(true);
    }
    expect(lookupSquawk(result.mapping, "7000")).toEqual({ plz: "8001", place: "EXAMPLE Zurich" });
    expect(lookupSquawk(result.mapping, "7777")).toBeNull();
  });

  it("accepts quoted places", () => {
    const result = parseSquawkCsv('squawk,plz,place\n0002,3000,"EXAMPLE Place, City"\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(lookupSquawk(result.mapping, "0002")?.place).toBe("EXAMPLE Place, City");
  });

  it("rejects a bad squawk, a bad PLZ, an empty file, and a header-only file", () => {
    expect(parseSquawkCsv("squawk,plz,place\n0008,3000,EXAMPLE\n").ok).toBe(false);
    expect(parseSquawkCsv("squawk,plz,place\n0001,300,EXAMPLE\n").ok).toBe(false);
    expect(parseSquawkCsv("squawk,plz,place\n0001,3000,\n").ok).toBe(false);
    expect(parseSquawkCsv("").ok).toBe(false);
    expect(parseSquawkCsv("squawk,plz,place\n").ok).toBe(false);
  });

  it("rejects a duplicate squawk", () => {
    const result = parseSquawkCsv(
      "squawk,plz,place\n0001,3000,EXAMPLE Bern\n0001,4000,EXAMPLE Other\n",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.message.includes("Duplicate squawk 0001"))).toBe(true);
  });

  it("throws from the build contract on a bad table", () => {
    expect(() => assertCsvContract("squawk,plz,place\n")).toThrow(/no data rows/);
    expect(() => assertCsvContract(shipped)).not.toThrow();
  });
});

describe("parseLocalityCsv", () => {
  it("keeps the first row for each PLZ4 code", () => {
    const result = parseLocalityCsv(localities);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.places.get("1000")).toBe("Lausanne 25");
    expect(result.places.get("1008")).toBe("Prilly");
    expect(result.places.get("8001")).toBe("Zürich");
    expect(result.places.get("1201")).toBe("Genève");
    expect(result.places.has("3000")).toBe(false);
    expect(result.places.get("1008")).toBe("Prilly");
    expect(squawkAsDecimalPlz("7000")).toBe("7000");
    expect(squawkAsDecimalPlz("1008")).toBeNull();
    expect(lookupPlz(result.places, "7000")).toEqual({ plz: "7000", place: "Chur" });
    expect(lookupPlz(result.places, "1000")).toEqual({ plz: "1000", place: "Lausanne 25" });
    expect(lookupPlz(result.places, "4001")).toEqual({ plz: "4001", place: "Basel" });
    expect(lookupPlz(result.places, "1008")).toBeNull();
    expect(lookupPlz(result.places, "1200")).toBeNull();
    expect(closestPlz(result.places, "7000")).toEqual({ plz: "7000", place: "Chur" });
    expect(closestPlz(result.places, "1200")?.plz).toBe(nearestKnown(result.places, 1200));
    expect(closestPlz(result.places, "0100")).toEqual({ plz: "1000", place: "Lausanne 25" });
    expect(closestPlz(result.places, "1238")).toBeNull();
    expect(placeForPlz(result.places, "8001", "EXAMPLE Zurich")).toBe("Zürich");
    expect(placeForPlz(result.places, "3000", "EXAMPLE Bern")).toBe("EXAMPLE Bern");
  });

  it("ignores later rows for a postal code that already has a name", () => {
    const result = parseLocalityCsv(
      "Ortschaftsname;PLZ 4.00\nPrilly;1008\nJouxtens-Mézery;1008\n",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.places.get("1008")).toBe("Prilly");
  });
});

describe("isReservedEmergency", () => {
  it("flags 7500, 7600, and 7700 only", () => {
    expect(isReservedEmergency("7500")).toBe(true);
    expect(isReservedEmergency("7600")).toBe(true);
    expect(isReservedEmergency("7700")).toBe(true);
    expect(isReservedEmergency("7000")).toBe(false);
  });
});

function nearestKnown(places: ReadonlyMap<string, string>, target: number): string {
  for (let distance = 0; ; distance += 1) {
    for (const candidate of [target - distance, target + distance]) {
      const plz = String(candidate).padStart(4, "0");
      if (places.has(plz)) return plz;
    }
  }
}
