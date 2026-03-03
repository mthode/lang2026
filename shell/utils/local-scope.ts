import type { ShellEnvironment } from "../commands/types.js";

export function withLocalVariables<T>(
  environment: ShellEnvironment,
  variables: Record<string, number>,
  run: () => T
): T {
  const previous = environment.localVariables;
  environment.localVariables = { ...previous, ...variables };

  try {
    return run();
  } finally {
    environment.localVariables = previous;
  }
}
