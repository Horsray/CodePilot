/**
 * Agent SDK Capabilities Cache — per-provider capability cache that captures
 * SDK data (models, commands, account info, MCP status) from active Query instances.
 *
 * Uses cache-on-first-query pattern: after each query() initialization,
 * capabilities are captured and cached, keyed by providerId, so different
 * providers never pollute each other's data.
 *
 * Uses globalThis pattern (same as conversation-registry.ts) to survive
 * Next.js HMR without losing state.
 */
import { getConversation } from './conversation-registry';
const GLOBAL_KEY = '__agentSdkCapabilities__';
/** Returns the per-provider cache Map. */
function getCacheMap() {
    if (!globalThis[GLOBAL_KEY]) {
        globalThis[GLOBAL_KEY] = new Map();
    }
    return globalThis[GLOBAL_KEY];
}
function getOrCreateCache(providerId) {
    const map = getCacheMap();
    let cache = map.get(providerId);
    if (!cache) {
        cache = {
            models: [],
            commands: [],
            account: null,
            mcpStatus: [],
            loadedPlugins: [],
            capturedAt: 0,
            sessionId: '',
        };
        map.set(providerId, cache);
    }
    return cache;
}
// ==========================================
// Cache freshness
// ==========================================
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Check if the capability cache for a provider is still fresh (within TTL). */
export function isCacheFresh(providerId = 'env') {
    const cache = getCacheMap().get(providerId);
    return !!cache && cache.capturedAt > 0 && (Date.now() - cache.capturedAt) < CACHE_TTL_MS;
}
// ==========================================
// Capture
// ==========================================
/**
 * Check if a conversation object is a real Query instance (not a resume-fallback
 * async generator wrapper). The resume fallback in claude-client.ts wraps the
 * iterator in a plain async generator that lacks Query control methods.
 */
function isRealQuery(conversation) {
    return (conversation != null &&
        typeof conversation.supportedModels === 'function' &&
        typeof conversation.supportedCommands === 'function' &&
        typeof conversation.accountInfo === 'function' &&
        typeof conversation.mcpServerStatus === 'function');
}
/**
 * Capture all capabilities from an active Query instance.
 * Should be called fire-and-forget after registerConversation().
 * Safe to call with non-Query objects (resume fallback) — will silently skip.
 *
 * @param providerId - The provider ID that owns this session (e.g. 'env', a DB provider ID)
 */
export async function captureCapabilities(sessionId, conversation, providerId = 'env') {
    if (!isRealQuery(conversation)) {
        console.log('[capabilities] Skipping capture — not a real Query instance');
        return;
    }
    const cache = getOrCreateCache(providerId);
    try {
        const [models, commands, account, mcpStatus] = await Promise.allSettled([
            conversation.supportedModels(),
            conversation.supportedCommands(),
            conversation.accountInfo(),
            conversation.mcpServerStatus(),
        ]);
        // Guard: only overwrite cached models if the new result is non-empty.
        // An empty array (e.g. transient SDK error) would otherwise wipe valid cached data,
        // causing models like Opus to disappear from the selector after long idle.
        cache.models = models.status === 'fulfilled' && models.value.length > 0 ? models.value : cache.models;
        cache.commands = commands.status === 'fulfilled' && commands.value.length > 0 ? commands.value : cache.commands;
        cache.account = account.status === 'fulfilled' ? account.value : cache.account;
        cache.mcpStatus = mcpStatus.status === 'fulfilled' ? mcpStatus.value : cache.mcpStatus;
        cache.capturedAt = Date.now();
        cache.sessionId = sessionId;
        console.log(`[capabilities] Captured for provider="${providerId}":`, `models=${cache.models.length}`, `commands=${cache.commands.length}`, `account=${cache.account ? 'yes' : 'no'}`, `mcpServers=${cache.mcpStatus.length}`);
    }
    catch (error) {
        console.warn('[capabilities] Capture failed:', error);
    }
}
// ==========================================
// Read cached data (scoped by provider)
// ==========================================
export function getCachedModels(providerId = 'env') {
    return getOrCreateCache(providerId).models;
}
export function getCachedCommands(providerId = 'env') {
    return getOrCreateCache(providerId).commands;
}
export function getCachedAccountInfo(providerId = 'env') {
    return getOrCreateCache(providerId).account;
}
export function getCachedMcpStatus(providerId = 'env') {
    return getOrCreateCache(providerId).mcpStatus;
}
export function getCachedPlugins(providerId = 'env') {
    return getOrCreateCache(providerId).loadedPlugins;
}
export function setCachedPlugins(providerId, plugins) {
    const cache = getOrCreateCache(providerId);
    cache.loadedPlugins = plugins;
}
export function getCapabilityCacheAge(providerId = 'env') {
    const { capturedAt } = getOrCreateCache(providerId);
    return capturedAt === 0 ? Infinity : Date.now() - capturedAt;
}
// ==========================================
// Refresh (from active Query)
// ==========================================
/**
 * Refresh MCP server status from an active Query instance.
 * Falls back to cached data if the session has no active conversation.
 */
export async function refreshMcpStatus(sessionId, providerId = 'env') {
    const conversation = getConversation(sessionId);
    if (!isRealQuery(conversation)) {
        return getOrCreateCache(providerId).mcpStatus;
    }
    try {
        const status = await conversation.mcpServerStatus();
        const cache = getOrCreateCache(providerId);
        cache.mcpStatus = status;
        cache.capturedAt = Date.now();
        return status;
    }
    catch (error) {
        console.warn('[capabilities] MCP status refresh failed:', error);
        return getOrCreateCache(providerId).mcpStatus;
    }
}
