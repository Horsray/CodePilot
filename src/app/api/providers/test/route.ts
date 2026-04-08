import { NextRequest, NextResponse } from 'next/server';
import { testProviderConnection } from '@/lib/claude-client';
import { getPreset } from '@/lib/provider-catalog';
import { getSetting } from '@/lib/db';
import { readCCSwitchConfig, readCCSwitchClaudeSettings } from '@/lib/cc-switch';
import type { ErrorResponse } from '@/types';

/**
 * POST /api/providers/test
 *
 * Test a provider connection without saving to DB.
 * Sends a minimal SDK query and returns structured success/error.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { presetKey, apiKey, baseUrl, protocol, authStyle, envOverrides, providerName, modelName, useCCSwitch } = body;

    // If no API key provided and useCCSwitch is true, try to get from cc-switch config
    let finalApiKey = apiKey;
    let finalBaseUrl = baseUrl;
    
    if (!finalApiKey && useCCSwitch && getSetting('cc_switch_enabled') === 'true') {
      const ccConfig = readCCSwitchConfig();
      const ccSettings = readCCSwitchClaudeSettings();
      
      if (ccSettings && typeof ccSettings === 'object' && 'apiKey' in ccSettings) {
        finalApiKey = (ccSettings as { apiKey: string }).apiKey;
        finalBaseUrl = (ccSettings as { baseUrl: string }).baseUrl;
      } else if (ccConfig && Object.keys(ccConfig).length > 0) {
        const firstConfig = Object.values(ccConfig)[0];
        finalApiKey = firstConfig.ANTHROPIC_API_KEY || firstConfig.ANTHROPIC_AUTH_TOKEN || '';
        finalBaseUrl = firstConfig.ANTHROPIC_BASE_URL || '';
      }
    }

    if (!finalApiKey && authStyle !== 'env_only') {
      return NextResponse.json({ success: false, error: { code: 'NO_CREDENTIALS', message: 'API Key is required', suggestion: 'Please enter your API key or enable CC-Switch' } });
    }

    // Look up preset meta for recovery action URLs
    const preset = presetKey ? getPreset(presetKey) : undefined;
    const meta = preset?.meta;

    const result = await testProviderConnection({
      apiKey: finalApiKey || '',
      baseUrl: finalBaseUrl || '',
      protocol: protocol || 'anthropic',
      authStyle: authStyle || 'api_key',
      envOverrides: envOverrides || {},
      modelName: modelName || undefined,
      presetKey: presetKey || undefined,
      providerName: providerName || preset?.name || 'Unknown',
      providerMeta: meta ? { apiKeyUrl: meta.apiKeyUrl, docsUrl: meta.docsUrl, pricingUrl: meta.pricingUrl } : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to test connection', details: String(err) } as ErrorResponse,
      { status: 500 },
    );
  }
}
