"use client";

import type { ReactNode } from "react";
import { HardDrives } from "@/components/ui/icon";
import type { ApiProvider } from "@/types";
import { VENDOR_PRESETS } from "@/lib/provider-catalog";
import type { VendorPreset } from "@/lib/provider-catalog";
import Anthropic from "@lobehub/icons/es/Anthropic";
import OpenRouter from "@lobehub/icons/es/OpenRouter";
import Zhipu from "@lobehub/icons/es/Zhipu";
import Kimi from "@lobehub/icons/es/Kimi";
import Moonshot from "@lobehub/icons/es/Moonshot";
import Minimax from "@lobehub/icons/es/Minimax";
import Aws from "@lobehub/icons/es/Aws";
import Bedrock from "@lobehub/icons/es/Bedrock";
import Google from "@lobehub/icons/es/Google";
import Volcengine from "@lobehub/icons/es/Volcengine";
import Bailian from "@lobehub/icons/es/Bailian";
import XiaomiMiMo from "@lobehub/icons/es/XiaomiMiMo";
import Ollama from "@lobehub/icons/es/Ollama";

// ---------------------------------------------------------------------------
// Brand icon resolver
// ---------------------------------------------------------------------------

/** Map a provider name / base_url to a brand icon */
export function getProviderIcon(name: string, baseUrl: string): ReactNode {
  const lower = name.toLowerCase();
  const url = baseUrl.toLowerCase();

  if (lower.includes("openrouter")) return <OpenRouter size={18} />;
  if (url.includes("bigmodel.cn") || url.includes("z.ai") || lower.includes("glm") || lower.includes("zhipu") || lower.includes("chatglm"))
    return <Zhipu size={18} />;
  if (url.includes("kimi.com") || lower.includes("kimi")) return <Kimi size={18} />;
  if (url.includes("moonshot") || lower.includes("moonshot")) return <Moonshot size={18} />;
  if (url.includes("minimax") || lower.includes("minimax")) return <Minimax size={18} />;
  if (url.includes("volces.com") || url.includes("volcengine") || lower.includes("volcengine") || lower.includes("火山") || lower.includes("doubao") || lower.includes("豆包"))
    return <Volcengine size={18} />;
  if (url.includes("dashscope") || lower.includes("bailian") || lower.includes("百炼") || lower.includes("aliyun"))
    return <Bailian size={18} />;
  if (url.includes("xiaomimimo") || lower.includes("mimo") || lower.includes("小米"))
    return <XiaomiMiMo size={18} />;
  if (url.includes("11434") || lower.includes("ollama")) return <Ollama size={18} />;
  if (lower.includes("bedrock")) return <Bedrock size={18} />;
  if (lower.includes("vertex") || lower.includes("google")) return <Google size={18} />;
  if (lower.includes("aws")) return <Aws size={18} />;
  if (lower.includes("anthropic") || url.includes("anthropic")) return <Anthropic size={18} />;

  return <HardDrives size={18} className="text-muted-foreground" />;
}

// ---------------------------------------------------------------------------
// Quick-add preset definitions — generated from VENDOR_PRESETS (single source of truth)
// ---------------------------------------------------------------------------

export interface QuickPreset {
  key: string;
  name: string;
  description: string;
  descriptionZh: string;
  icon: ReactNode;
  provider_type: string;
  protocol: string;
  /** Auth style from catalog — frontend should use this instead of inferring from extra_env */
  authStyle: string;
  base_url: string;
  extra_env: string;
  fields: ("name" | "api_key" | "base_url" | "extra_env" | "model_names" | "model_mapping")[];
  category?: "chat" | "media";
  /** Provider meta info from catalog (for user guidance) */
  meta?: VendorPreset['meta'];
}

