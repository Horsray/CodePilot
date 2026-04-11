"use client";

import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SpinnerGap } from "@/components/ui/icon";

interface AssistantSettingsCardProps {
  initialState: {
    includeAgentsMd: boolean;
    includeClaudeMd: boolean;
    enableAgentsSkills: boolean;
    syncProjectRules: boolean;
    knowledgeBaseEnabled: boolean;
  };
  onUpdate: (updates: Partial<AssistantSettingsCardProps["initialState"]>) => Promise<void>;
}

export function AssistantSettingsCard({ initialState, onUpdate }: AssistantSettingsCardProps) {
  const { t } = useTranslation();
  const [updating, setUpdating] = useState<string | null>(null);

  const handleToggle = async (key: keyof AssistantSettingsCardProps["initialState"], value: boolean) => {
    setUpdating(key);
    try {
      await onUpdate({ [key]: value });
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="rounded-lg border border-border/50 divide-y divide-border/30">
      <div className="flex items-center justify-between p-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t('assistant.settings.includeAgentsMd')}</Label>
          <p className="text-[11px] text-muted-foreground leading-normal">
            {t('assistant.settings.includeAgentsMdDesc')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updating === 'includeAgentsMd' && <SpinnerGap size={14} className="animate-spin text-muted-foreground" />}
          <Switch
            checked={initialState.includeAgentsMd}
            onCheckedChange={(checked) => handleToggle('includeAgentsMd', checked)}
            disabled={!!updating}
          />
        </div>
      </div>

      <div className="flex items-center justify-between p-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t('assistant.settings.includeClaudeMd')}</Label>
          <p className="text-[11px] text-muted-foreground leading-normal">
            {t('assistant.settings.includeClaudeMdDesc')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updating === 'includeClaudeMd' && <SpinnerGap size={14} className="animate-spin text-muted-foreground" />}
          <Switch
            checked={initialState.includeClaudeMd}
            onCheckedChange={(checked) => handleToggle('includeClaudeMd', checked)}
            disabled={!!updating}
          />
        </div>
      </div>

      <div className="flex items-center justify-between p-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t('assistant.settings.enableAgentsSkills')}</Label>
          <p className="text-[11px] text-muted-foreground leading-normal">
            {t('assistant.settings.enableAgentsSkillsDesc')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updating === 'enableAgentsSkills' && <SpinnerGap size={14} className="animate-spin text-muted-foreground" />}
          <Switch
            checked={initialState.enableAgentsSkills}
            onCheckedChange={(checked) => handleToggle('enableAgentsSkills', checked)}
            disabled={!!updating}
          />
        </div>
      </div>

      <div className="flex items-center justify-between p-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t('assistant.settings.syncProjectRules')}</Label>
          <p className="text-[11px] text-muted-foreground leading-normal">
            {t('assistant.settings.syncProjectRulesDesc')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updating === 'syncProjectRules' && <SpinnerGap size={14} className="animate-spin text-muted-foreground" />}
          <Switch
            checked={initialState.syncProjectRules}
            onCheckedChange={(checked) => handleToggle('syncProjectRules', checked)}
            disabled={!!updating}
          />
        </div>
      </div>

      <div className="flex items-center justify-between p-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t('assistant.settings.knowledgeBaseEnabled')}</Label>
          <p className="text-[11px] text-muted-foreground leading-normal">
            {t('assistant.settings.knowledgeBaseEnabledDesc')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updating === 'knowledgeBaseEnabled' && <SpinnerGap size={14} className="animate-spin text-muted-foreground" />}
          <Switch
            checked={initialState.knowledgeBaseEnabled}
            onCheckedChange={(checked) => handleToggle('knowledgeBaseEnabled', checked)}
            disabled={!!updating}
          />
        </div>
      </div>
    </div>
  );
}
