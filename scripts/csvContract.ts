import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { assertCsvContract } from "../src/lookup";

const csvPath = resolve(process.cwd(), "data/squawk-plz.csv");

export function csvContractPlugin(): Plugin {
  return {
    name: "squawk-csv-contract",
    buildStart() {
      assertCsvContract(readFileSync(csvPath, "utf8"));
    },
  };
}
