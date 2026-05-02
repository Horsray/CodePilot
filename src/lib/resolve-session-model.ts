/**
 * Resolve the effective model and provider for a session.
 *
 * Priority:
 * 1. Session's stored model (if non-empty)
 * 2. Global default model — only if it belongs to the session's provider (or session has no provider)
 * 3. First available model within the session's provider
 * 4. Global default model + provider (when session has neither)
 * 5. localStorage last-used model (cross-session fallback)
 * 6. 'sonnet' hardcoded fallback
 *
 * The session's provider_id is never overwritten by a different provider's global default.
 */

type ModelGroup = { provider_id: string; models: Array<{ value: string }> };

interface ResolveContext {
  globalModel: string;
  globalProvider: string;
  groups: ModelGroup[];
  lsModel: string;
  lsProvider: string;
}

/**
 * Pure resolution logic — no I/O, fully testable.
 *
 * IMPORTANT: Always returns the providerId that owns the resolved model.
 * The warmup API needs both model AND providerId to compute the correct
 * signature. Returning an empty providerId forces the warmup API to
 * resolve the provider through its fallback chain, which may pick a
 * DIFFERENT provider than the one that owns the model — causing signature
 * MISMATCH and cold starts on every message.
 */
export function resolveSessionModelPure(
  sessionModel: string,
  sessionProviderId: string,
  ctx: ResolveContext,
): { model: string; providerId: string } {
  const { globalModel, globalProvider, groups, lsModel, lsProvider } = ctx;

  console.log('[resolveSessionModel] Input:', { sessionModel, sessionProviderId, globalModel, globalProvider, groupsCount: groups.length, lsModel, lsProvider });

  // Session already has a model — use it as-is, but ensure providerId is set.
  if (sessionModel) {
    // If the session has a provider, return both
    if (sessionProviderId) {
      console.log('[resolveSessionModel] → Case A: session has model+provider', { model: sessionModel, providerId: sessionProviderId });
      return { model: sessionModel, providerId: sessionProviderId };
    }
    // Session has a model but NO provider — find which provider owns this model.
    for (const g of groups) {
      if (g.models.some(m => m.value === sessionModel)) {
        console.log('[resolveSessionModel] → Case B: session has model, found provider in groups', { model: sessionModel, providerId: g.provider_id });
        return { model: sessionModel, providerId: g.provider_id };
      }
    }
    console.log('[resolveSessionModel] → Case C: session has model, NO provider found in groups', { model: sessionModel });
    return { model: sessionModel, providerId: '' };
  }

  // Case 1: Session has a provider — resolve model within that provider
  if (sessionProviderId) {
    const sessionGroup = groups.find(g => g.provider_id === sessionProviderId);

    if (globalModel && globalProvider === sessionProviderId) {
      const valid = sessionGroup?.models.some(m => m.value === globalModel);
      if (valid) {
        console.log('[resolveSessionModel] → Case D: session provider + global model match', { model: globalModel, providerId: sessionProviderId });
        return { model: globalModel, providerId: sessionProviderId };
      }
    }

    if (sessionGroup?.models?.length) {
      console.log('[resolveSessionModel] → Case E: session provider, first model', { model: sessionGroup.models[0].value, providerId: sessionProviderId });
      return { model: sessionGroup.models[0].value, providerId: sessionProviderId };
    }
  }

  // Case 2: Session has no provider — use global default.
  if (globalModel) {
    if (globalProvider) {
      console.log('[resolveSessionModel] → Case F: global model + provider', { model: globalModel, providerId: globalProvider });
      return { model: globalModel, providerId: globalProvider };
    }
    for (const g of groups) {
      if (g.models.some(m => m.value === globalModel)) {
        console.log('[resolveSessionModel] → Case G: global model found in groups', { model: globalModel, providerId: g.provider_id });
        return { model: globalModel, providerId: g.provider_id };
      }
    }
    console.log('[resolveSessionModel] → Case H: global model NOT in any group', { model: globalModel, groupModels: groups.map(g => ({ pid: g.provider_id.slice(0,8), models: g.models.map(m => m.value) })) });
    return { model: globalModel, providerId: '' };
  }

  // Case 3: No global default either — localStorage last-used
  console.log('[resolveSessionModel] → Case I: fallback to localStorage/sonnet', { model: lsModel || 'sonnet', providerId: lsProvider || '' });
  return {
    model: lsModel || 'sonnet',
    providerId: lsProvider || '',
  };
}

/**
 * Fetch-based wrapper for use in components. Gathers context then delegates to pure function.
 */
export async function resolveSessionModel(
  sessionModel: string,
  sessionProviderId: string,
): Promise<{ model: string; providerId: string }> {
  // Session already has both model and provider — no fetches needed
  if (sessionModel && sessionProviderId) {
    return { model: sessionModel, providerId: sessionProviderId };
  }

  let globalModel = '';
  let globalProvider = '';
  let groups: ModelGroup[] = [];

  try {
    const [globalRes, modelsRes] = await Promise.all([
      fetch('/api/providers/options?providerId=__global__').catch(e => { console.warn('[resolveSessionModel] global fetch failed:', e); return null; }),
      fetch('/api/providers/models').catch(e => { console.warn('[resolveSessionModel] models fetch failed:', e); return null; }),
    ]);

    if (globalRes && 'ok' in globalRes && globalRes.ok) {
      const globalData = await globalRes.json().catch(() => null);
      globalModel = globalData?.options?.default_model || '';
      globalProvider = globalData?.options?.default_model_provider || '';
      console.log('[resolveSessionModel] Fetched global:', { globalModel, globalProvider, raw: globalData?.options });
    } else {
      console.warn('[resolveSessionModel] Global fetch response:', { ok: (globalRes as Response | null)?.ok, status: (globalRes as Response | null)?.status });
    }
    if (modelsRes && 'ok' in modelsRes && modelsRes.ok) {
      const data = await modelsRes.json().catch(() => null);
      groups = (data?.groups as ModelGroup[]) || [];
      console.log('[resolveSessionModel] Fetched groups:', groups.map(g => ({ provider_id: g.provider_id.slice(0, 8) + '***', modelCount: g.models.length, models: g.models.map(m => m.value) })));
    } else {
      console.warn('[resolveSessionModel] Models fetch response:', { ok: (modelsRes as Response | null)?.ok, status: (modelsRes as Response | null)?.status });
    }
  } catch (err) { console.warn('[resolveSessionModel] Fetch error:', err); }

  const lsModel = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') : null;
  const lsProvider = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') : null;

  return resolveSessionModelPure(sessionModel, sessionProviderId, {
    globalModel,
    globalProvider,
    groups,
    lsModel: lsModel || '',
    lsProvider: lsProvider || '',
  });
}
