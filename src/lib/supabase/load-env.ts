import { config as loadDotEnv } from "dotenv";

let loaded = false;

export function ensureEnvLoaded(): void {
  if (loaded) {
    return;
  }

  loadDotEnv({ path: ".env.local" });
  loadDotEnv();
  loaded = true;
}

export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
