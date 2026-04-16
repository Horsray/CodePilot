'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { SetupCard } from './SetupCard';
import { useTranslation } from '@/hooks/useTranslation';
import type { SetupCardStatus, ApiProvider } from '@/types';

interface ProviderCardProps {
  status: SetupCardStatus;
  onStatusChange: (status: SetupCardStatus) => void;
}

export function ProviderCard({ status, onStatusChange }: ProviderCardProps) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [envDetected, setEnvDetected] = useState(false);
  const [loading, setLoading] = useState(true);
  // Track current status in a ref so fetchProviders can consult it without
  // taking `status` as a dep (which would recreate the callback every render
  // and defeat the useEffect identity check).
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      // /api/setup is the single source of truth for "can CodePilot dispatch a
      // chat?" — it delegates to hasCodePilotProvider() which includes the
      // OpenAI OAuth virtual provider that /api/providers does not surface.
      // We still fetch /api/providers in parallel purely for display detail
      // (count, env-detected badge).
      const [setupRes, providersRes] = await Promise.all([
        fetch('/api/setup').catch(() => null),
        fetch('/api/providers').catch(() => null),
      ]);

      let providerReady = false;
      if (setupRes?.ok) {
        const setup = await setupRes.json();
        providerReady = setup?.provider === 'completed';
      }

      let dbProviderList: ApiProvider[] = [];
      let hasEnv = false;
      if (providersRes?.ok) {
        const data = await providersRes.json();
        dbProviderList = data.providers || [];
        const credentialKeys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
        hasEnv = !!(data.env_detected && credentialKeys.some((k) => k in data.env_detected));
        if (!hasEnv) {
          try {
            const settingsRes = await fetch('/api/settings/app');
            if (settingsRes.ok) {
              const settingsData = await settingsRes.json();
              const appToken = settingsData.settings?.anthropic_auth_token;
              if (appToken && !appToken.startsWith('***not')) hasEnv = true;
            }
          } catch { /* ignore */ }
        }
      }

      setProviders(dbProviderList);
      setEnvDetected(hasEnv);
      // Promote to completed whenever ANY authoritative source agrees.
      // /api/setup covers OAuth (virtual provider), DB providers covers the
      // configured list, hasEnv covers the env-detected path — we keep all
      // three so a stale/offline /api/setup can't regress the UX.
      const anyReady = providerReady || dbProviderList.length > 0 || hasEnv;
      if (anyReady) {
        onStatusChange('completed');
      } else if (statusRef.current === 'completed') {
        // Downgrade when the last provider source is gone (e.g. user was
        // OAuth-only and just logged out while SetupCenter was open). Never
        // stomp 'skipped' — that's the user's explicit choice and fetching
        // provider state should not resurrect the card they dismissed.
        onStatusChange('not-configured');
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [onStatusChange]);

  useEffect(() => {
    fetchProviders();

    const handler = () => fetchProviders();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchProviders]);

  const handleSkip = useCallback(async () => {
    onStatusChange('skipped');
    try {
      await fetch('/api/setup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: 'provider', status: 'skipped' }),
      });
    } catch { /* ignore */ }
  }, [onStatusChange]);

  const handleOpenProviders = useCallback(() => {
    // Navigate to settings providers section (SettingsLayout uses hash routing)
    window.location.href = '/settings#providers';
  }, []);

  const description = status === 'completed'
    ? t('setup.provider.configured')
    : t('setup.provider.description');

  return (
    <SetupCard
      title={t('setup.provider.title')}
      description={description}
      status={status}
      onSkip={status === 'not-configured' ? handleSkip : undefined}
    >
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : status === 'completed' ? (
        <p className="text-xs">
          {providers.length > 0
            ? `${providers.length} provider(s) configured`
            : envDetected
              ? 'Using Claude Code environment'
              : ''}
        </p>
      ) : (
        <div className="space-y-2">
          {envDetected ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('setup.provider.envDetected')}</p>
              <Button size="sm" className="text-xs" onClick={() => {
                onStatusChange('completed');
              }}>
                {t('setup.provider.useEnv')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('setup.provider.noProvider')}</p>
              <Button size="sm" className="text-xs" onClick={handleOpenProviders}>
                {t('provider.addProvider')}
              </Button>
            </div>
          )}
        </div>
      )}
    </SetupCard>
  );
}
