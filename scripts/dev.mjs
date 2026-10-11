import { spawn } from "node:child_process";
import { join } from "node:path";

let shuttingDown = false;
const processes = [];
const viteCommand = [process.execPath, [join("node_modules", "vite", "bin", "vite.js")]];

if (await isApiRunning()) {
  console.log("[api] Using existing API server: http://localhost:3000");
} else {
  processes.push(start("api", process.execPath, ["server.js"]));
}

processes.push(start("vite", viteCommand[0], viteCommand[1]));

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    shell: false
  });

  child.stdout.on("data", (chunk) => writeWithPrefix(process.stdout, name, chunk));
  child.stderr.on("data", (chunk) => writeWithPrefix(process.stderr, name, chunk));

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal || `code ${code ?? 0}`;
    console.log(`[${name}] stopped with ${reason}`);
    shutdown(code || 1);
  });

  return child;
}

function writeWithPrefix(stream, name, chunk) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line && index === lines.length - 1) return;
    stream.write(`[${name}] ${line}\n`);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of processes) {
    if (!child.killed) child.kill();
  }

  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function isApiRunning() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 700);
    const response = await fetch("http://localhost:3000/api/items", {
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
