import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { visionPolicy } from "../lib/qa/vision";
import { readSettings } from "../lib/qa/store";
export async function createPolicy() {
  loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
  return visionPolicy(readSettings());
}
