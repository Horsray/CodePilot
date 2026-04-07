"use client";

import { Lightning, DownloadSimple, CheckCircle, Star } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { MarketplaceSkill } from "@/types";

interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  selected: boolean;
  onSelect: () => void;
}

export function MarketplaceSkillCard({
  skill,
  selected,
  onSelect,
}: MarketplaceSkillCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "group flex flex-col gap-1.5 rounded-md px-3 py-2.5 cursor-pointer transition-colors",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <Lightning size={16} className="shrink-0 text-muted-foreground mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{skill.name}</span>
            {skill.isInstalled ? (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-status-success-border text-status-success-foreground shrink-0"
              >
                <CheckCircle size={10} className="mr-0.5" />
                已安装
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
            {skill.description}
          </p>
        </div>
      </div>
      
      <div className="flex items-center justify-between text-xs text-muted-foreground pl-6">
        <div className="flex items-center gap-2">
          {skill.rating && (
            <span className="flex items-center gap-0.5 text-amber-500">
              <Star size={10} weight="fill" />
              {skill.rating}
            </span>
          )}
          {skill.installs > 0 && (
            <span className="flex items-center gap-0.5">
              <DownloadSimple size={10} />
              {(skill.installs / 1000).toFixed(1)}k
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {skill.tags?.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[9px] px-1 py-0">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