/** Map iconKey from VENDOR_PRESETS to React icon component */
function resolveIcon(iconKey: string): ReactNode {
  const ICON_MAP: Record<string, ReactNode> = {
    anthropic: <Anthropic size={18} />,
    openrouter: <OpenRouter size={18} />,
    zhipu: <Zhipu size={18} />,
    kimi: <Kimi size={18} />,
    moonshot: <Moonshot size={18} />,
    minimax: <Minimax size={18} />,
    bedrock: <Bedrock size={18} />,
    google: <Google size={18} />,
    volcengine: <Volcengine size={18} />,
    bailian: <Bailian size={18} />,
    'xiaomi-mimo': <XiaomiMiMo size={18} />,
    ollama: <Ollama size={18} />,
    server: <HardDrives size={18} className="text-muted-foreground" />,
  };
  return ICON_MAP[iconKey] || <HardDrives size={18} className="text-muted-foreground" />;
}

/** Convert a VendorPreset to the frontend QuickPreset format */
function toQuickPreset(vp: VendorPreset): QuickPreset {
  const providerType = vp.key === 'custom-media'
    ? 'generic-image'
    : vp.key === 'cc-switch'
      ? 'cc-switch'
      : vp.protocol === 'openrouter'
        ? 'openrouter'
        : vp.protocol === 'bedrock'
          ? 'bedrock'
          : vp.protocol === 'vertex'
            ? 'vertex'
            : vp.protocol === 'gemini-image'
              ? 'gemini-image'
              : 'anthropic';

  return {
    key: vp.key,
    name: vp.name,
    description: vp.description,
    descriptionZh: vp.descriptionZh,
    icon: resolveIcon(vp.iconKey),
    provider_type: providerType,
    protocol: vp.protocol,
    authStyle: vp.authStyle,
    base_url: vp.baseUrl,
    extra_env: JSON.stringify(vp.defaultEnvOverrides),
    fields: vp.fields as QuickPreset['fields'],
    category: vp.category,
    meta: vp.meta,
  };
}

export const QUICK_PRESETS: QuickPreset[] = VENDOR_PRESETS.map(toQuickPreset);

// ---------------------------------------------------------------------------
// Gemini image model definitions
// ---------------------------------------------------------------------------

export const GEMINI_IMAGE_MODELS = [
  { value: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2' },
  { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
  { value: 'gemini-2.5-flash-image', label: 'Nano Banana' },
];

export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

export function getGeminiImageModel(provider: ApiProvider): string {
  try {
    const env = JSON.parse(provider.extra_env || '{}');
    return env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_IMAGE_MODEL;
  } catch {
    return DEFAULT_GEMINI_IMAGE_MODEL;
  }
}

// ---------------------------------------------------------------------------
// Preset matcher — find which quick preset a provider was created from
// ---------------------------------------------------------------------------

export function findMatchingPreset(provider: ApiProvider): QuickPreset | undefined {
  // Exact base_url match (most specific)
  if (provider.base_url) {
    const match = QUICK_PRESETS.find(p => p.base_url && p.base_url === provider.base_url);
    if (match) return match;
  }
  // Type-based fallback for known types
  if (provider.provider_type === "bedrock") return QUICK_PRESETS.find(p => p.key === "bedrock");
  if (provider.provider_type === "vertex") return QUICK_PRESETS.find(p => p.key === "vertex");
  if (provider.provider_type === "openrouter") return QUICK_PRESETS.find(p => p.key === "openrouter");
  if (provider.provider_type === "gemini-image") return QUICK_PRESETS.find(p => p.key === "gemini-image");
  if (provider.provider_type === "generic-image") return QUICK_PRESETS.find(p => p.key === "custom-media");
  if (provider.provider_type === "cc-switch") return QUICK_PRESETS.find(p => p.key === "cc-switch");
  if (provider.provider_type === "anthropic" && provider.base_url === "https://api.anthropic.com") {
    return QUICK_PRESETS.find(p => p.key === "anthropic-official");
  }
  // Anthropic-type with custom base_url → anthropic-thirdparty
  if (provider.provider_type === "anthropic" && provider.base_url) {
    return QUICK_PRESETS.find(p => p.key === "anthropic-thirdparty");
  }
  // Custom providers no longer have a matching preset (OpenAI-compatible removed).
  // They are deleted during DB migration; any survivors use the generic edit form.
  return undefined;
}
