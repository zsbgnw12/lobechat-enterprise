import { z, ZodTypeAny } from 'zod';
import { AuthContext } from '../auth/devAuth';

export interface ToolContext {
  auth: AuthContext;
}

export interface ToolAdapter {
  key: string;
  sourceSystem?: string;
  entityType?: string;
  idField?: string;
  applyFilter?: boolean; // default true if sourceSystem+entityType present
  inputSchema: ZodTypeAny;
  run(ctx: ToolContext, params: any): Promise<any[] | any>;
}

const registry = new Map<string, ToolAdapter>();

export function registerTool(a: ToolAdapter) {
  registry.set(a.key, a);
}

export function getTool(key: string): ToolAdapter | undefined {
  return registry.get(key);
}

export function listTools(): ToolAdapter[] {
  return Array.from(registry.values());
}

export { z };
