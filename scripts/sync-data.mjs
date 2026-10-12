import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "data.txt");
const target = join(root, "public", "data.txt");

if (!existsSync(source)) {
  console.warn("[data] data.txt not found, static frontend will not have products.");
  process.exit(0);
}

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log("[data] synced data.txt -> public/data.txt");
