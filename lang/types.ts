export class LangFunctionDefinition {
  constructor(
    readonly name: string,
    readonly parameters: string[],
    readonly body: string
  ) {}
}

export interface ExpressionRuntimeEnvironment {
  variables: Record<string, number>;
  localVariables: Record<string, number>;
  commands: Map<string, unknown>;
  expressionFunctions: Map<string, LangFunctionDefinition>;
}
