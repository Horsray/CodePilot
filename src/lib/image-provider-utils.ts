import type { ProviderOptions } from '@/types';

export interface ImageProviderConfigShape {
  base_url?: string;
  extra_env?: string;
  env_overrides_json?: string;
  role_models_json?: string;
  options_json?: string;
}

export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
export const DEFAULT_MEDIA_RELAY_PROTOCOL = 'custom-image';

export type MediaRelayProtocol = NonNullable<ProviderOptions['media_protocol']>;

function parseJsonObject(raw?: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseProviderOptions(provider: Pick<ImageProviderConfigShape, 'options_json'>): ProviderOptions {
  return parseJsonObject(provider.options_json) as ProviderOptions;
}

function inferMediaRelayProtocol(provider: Pick<ImageProviderConfigShape, 'base_url'>): MediaRelayProtocol {
  const baseUrl = (provider.base_url || '').trim().toLowerCase();
  if (baseUrl.includes('api.whatai.cc')) {
    return 'openai-images';
  }
  return DEFAULT_MEDIA_RELAY_PROTOCOL;
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function joinApiPath(baseUrl: string, endpoint: string): string {
  const cleanedBase = baseUrl.trim().replace(/\/+$/, '');
  const cleanedEndpoint = endpoint.trim().replace(/^\/+/, '');

  if (!cleanedBase) {
    return cleanedEndpoint ? `/${cleanedEndpoint}` : '';
  }
  if (!cleanedEndpoint) {
    return cleanedBase;
  }
  return `${cleanedBase}/${cleanedEndpoint}`;
}

function inferOpenAiImagesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim();
  if (!normalized) {
    return '/v1/images/generations';
  }
  if (/\/v1\/images\/generations\/?$/i.test(normalized)) {
    return normalized;
  }
  if (/\/v1\/?$/i.test(normalized)) {
    return joinApiPath(normalized, 'images/generations');
  }
  return joinApiPath(normalized, '/v1/images/generations');
}

export function isOfficialGeminiImageProvider(provider: Pick<ImageProviderConfigShape, 'base_url'>): boolean {
  const baseUrl = (provider.base_url || '').trim().toLowerCase();
  return !baseUrl || baseUrl.includes('generativelanguage.googleapis.com');
}

export function parseModelNames(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map(name => name.trim())
    .filter(Boolean);
}

export function getMediaRelayProtocol(provider: Pick<ImageProviderConfigShape, 'base_url' | 'options_json'>): MediaRelayProtocol {
  const protocol = parseProviderOptions(provider).media_protocol;
  return protocol === 'openai-images'
    ? protocol
    : inferMediaRelayProtocol(provider);
}

export function getMediaRelayEndpoint(provider: Pick<ImageProviderConfigShape, 'options_json'>): string {
  const endpoint = parseProviderOptions(provider).media_endpoint;
  return typeof endpoint === 'string' ? endpoint.trim() : '';
}

export function resolveMediaRelayEndpoint(provider: Pick<ImageProviderConfigShape, 'base_url' | 'options_json'>): string {
  const baseUrl = (provider.base_url || '').trim();
  const configuredEndpoint = getMediaRelayEndpoint(provider);

  if (configuredEndpoint) {
    return isAbsoluteUrl(configuredEndpoint)
      ? configuredEndpoint
      : joinApiPath(baseUrl, configuredEndpoint);
  }

  if (getMediaRelayProtocol(provider) === 'openai-images') {
    return inferOpenAiImagesEndpoint(baseUrl);
  }

  return baseUrl;
}

export function getMediaRelayTargetSummary(provider: Pick<ImageProviderConfigShape, 'base_url' | 'options_json'>): string {
  const resolved = resolveMediaRelayEndpoint(provider);
  return resolved || (provider.base_url || '').trim();
}

export function getConfiguredImageModelNames(provider: ImageProviderConfigShape): string[] {
  const envOverrides = parseJsonObject(provider.env_overrides_json);
  const configured = parseModelNames(typeof envOverrides.model_names === 'string' ? envOverrides.model_names : '');
  if (configured.length > 0) {
    return configured;
  }

  const roleModels = parseJsonObject(provider.role_models_json);
  if (typeof roleModels.default === 'string' && roleModels.default.trim()) {
    return [roleModels.default.trim()];
  }

  const extraEnv = parseJsonObject(provider.extra_env);
  if (typeof extraEnv.GEMINI_IMAGE_MODEL === 'string' && extraEnv.GEMINI_IMAGE_MODEL.trim()) {
    return [extraEnv.GEMINI_IMAGE_MODEL.trim()];
  }

  return [];
}

export function getDefaultConfiguredImageModel(provider: ImageProviderConfigShape): string {
  const configured = getConfiguredImageModelNames(provider);
  if (configured.length > 0) {
    return configured[0];
  }

  if (isOfficialGeminiImageProvider(provider)) {
    return DEFAULT_GEMINI_IMAGE_MODEL;
  }

  return DEFAULT_GEMINI_IMAGE_MODEL;
}
