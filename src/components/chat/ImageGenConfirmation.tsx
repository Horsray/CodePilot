'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageGenCard } from './ImageGenCard';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import type { TranslationKey } from '@/i18n';
import type { ReferenceImage } from '@/types';
import type { ImageGenResult } from '@/hooks/useImageGen';
import {
  getConfiguredImageModelNames,
  getMediaRelayProtocol,
  getMediaRelayTargetSummary,
  isOfficialGeminiImageProvider,
} from '@/lib/image-provider-utils';

const ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9',
] as const;

const RESOLUTIONS = ['1K', '2K', '4K'] as const;

interface ImageGenConfirmationProps {
  messageId?: string;
  sessionId?: string;
  initialPrompt: string;
  initialAspectRatio: string;
  initialResolution: string;
  /** The original raw ```image-gen-request...``` block — used for exact DB matching */
  rawRequestBlock?: string;
  referenceImages?: ReferenceImage[];
}

type Status = 'idle' | 'generating' | 'completed' | 'error';

interface MediaProviderOption {
  id: string;
  name: string;
  providerType: string;
  protocol: string;
  baseUrl: string;
  envOverridesJson: string;
  roleModelsJson: string;
  extraEnv: string;
  optionsJson: string;
}

const LAST_IMAGE_PROVIDER_KEY = 'codepilot:last-image-provider-id';
const LAST_IMAGE_MODEL_KEY_PREFIX = 'codepilot:last-image-model:';

function isMediaProvider(provider: { provider_type: string; protocol: string; api_key: string }): boolean {
  return !!provider.api_key && (
    provider.protocol === 'gemini-image' ||
    provider.provider_type === 'gemini-image' ||
    provider.provider_type === 'generic-image'
  );
}

function describeProvider(option: MediaProviderOption): string {
  const url = option.baseUrl.toLowerCase();
  return url.includes('generativelanguage.googleapis.com') || !url
    ? 'Google Gemini'
    : option.name;
}

