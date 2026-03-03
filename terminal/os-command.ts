import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function executeNodeOsCommand(command: string, args: string[], currentDirectory: string): string | undefined {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: currentDirectory
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`OS command not found: ${command}`);
    }

    throw new Error(`Failed to run OS command '${command}': ${result.error.message}`);
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(/[\r\n]+$/g, "");

  if (result.status !== null && result.status !== 0) {
    if (output.length > 0) {
      throw new Error(output);
    }

    throw new Error(`OS command '${command}' exited with code ${result.status}`);
  }

  return output.length > 0 ? output : undefined;
}

export function resolveNodeDirectory(path: string, currentDirectory: string): string {
  const nextDirectory = isAbsolute(path) ? path : resolve(currentDirectory, path);

  let stats;
  try {
    stats = statSync(nextDirectory);
  } catch {
    throw new Error(`Directory does not exist: ${nextDirectory}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${nextDirectory}`);
  }

  return nextDirectory;
}
