"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Trash, SquaresFour, CaretDown, CaretUp, List } from "@/components/ui/icon";
import { DashboardWidget } from "@/types/dashboard";

interface GlobalWidget extends DashboardWidget {
  isGlobal?: boolean;
}

export function WidgetsSection() {
  const { t } = useTranslation();
  const [widgets, setWidgets] = useState<GlobalWidget[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWidgets = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/global");
      if (res.ok) {
        const data = await res.json();
        setWidgets(data.widgets || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWidgets();
  }, [fetchWidgets]);

  const handleToggleGlobal = async (widgetId: string, isGlobal: boolean) => {
    // Optimistic update
    setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, isGlobal } : w));
    try {
      await fetch("/api/dashboard/global", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: 'toggle', widgetId, isGlobal }),
      });
    } catch {
      fetchWidgets();
    }
  };

  const handleRemove = async (widgetId: string) => {
    setWidgets(prev => prev.filter(w => w.id !== widgetId));
    try {
      await fetch("/api/dashboard/global", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: 'remove', widgetId }),
      });
    } catch {
      fetchWidgets();
    }
  };

  // HTML5 Drag and Drop handlers
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain") || draggedId;
    if (!sourceId || sourceId === targetId) return;

    const oldIndex = widgets.findIndex(w => w.id === sourceId);
    const newIndex = widgets.findIndex(w => w.id === targetId);
    if (oldIndex === -1 || newIndex === -1) return;

    const newWidgets = [...widgets];
    const [draggedItem] = newWidgets.splice(oldIndex, 1);
    newWidgets.splice(newIndex, 0, draggedItem);
    
    setWidgets(newWidgets);
    setDraggedId(null);

    const widgetIds = newWidgets.map(w => w.id);
    try {
      await fetch("/api/dashboard/global", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: 'reorder', widgetIds }),
      });
    } catch {
      fetchWidgets();
    }
  };

  if (loading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading...</div>;
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-medium">{t('widgets.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('widgets.description')}</p>
      </div>

      <div className="flex flex-col gap-3">
        {widgets.length === 0 ? (
          <div className="text-sm text-muted-foreground italic border rounded-lg p-6 text-center">
            {t('widgets.empty')}
          </div>
        ) : (
          widgets.map((widget) => (
            <div
              key={widget.id}
              draggable
              onDragStart={(e) => handleDragStart(e, widget.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, widget.id)}
              onDragEnd={() => setDraggedId(null)}
              className={`flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all duration-200 ${
                draggedId === widget.id ? "opacity-50 border-primary" : "hover:border-border/80"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 overflow-hidden flex-1">
                  <div className="cursor-grab hover:text-foreground text-muted-foreground/50 transition-colors">
                    <List size={16} />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <SquaresFour size={14} className="text-muted-foreground" />
                      <span className="font-medium text-sm truncate">{widget.title}</span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate" title={widget.dataContract}>
                      {widget.dataContract}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-6 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t('widgets.globalToggle')}
                    </span>
                    <Switch
                      checked={!!widget.isGlobal}
                      onCheckedChange={(val) => handleToggleGlobal(widget.id, val)}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-status-error-foreground hover:bg-status-error-muted"
                    onClick={() => handleRemove(widget.id)}
                  >
                    <Trash size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
