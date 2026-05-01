"use client";

import { Lightning, Trash, Sparkle } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

export interface SkillItem {
  name: string;
  description: string;
  content: string;
  source: "global" | "project" | "plugin" | "installed" | "sdk";
  installedSource?: "agents" | "claude";
  filePath: string;
  autoExtracted?: boolean;
  disabled?: boolean;
}

interface SkillListItemProps {
  skill: SkillItem;
  selected: boolean;
  onSelect: () => void;
  onDelete: (skill: SkillItem) => void;
  onToggle?: (skill: SkillItem, disabled: boolean) => void;
}

export function SkillListItem({
  skill,
  selected,
  onSelect,
  onDelete,
  onToggle,
}: SkillListItemProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = skill.source === "global" || skill.source === "project";
  const [toggling, setToggling] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canDelete) return;
    if (confirmDelete) {
      onDelete(skill);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      // Auto-reset after 3 seconds
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmDelete(false);
      }}
    >
      <Lightning size={16} className="shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate block">/{skill.name}</span>
          {skill.autoExtracted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 text-[9px] font-medium shrink-0">
                  <Sparkle size={10} className="shrink-0" />
                  智能习得
                </div>
              </TooltipTrigger>
              <TooltipContent>这是 AI 助手在之前的任务中自动提取并保存的技能</TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {skill.description}
        </p>
      </div>
      {onToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={!skill.disabled}
                disabled={toggling}
                onCheckedChange={(checked) => {
                  setToggling(true);
                  onToggle(skill, !checked);
                  setTimeout(() => setToggling(false), 500);
                }}
                className="scale-75"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            {skill.disabled ? t('skills.enableSkill') : t('skills.disableSkill')}
          </TooltipContent>
        </Tooltip>
      )}
      {canDelete && (hovered || confirmDelete) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={confirmDelete ? "destructive" : "ghost"}
              size="icon-xs"
              className="shrink-0"
              onClick={handleDelete}
            >
              <Trash size={12} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {confirmDelete ? t('skills.deleteConfirm') : t('common.delete')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
