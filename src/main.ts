import { registerSW } from "virtual:pwa-register";
import localityText from "../data/AMTOVZ_CSV_LV95.csv?raw";
import { parseLocalityCsv } from "./lookup";
import { mountApp } from "./ui";
import "./styles.css";

if (location.protocol !== "file:") {
  registerSW({ immediate: true });
}

const root = document.querySelector<HTMLElement>("#app");
const localities = parseLocalityCsv(localityText);

if (!root) {
  throw new Error("Missing #app");
}

if (!localities.ok) {
  root.textContent = "The postal-code table failed to load.";
  throw new Error("Invalid bundled locality CSV");
}

mountApp(root, localities.places);
