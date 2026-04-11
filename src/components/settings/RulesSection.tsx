"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Plus, 
  PencilSimple, 
  Trash, 
  UserCircle, 
  Layout, 
  Check,
  CaretDown,
  Info,
  FolderOpen,
  ArrowClockwise,
  Book
} from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { CustomRule, ChatSession } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";

export function RulesSection() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState<Partial<CustomRule> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Basic Rules State (the 3 toggles)
  const [includeAgentsMd, setIncludeAgentsMd] = useState(true);
  const [includeClaudeMd, setIncludeClaudeMd] = useState(true);
  const [enableAgentsSkills, setEnableAgentsSkills] = useState(true);
  const [syncProjectRules, setSyncProjectRules] = useState(true);
  const [knowledgeBaseEnabled, setKnowledgeBaseEnabled] = useState(true);
  const [basicSaving, setBasicSaving] = useState(false);

  const [discoveredRules, setDiscoveredRules] = useState<Array<{ projectName: string, path: string, content: string }>>([]);

  const fetchAppSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        const appSettings = data.settings || {};
        setIncludeAgentsMd(appSettings.include_agents_md !== "false");
        setIncludeClaudeMd(appSettings.include_claude_md !== "false");
        setEnableAgentsSkills(appSettings.enable_agents_skills !== "false");
        setSyncProjectRules(appSettings.sync_project_rules !== "false");
        setKnowledgeBaseEnabled(appSettings.knowledge_base_enabled !== "false");
      }
    } catch { /* ignore */ }
  }, []);

  const fetchDiscoveredRules = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/custom-rules/sync");
      if (res.ok) {
        const data = await res.json();
        setDiscoveredRules(data.discoveredRules || []);
      }
    } catch { /* ignore */ }
  }, []);

  const handleBasicToggle = async (key: string, value: boolean) => {
    setBasicSaving(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { [key]: value ? "" : "false" },
        }),
      });
      if (res.ok) {
        if (key === 'include_agents_md') setIncludeAgentsMd(value);
        if (key === 'include_claude_md') setIncludeClaudeMd(value);
        if (key === 'enable_agents_skills') setEnableAgentsSkills(value);
        if (key === 'sync_project_rules') setSyncProjectRules(value);
        if (key === 'knowledge_base_enabled') setKnowledgeBaseEnabled(value);
      }
    } catch { /* ignore */ } finally {
      setBasicSaving(false);
    }
  };

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/custom-rules");
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch (err) {
      console.error("Failed to fetch rules", err);
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error("Failed to fetch sessions", err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchRules(), fetchSessions(), fetchAppSettings(), fetchDiscoveredRules()]).finally(() => setLoading(false));
  }, [fetchRules, fetchSessions, fetchAppSettings, fetchDiscoveredRules]);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (s.working_directory && s.project_name) {
        map.set(s.working_directory, s.project_name);
      }
    }
    return Array.from(map.entries()).map(([path, name]) => ({ path, name }));
  }, [sessions]);

  const handleSave = async () => {
    if (!editingRule?.name || !editingRule?.content) return;

    const method = editingRule.id ? "PATCH" : "POST";
    try {
      const res = await fetch("/api/settings/custom-rules", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingRule),
      });
      if (res.ok) {
        setDialogOpen(false);
        fetchRules();
      }
    } catch (err) {
      console.error("Failed to save rule", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('chat.deleteConfirm'))) return;
    try {
      const res = await fetch(`/api/settings/custom-rules?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchRules();
    } catch (err) {
      console.error("Failed to delete rule", err);
    }
  };

  const handleOpenGlobalFolder = async () => {
    try {
      await fetch('/api/utils/open-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '~/.codepilot/rules' }),
      });
    } catch (err) {
      console.error("Failed to open global folder", err);
    }
  };

  const personalRules = rules.filter(r => r.type === 'personal');
  const projectRules = rules.filter(r => r.type === 'project');

  return (
    <div className="max-w-4xl space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('rules.title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('rules.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchRules(); fetchSessions(); fetchAppSettings(); fetchDiscoveredRules(); }} className="gap-2">
            <ArrowClockwise size={14} />
          </Button>
        </div>
      </div>

      {/* Basic Rules (Toggles) */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Book size={20} className="text-primary" />
          <h3 className="text-sm font-medium">{t('rules.baseRules')}</h3>
        </div>
        <div className="rounded-xl border border-border/50 bg-muted/10 divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t('assistant.settings.includeAgentsMd')}</Label>
              <p className="text-[11px] text-muted-foreground leading-normal">
                {t('assistant.settings.includeAgentsMdDesc')}
              </p>
            </div>
            <Switch
              checked={includeAgentsMd}
              onCheckedChange={(checked) => handleBasicToggle('include_agents_md', checked)}
              disabled={basicSaving}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t('assistant.settings.includeClaudeMd')}</Label>
              <p className="text-[11px] text-muted-foreground leading-normal">
                {t('assistant.settings.includeClaudeMdDesc')}
              </p>
            </div>
            <Switch
              checked={includeClaudeMd}
              onCheckedChange={(checked) => handleBasicToggle('include_claude_md', checked)}
              disabled={basicSaving}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t('assistant.settings.enableAgentsSkills')}</Label>
              <p className="text-[11px] text-muted-foreground leading-normal">
                {t('assistant.settings.enableAgentsSkillsDesc')}
              </p>
            </div>
            <Switch
              checked={enableAgentsSkills}
              onCheckedChange={(checked) => handleBasicToggle('enable_agents_skills', checked)}
              disabled={basicSaving}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t('assistant.settings.knowledgeBaseEnabled')}</Label>
              <p className="text-[11px] text-muted-foreground leading-normal">
                {t('assistant.settings.knowledgeBaseEnabledDesc')}
              </p>
            </div>
            <Switch
              checked={knowledgeBaseEnabled}
              onCheckedChange={(checked) => handleBasicToggle('knowledge_base_enabled', checked)}
              disabled={basicSaving}
            />
          </div>
        </div>
      </section>

      {/* Personal Rules */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCircle size={20} className="text-primary" />
            <h3 className="text-sm font-medium">{t('rules.personal')}</h3>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => {
            setEditingRule({ type: 'personal', name: '', content: '', enabled: true });
            setDialogOpen(true);
          }}>
            <Plus size={14} />
            {t('rules.create')}
          </Button>
        </div>

        <div className={cn(
          "rounded-xl border border-border/50 bg-muted/20 overflow-hidden",
          personalRules.length === 0 && "py-12 flex flex-col items-center justify-center text-center px-6"
        )}>
          {personalRules.length === 0 ? (
            <>
              <UserCircle size={40} className="text-muted-foreground/30 mb-3" />
              <div className="max-w-[300px]">
                <p className="text-sm font-medium">{t('rules.personal')}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('rules.personalDesc')} <span className="text-primary hover:underline cursor-pointer">{t('rules.learnMore')}</span>
                </p>
              </div>
            </>
          ) : (
            <div className="divide-y divide-border/30">
              {personalRules.map(rule => (
                <RuleItem key={rule.id} rule={rule} onEdit={() => { setEditingRule(rule); setDialogOpen(true); }} onDelete={() => handleDelete(rule.id)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Project Rules */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layout size={20} className="text-primary" />
            <h3 className="text-sm font-medium">{t('rules.project')}</h3>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => {
              setEditingRule({ type: 'project', name: '', content: '', enabled: true, project_ids: '[]' });
              setDialogOpen(true);
            }}>
              <Plus size={14} />
              {t('rules.create')}
            </Button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-muted/30">
              <span className="text-xs font-medium whitespace-nowrap">{t('assistant.settings.syncProjectRules')}</span>
              <Switch
                checked={syncProjectRules}
                onCheckedChange={(checked) => handleBasicToggle('sync_project_rules', checked)}
                disabled={basicSaving}
                className="scale-75 origin-right"
              />
            </div>
          </div>
        </div>

        <div className={cn(
          "rounded-xl border border-border/50 bg-muted/20 overflow-hidden",
          (projectRules.length === 0 && (!syncProjectRules || discoveredRules.length === 0)) && "py-12 flex flex-col items-center justify-center text-center px-6"
        )}>
          {(projectRules.length === 0 && (!syncProjectRules || discoveredRules.length === 0)) ? (
            <>
              <Layout size={40} className="text-muted-foreground/30 mb-3" />
              <div className="max-w-[300px]">
                <p className="text-sm font-medium">{t('rules.project')}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('rules.projectDesc')} <span className="text-primary hover:underline cursor-pointer">{t('rules.learnMore')}</span>
                </p>
                {projects.length === 0 && (
                  <div className="mt-4 flex items-center gap-2 text-amber-500 justify-center">
                    <Info size={14} />
                    <span className="text-xs">暂无项目 <span className="underline cursor-pointer">打开文件夹</span></span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="divide-y divide-border/30">
              {/* Custom Project Rules from DB */}
              {projectRules.map(rule => (
                <RuleItem key={rule.id} rule={rule} onEdit={() => { setEditingRule(rule); setDialogOpen(true); }} onDelete={() => handleDelete(rule.id)} />
              ))}
              
              {/* Synced Rules from .trae/rules/rules.md */}
              {syncProjectRules && discoveredRules.map((dr, i) => (
                <div key={`synced-${i}`} className="flex items-center justify-between p-4 group hover:bg-muted/30 transition-colors border-t border-border/30 first:border-t-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium truncate">{dr.projectName}</h4>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-bold uppercase tracking-wider">Synced</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground truncate max-w-[250px]">
                          {dr.content.slice(0, 80)}...
                        </span>
                        <span className="text-[9px] text-muted-foreground font-mono bg-muted px-1 rounded">
                          {dr.path.split('/').pop()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" disabled title={t('rules.syncedReadOnly') || "Synced rules are read-only"}>
                      <FolderOpen size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Editor Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>{editingRule?.id ? t('rules.edit') : t('rules.create')}</DialogTitle>
            <DialogDescription>
              {editingRule?.type === 'personal' ? t('rules.personalDesc') : t('rules.projectDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto p-6 space-y-6 pt-2">
            <div className="space-y-2">
              <Label>{t('rules.name')}</Label>
              <Input 
                value={editingRule?.name || ''} 
                onChange={e => setEditingRule({ ...editingRule, name: e.target.value })} 
                placeholder="e.g. Code Style, Python Rules..."
              />
            </div>

            <div className="space-y-2">
              <Label>{t('rules.content')}</Label>
              <Textarea 
                value={editingRule?.content || ''} 
                onChange={e => setEditingRule({ ...editingRule, content: e.target.value })} 
                placeholder="# Coding Standards..."
                className="min-h-[200px] font-mono text-sm"
              />
            </div>

            {editingRule?.type === 'project' && (
              <div className="space-y-3">
                <Label>{t('rules.targetProjects')}</Label>
                <div className="grid grid-cols-1 gap-2 p-3 rounded-lg border border-border/50 bg-muted/30">
                  {projects.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No projects detected yet.</p>
                  ) : (
                    projects.map(p => {
                      const selectedPaths = JSON.parse(editingRule.project_ids || '[]');
                      const isSelected = selectedPaths.includes(p.path);
                      return (
                        <div key={p.path} className="flex items-center space-x-2">
                          <Checkbox 
                            id={p.path} 
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              const newPaths = checked 
                                ? [...selectedPaths, p.path]
                                : selectedPaths.filter((path: string) => path !== p.path);
                              setEditingRule({ ...editingRule, project_ids: JSON.stringify(newPaths) });
                            }}
                          />
                          <label htmlFor={p.path} className="text-xs font-medium leading-none cursor-pointer truncate flex-1">
                            {p.name}
                            <span className="ml-2 text-[10px] text-muted-foreground font-normal">{p.path}</span>
                          </label>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <div className="space-y-0.5">
                <Label>{t('rules.enabled')}</Label>
                <p className="text-[11px] text-muted-foreground">Rule will be injected into AI context when enabled.</p>
              </div>
              <Switch 
                checked={editingRule?.enabled !== false} 
                onCheckedChange={checked => setEditingRule({ ...editingRule, enabled: checked })} 
              />
            </div>
          </div>

          <DialogFooter className="p-6 pt-2 border-t border-border/30 bg-muted/10">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>{t('rules.cancel')}</Button>
            <Button onClick={handleSave}>{t('rules.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RuleItem({ rule, onEdit, onDelete }: { rule: CustomRule, onEdit: () => void, onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between p-4 group hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          "w-2 h-2 rounded-full",
          rule.enabled ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-muted-foreground/30"
        )} />
        <div className="min-w-0">
          <h4 className="text-sm font-medium truncate">{rule.name}</h4>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
              {rule.content.slice(0, 60)}...
            </span>
            {rule.type === 'project' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {JSON.parse(rule.project_ids).length} Projects
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={onEdit}>
          <PencilSimple size={14} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete}>
          <Trash size={14} />
        </Button>
      </div>
    </div>
  );
}
