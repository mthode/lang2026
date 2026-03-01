import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createShellEnvironment, createShellRuntime, executeShellCommand } from "../shell/index.js";

export async function runScriptFile(scriptPathArg: string, writeOutput: (text: string) => void = (text) => process.stdout.write(text)): Promise<void> {
  const scriptPath = resolve(process.cwd(), scriptPathArg);
  const source = await readFile(scriptPath, "utf8");
  const environment = createShellEnvironment();

  const runtime = createShellRuntime((statement) => {
    const output = executeShellCommand(statement, environment);
    if (output !== undefined) {
      writeOutput(`${output}\n`);
    }
  });

  await runtime.execute(source);
}

async function main(): Promise<void> {
  const scriptPathArg = process.argv[2];
  if (!scriptPathArg) {
    throw new Error("Usage: npm run run:script -- <path-to-script-file>");
  }

  await runScriptFile(scriptPathArg);
}

const isCli = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isCli) {
  await main();
}
