import { type ReactNode, type RefObject, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CaretDown, MagnifyingGlass } from "@/components/ui/icon";

/* ------------------------------------------------------------------ */
/*  CommandList — shared popover/command-list pattern                  */
/*  Pure presentation; no data fetching or business logic.            */
/* ------------------------------------------------------------------ */

// ── Root container ──────────────────────────────────────────────────

interface CommandListProps {
  children: ReactNode;
  className?: string;
}

export function CommandList({ children, className }: CommandListProps) {
  return (
    <div
      className={cn(
        "absolute bottom-full left-0 mb-2 rounded-2xl border border-primary/10 bg-white shadow-xl overflow-hidden z-50",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Search input ────────────────────────────────────────────────────

interface CommandListSearchProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function CommandListSearch({
  value,
  onChange,
  onKeyDown,
  placeholder = "Search...",
  inputRef,
}: CommandListSearchProps) {
  return (
    <div className="p-3 border-b border-border/50 bg-muted/30">
      <div className="relative">
        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-9 pl-9 pr-4 bg-white shadow-sm text-sm"
        />
      </div>
    </div>
  );
}

// ── Scrollable items area ───────────────────────────────────────────

interface CommandListItemsProps {
  children: ReactNode;
  className?: string;
}

export function CommandListItems({ children, className }: CommandListItemsProps) {
  return (
    <div className={cn("max-h-[20rem] overflow-y-auto overflow-x-hidden p-1.5", className)}>
      {children}
    </div>
  );
}

// ── Single item ─────────────────────────────────────────────────────

interface CommandListItemProps {
  active?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  children: ReactNode;
  className?: string;
  itemRef?: (el: HTMLButtonElement | null) => void;
}

export function CommandListItem({
  active,
  onClick,
  onMouseEnter,
  children,
  className,
  itemRef,
}: CommandListItemProps) {
  return (
    <Button
      type="button"
      ref={itemRef}
      variant="ghost"
      size="sm"
      className={cn(
        "flex w-full items-center justify-start gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-normal transition-all duration-150 h-auto",
        active ? "text-primary" : "hover:bg-accent/60",
        className,
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      {children}
    </Button>
  );
}

// ── Group with optional label and separator ─────────────────────────

interface CommandListGroupProps {
  label?: string;
  separator?: boolean;
  children: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}

export function CommandListGroup({ label, separator, children, expandable, expanded, onToggle }: CommandListGroupProps) {
  return (
    <div className={cn(separator && "border-t border-border/50")}>
      {label && (
        <div
          className={cn("px-4 py-2 text-[10px] font-semibold uppercase tracking-wider flex justify-between items-center cursor-pointer transition-colors duration-150",
            expandable && "hover:bg-accent/30",
            expanded && "bg-primary/5 text-primary"
          )}
          onClick={expandable ? onToggle : undefined}
        >
          <span>{label}</span>
          {expandable && (
            <CaretDown size={10} className={cn("transition-transform duration-200", expanded ? "rotate-180" : "rotate-0")} />
          )}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Footer ──────────────────────────────────────────────────────────

interface CommandListFooterProps {
  children: ReactNode;
}

export function CommandListFooter({ children }: CommandListFooterProps) {
  return (
    <div className="border-t border-border/50 px-3 py-2 bg-muted/20">
      {children}
    </div>
  );
}

// ── Footer action button ────────────────────────────────────────────

interface CommandListFooterActionProps {
  onClick?: () => void;
  children: ReactNode;
}

export function CommandListFooterAction({ onClick, children }: CommandListFooterActionProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="flex w-full items-center justify-start gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 h-auto transition-all duration-150"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

interface CommandListEmptyProps {
  children: ReactNode;
}

export function CommandListEmpty({ children }: CommandListEmptyProps) {
  return (
    <div className="px-4 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}