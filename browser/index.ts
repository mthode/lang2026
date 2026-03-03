import { ReplEngine } from "../repl/index.js";
import { createShellEnvironment, createShellReplCallbacks } from "../shell/index.js";

export interface BrowserReplOptions {
  input: HTMLInputElement | HTMLTextAreaElement;
  output: HTMLElement;
}

export function attachBrowserRepl(options: BrowserReplOptions): void {
  const environment = createShellEnvironment();
  const engine = new ReplEngine(createShellReplCallbacks(environment));

  options.input.addEventListener("keydown", async (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== "Enter") return;
    keyboardEvent.preventDefault();

    const line = options.input.value;
    options.input.value = "";

    try {
      const result = await engine.evaluate(line);
      const text = result.pending ? "..." : result.output ?? "ok";

      const row = document.createElement("div");
      row.textContent = text;
      options.output.appendChild(row);
      options.output.scrollTop = options.output.scrollHeight;
    } catch (error) {
      const row = document.createElement("div");
      row.textContent = `error: ${error instanceof Error ? error.message : String(error)}`;
      row.style.color = "#fca5a5";
      options.output.appendChild(row);
      options.output.scrollTop = options.output.scrollHeight;
    }
  });
}
