export interface LangFunctionDefinition {
  name: string;
  parameters: string[];
  body: string;
}

export interface ExpressionRuntimeEnvironment {
  variables: Record<string, number>;
  localVariables: Record<string, number>;
  commands: Map<string, unknown>;
  expressionFunctions: Map<string, LangFunctionDefinition>;
}