export function ImageGenConfirmation({
  messageId,
  sessionId: sessionIdProp,
  initialPrompt,
  initialAspectRatio,
  initialResolution,
  rawRequestBlock,
  referenceImages,
}: ImageGenConfirmationProps) {
  const { t } = useTranslation();
  const isZh = t('nav.chats' as TranslationKey) === '对话';
  const { sessionId: panelSessionId } = usePanel();
  const sessionId = sessionIdProp || panelSessionId;
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aspectRatio, setAspectRatio] = useState(
    ASPECT_RATIOS.includes(initialAspectRatio as typeof ASPECT_RATIOS[number])
      ? initialAspectRatio
      : '1:1'
  );
  const [resolution, setResolution] = useState(
    RESOLUTIONS.includes(initialResolution as typeof RESOLUTIONS[number])
      ? initialResolution
      : '1K'
  );
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ImageGenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerOptions, setProviderOptions] = useState<MediaProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providersLoading, setProvidersLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProvidersLoading(true);

    fetch('/api/providers')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled) return;
        const options: MediaProviderOption[] = Array.isArray(data?.providers)
          ? data.providers
            .filter(isMediaProvider)
            .map((provider: {
              id: string;
              name: string;
              provider_type: string;
              protocol: string;
              base_url: string;
              env_overrides_json?: string;
              role_models_json?: string;
              extra_env?: string;
              options_json?: string;
            }) => ({
              id: provider.id,
              name: provider.name,
              providerType: provider.provider_type,
              protocol: provider.protocol,
              baseUrl: provider.base_url || '',
              envOverridesJson: provider.env_overrides_json || '',
              roleModelsJson: provider.role_models_json || '',
              extraEnv: provider.extra_env || '',
              optionsJson: provider.options_json || '',
            }))
          : [];
        setProviderOptions(options);

        const saved = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_IMAGE_PROVIDER_KEY) : null;
        const initial = (saved && options.some(option => option.id === saved))
          ? saved
          : options[0]?.id || '';
        setSelectedProviderId(initial);
      })
      .catch(() => {
        if (!cancelled) {
          setProviderOptions([]);
          setSelectedProviderId('');
        }
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProvider = providerOptions.find(option => option.id === selectedProviderId);
  const providerModelOptions = useMemo(
    () => selectedProvider
      ? getConfiguredImageModelNames({
        base_url: selectedProvider.baseUrl,
        env_overrides_json: selectedProvider.envOverridesJson,
        role_models_json: selectedProvider.roleModelsJson,
        extra_env: selectedProvider.extraEnv,
      })
      : [],
    [selectedProvider]
  );
  const showModelSelector = !!selectedProvider
    && !isOfficialGeminiImageProvider({ base_url: selectedProvider.baseUrl })
    && providerModelOptions.length > 0;
  const [selectedModel, setSelectedModel] = useState('');

  const handleProviderChange = useCallback((value: string) => {
    setSelectedProviderId(value);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_IMAGE_PROVIDER_KEY, value);
    }
  }, []);

  useEffect(() => {
    if (!selectedProvider) {
      setSelectedModel('');
      return;
    }

    if (isOfficialGeminiImageProvider({ base_url: selectedProvider.baseUrl })) {
      setSelectedModel('');
      return;
    }

    const saved = typeof window !== 'undefined'
      ? window.localStorage.getItem(`${LAST_IMAGE_MODEL_KEY_PREFIX}${selectedProvider.id}`)
      : null;
    const initialModel = (saved && providerModelOptions.includes(saved))
      ? saved
      : providerModelOptions[0] || '';
    setSelectedModel(initialModel);
  }, [providerModelOptions, selectedProvider]);

  const handleModelChange = useCallback((value: string) => {
    setSelectedModel(value);
    if (selectedProvider && typeof window !== 'undefined') {
      window.localStorage.setItem(`${LAST_IMAGE_MODEL_KEY_PREFIX}${selectedProvider.id}`, value);
    }
  }, [selectedProvider]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus('idle');
  }, []);

  const handleGenerate = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('generating');
    setError(null);

    try {
      // Split unified ReferenceImage[] back into base64 data vs file paths for the API
      const refData = referenceImages?.filter(r => r.data).map(r => ({ mimeType: r.mimeType, data: r.data! }));
      const refPaths = referenceImages?.filter(r => r.localPath).map(r => r.localPath!);

      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          ...(showModelSelector && selectedModel ? { model: selectedModel } : {}),
          aspectRatio,
          imageSize: resolution,
          ...(selectedProviderId ? { providerId: selectedProviderId } : {}),
          sessionId,
          ...(refData && refData.length > 0
            ? { referenceImages: refData }
            : {}),
          ...(refPaths && refPaths.length > 0
            ? { referenceImagePaths: refPaths }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        throw new Error(err.error || 'Generation failed');
      }

      const data = await res.json();
      const genResult: ImageGenResult = {
        id: data.id,
        text: data.text,
        model: data.model,
        providerId: data.providerId,
        providerName: data.providerName,
        providerLabel: data.providerLabel,
        images: data.images || [],
      };

      if (genResult.images.length > 0) {
        setResult(genResult);
        setStatus('completed');

        // Persist result to DB by replacing image-gen-request with image-gen-result.
        // During streaming the assistant message may not yet be in DB (no messageId),
        // so retry once after a short delay to give the stream time to complete.
        {
          const resultBlock = JSON.stringify({
            status: 'completed',
            prompt,
            aspectRatio,
            resolution,
            model: genResult.model,
            providerName: genResult.providerName || selectedProvider?.name,
            images: genResult.images.map(img => ({
              mimeType: img.mimeType,
              localPath: img.localPath,
            })),
          });
          const persistBody = {
            message_id: messageId || '',
            content: '```image-gen-result\n' + resultBlock + '\n```',
            session_id: sessionId,
            prompt_hint: initialPrompt,
            // Pass the raw block for exact content matching when messageId is unavailable
            raw_request_block: rawRequestBlock,
          };
          const doPut = () => fetch('/api/chat/messages', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(persistBody),
          });
          doPut().then(r => {
            if (!r.ok && !messageId) {
              // Retry after 3s — message should be persisted by then
              setTimeout(() => doPut().catch(() => {}), 3000);
            }
          }).catch(() => {
            if (!messageId) {
              setTimeout(() => doPut().catch(() => {}), 3000);
            }
          });
        }

        // Defer event dispatch so React commits setResult/setStatus before
        // ChatView's handler calls sendMessage and triggers a re-render
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('image-gen-completed', {
            detail: {
              prompt,
              aspectRatio,
              resolution,
              id: genResult.id,
              images: genResult.images,
            },
          }));
        }, 0);
      } else {
        setError('No images were generated');
        setStatus('error');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus('idle');
        return;
      }
      setError((err as Error).message || 'Generation failed');
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  }, [prompt, selectedModel, showModelSelector, aspectRatio, resolution, selectedProviderId, selectedProvider?.name, initialPrompt, sessionId, messageId, referenceImages]);

  const handleRegenerate = useCallback(() => {
    setResult(null);
    setStatus('idle');
  }, []);

  // ── Completed: show result only ──
  if (status === 'completed' && result && result.images.length > 0) {
    return (
      <div className="my-2">
        <ImageGenCard
          images={result.images}
          prompt={prompt}
          aspectRatio={aspectRatio}
          imageSize={resolution}
          model={result.model}
          providerName={result.providerName}
          onRegenerate={handleRegenerate}
          referenceImages={referenceImages?.filter(r => r.data).map(r => ({ mimeType: r.mimeType, data: r.data! }))}
        />
      </div>
    );
  }

  // ── Idle / Generating / Error: show params card ──
  return (
    <div className="rounded-lg border border-border/50 bg-card overflow-hidden my-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30 bg-muted/30">
        <span className="text-sm font-medium">{t('imageGen.confirmTitle' as TranslationKey)}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* Reference images preview — unified loop over all reference images */}
        {referenceImages && referenceImages.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('imageGen.referenceImages' as TranslationKey)}
            </label>
            <div className="flex gap-2 flex-wrap">
              {referenceImages.map((img, i) => (
                <div key={i} className="w-16 h-16 rounded-md border border-border/30 overflow-hidden bg-muted/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.data
                      ? `data:${img.mimeType};base64,${img.data}`
                      : `/api/uploads?path=${encodeURIComponent(img.localPath!)}`}
                    alt={`Reference ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prompt textarea */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t('imageGen.prompt' as TranslationKey)}
          </label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={status === 'generating'}
            rows={3}
            className={cn(
              'resize-none',
              'disabled:opacity-60 disabled:cursor-not-allowed'
            )}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t('imageGen.provider' as TranslationKey)}
          </label>
          <Select
            value={selectedProviderId}
            onValueChange={handleProviderChange}
            disabled={status === 'generating' || providersLoading || providerOptions.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('imageGen.providerLoading' as TranslationKey)} />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map(option => (
                <SelectItem key={option.id} value={option.id}>
                  {describeProvider(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
              {selectedProvider && (
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <p>
                {t('imageGen.providerTarget' as TranslationKey)}: {isOfficialGeminiImageProvider({ base_url: selectedProvider.baseUrl })
                  ? 'Google Gemini API'
                  : getMediaRelayTargetSummary({
                    base_url: selectedProvider.baseUrl,
                    options_json: selectedProvider.optionsJson,
                  })}
              </p>
              {!isOfficialGeminiImageProvider({ base_url: selectedProvider.baseUrl }) && (
                <p>
                  {t('imageGen.provider' as TranslationKey)} {isZh ? '协议' : 'Protocol'}: {getMediaRelayProtocol({
                    base_url: selectedProvider.baseUrl,
                    options_json: selectedProvider.optionsJson,
                  }) === 'openai-images'
                    ? 'OpenAI Images API'
                    : (isZh ? '自定义图片接口' : 'Custom Image API')}
                </p>
              )}
            </div>
          )}
        </div>

        {showModelSelector && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t('imageGen.model' as TranslationKey)}
            </label>
            <Select
              value={selectedModel}
              onValueChange={handleModelChange}
              disabled={status === 'generating'}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('imageGen.model' as TranslationKey)} />
              </SelectTrigger>
              <SelectContent>
                {providerModelOptions.map(model => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Aspect Ratio */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('imageGen.aspectRatio' as TranslationKey)}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ASPECT_RATIOS.map((ratio) => (
              <Button
                key={ratio}
                variant="outline"
                size="xs"
                disabled={status === 'generating'}
                onClick={() => setAspectRatio(ratio)}
                className={cn(
                  aspectRatio === ratio
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/30'
                )}
              >
                {ratio}
              </Button>
            ))}
          </div>
        </div>

        {/* Resolution */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('imageGen.resolution' as TranslationKey)}
          </label>
          <div className="flex items-center gap-1.5">
            {RESOLUTIONS.map((res) => (
              <Button
                key={res}
                variant="outline"
                size="xs"
                disabled={status === 'generating'}
                onClick={() => setResolution(res)}
                className={cn(
                  resolution === res
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/30'
                )}
              >
                {res}
              </Button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        {status === 'idle' && (
          <div className="pt-1">
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim() || !selectedProviderId || (showModelSelector && !selectedModel)}
              size="sm"
              className="gap-1.5"
            >
              {t('imageGen.generateButton' as TranslationKey)}
            </Button>
          </div>
        )}

        {/* Generating: spinner + stop */}
        {status === 'generating' && (
          <div className="pt-1">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm text-muted-foreground">
                  {t('imageGen.generatingStatus' as TranslationKey)}
                </span>
              </div>
              <Button onClick={handleStop} variant="outline" size="sm">
                {t('imageGen.stopButton' as TranslationKey)}
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && error && (
          <div className="space-y-2">
            <p className="text-sm text-status-error-foreground">{error}</p>
            <Button onClick={handleGenerate} variant="outline" size="sm">
              {t('imageGen.retryButton' as TranslationKey)}
            </Button>
          </div>
        )}

        {!providersLoading && providerOptions.length === 0 && (
          <p className="text-sm text-status-error-foreground">
            {t('imageGen.noProviderConfigured' as TranslationKey)}
          </p>
        )}
      </div>
    </div>
  );
}
