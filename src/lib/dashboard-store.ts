/**
 * Dashboard Store — file-based CRUD for per-project dashboard config.
 * Storage: {projectDir}/.codepilot/dashboard/dashboard.json
 */

import fs from 'fs';
import path from 'path';
import type { DashboardConfig, DashboardWidget, DashboardSettings } from '@/types/dashboard';

const DASHBOARD_DIR = '.codepilot/dashboard';
const DASHBOARD_FILE = 'dashboard.json';

function emptyConfig(): DashboardConfig {
  return {
    version: 1,
    settings: { autoRefreshOnOpen: false },
    widgets: [],
  };
}

export function getDashboardDir(workDir: string): string {
  return path.join(workDir, DASHBOARD_DIR);
}

export function getDashboardPath(workDir: string): string {
  return path.join(workDir, DASHBOARD_DIR, DASHBOARD_FILE);
}

// --- Global Widget Registry ---
import os from 'os';
export function getGlobalDashboardDir(): string {
  return path.join(process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot'), 'dashboard');
}

export function getGlobalDashboardPath(): string {
  return path.join(getGlobalDashboardDir(), 'global-widgets.json');
}

export interface GlobalWidgetRegistry {
  version: 1;
  widgets: (DashboardWidget & { isGlobal?: boolean })[];
}

function emptyGlobalRegistry(): GlobalWidgetRegistry {
  return { version: 1, widgets: [] };
}

export function readGlobalRegistry(): GlobalWidgetRegistry {
  const filePath = getGlobalDashboardPath();
  if (!fs.existsSync(filePath)) return emptyGlobalRegistry();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as GlobalWidgetRegistry;
  } catch {
    return emptyGlobalRegistry();
  }
}

export function writeGlobalRegistry(registry: GlobalWidgetRegistry): void {
  const dir = getGlobalDashboardDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = getGlobalDashboardPath();
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function upsertGlobalWidget(widget: DashboardWidget): void {
  const registry = readGlobalRegistry();
  const idx = registry.widgets.findIndex(w => w.id === widget.id);
  if (idx !== -1) {
    // Preserve isGlobal state if it exists
    const isGlobal = registry.widgets[idx].isGlobal;
    registry.widgets[idx] = { ...widget, isGlobal };
  } else {
    registry.widgets.push({ ...widget, isGlobal: false });
  }
  writeGlobalRegistry(registry);
}

export function toggleGlobalWidget(widgetId: string, isGlobal: boolean): void {
  const registry = readGlobalRegistry();
  const idx = registry.widgets.findIndex(w => w.id === widgetId);
  if (idx !== -1) {
    registry.widgets[idx].isGlobal = isGlobal;
    writeGlobalRegistry(registry);
  }
}

export function removeGlobalWidget(widgetId: string): void {
  const registry = readGlobalRegistry();
  registry.widgets = registry.widgets.filter(w => w.id !== widgetId);
  writeGlobalRegistry(registry);
}

export function reorderGlobalWidgets(widgetIds: string[]): void {
  const registry = readGlobalRegistry();
  const byId = new Map(registry.widgets.map(w => [w.id, w]));
  const ordered = widgetIds.filter(id => byId.has(id)).map(id => byId.get(id)!);
  const remaining = registry.widgets.filter(w => !widgetIds.includes(w.id));
  registry.widgets = [...ordered, ...remaining];
  writeGlobalRegistry(registry);
}

// --- End Global Registry ---

export function readDashboard(workDir: string): DashboardConfig {
  const filePath = getDashboardPath(workDir);
  if (!fs.existsSync(filePath)) return emptyConfig();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(raw) as DashboardConfig;
    if (config.version !== 1) return emptyConfig();
    return config;
  } catch {
    return emptyConfig();
  }
}

export function writeDashboard(workDir: string, config: DashboardConfig): void {
  const dir = getDashboardDir(workDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = getDashboardPath(workDir);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function addWidget(workDir: string, widget: DashboardWidget): DashboardConfig {
  const config = readDashboard(workDir);
  config.widgets.push(widget);
  writeDashboard(workDir, config);
  upsertGlobalWidget(widget);
  return config;
}

export function removeWidget(workDir: string, widgetId: string): DashboardConfig {
  const config = readDashboard(workDir);
  config.widgets = config.widgets.filter(w => w.id !== widgetId);
  writeDashboard(workDir, config);
  // Do not remove from global registry when removed from a specific project.
  // The user might still want to toggle it globally in the Settings panel.
  return config;
}

export function updateWidget(
  workDir: string,
  widgetId: string,
  updates: Partial<Pick<DashboardWidget, 'widgetCode' | 'updatedAt' | 'order' | 'title' | 'dataContract' | 'dataSource'>>
): DashboardConfig {
  const config = readDashboard(workDir);
  const idx = config.widgets.findIndex(w => w.id === widgetId);
  if (idx !== -1) {
    config.widgets[idx] = { ...config.widgets[idx], ...updates };
    writeDashboard(workDir, config);
    upsertGlobalWidget(config.widgets[idx]);
  }
  return config;
}

export function updateSettings(workDir: string, settings: Partial<DashboardSettings>): DashboardConfig {
  const config = readDashboard(workDir);
  config.settings = { ...config.settings, ...settings };
  writeDashboard(workDir, config);
  return config;
}

/** Reorder widgets by absolute ID list. IDs not in the list are appended at the end. */
export function reorderWidgets(workDir: string, widgetIds: string[]): DashboardConfig {
  const config = readDashboard(workDir);
  const byId = new Map(config.widgets.map(w => [w.id, w]));
  const ordered = widgetIds.filter(id => byId.has(id)).map(id => byId.get(id)!);
  const remaining = config.widgets.filter(w => !widgetIds.includes(w.id));
  config.widgets = [...ordered, ...remaining];
  writeDashboard(workDir, config);
  return config;
}

export function moveWidget(workDir: string, widgetId: string, direction: 'up' | 'down' | 'top'): DashboardConfig {
  const config = readDashboard(workDir);
  const idx = config.widgets.findIndex(w => w.id === widgetId);
  if (idx === -1) return config;
  if (direction === 'top') {
    const [widget] = config.widgets.splice(idx, 1);
    config.widgets.unshift(widget);
  } else if (direction === 'up' && idx > 0) {
    [config.widgets[idx - 1], config.widgets[idx]] = [config.widgets[idx], config.widgets[idx - 1]];
  } else if (direction === 'down' && idx < config.widgets.length - 1) {
    [config.widgets[idx], config.widgets[idx + 1]] = [config.widgets[idx + 1], config.widgets[idx]];
  }
  writeDashboard(workDir, config);
  return config;
}

export function generateWidgetId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `w_${ts}_${rand}`;
}
