import type { ModelDef, ProviderDef } from '../catalog/types.js';
import { byteplus } from './byteplus/index.js';
import { minimax } from './minimax/index.js';

/** 新增服务商：在这里加一行 */
export const PROVIDERS: ProviderDef[] = [byteplus, minimax];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function getModel(modelId: string): { provider: ProviderDef; model: ModelDef } | undefined {
  for (const provider of PROVIDERS) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return { provider, model };
  }
  return undefined;
}

export function listModels(opts: { includeHidden?: boolean } = {}): { provider: ProviderDef; model: ModelDef }[] {
  return PROVIDERS.flatMap((provider) =>
    provider.models.filter((m) => opts.includeHidden || !m.lifecycle.hiddenByDefault).map((model) => ({ provider, model })),
  );
}
