/**
 * 股票卡片组件
 * 中文注释：功能名称「股票卡片」，用法是展示单只股票的实时行情信息。
 */
import React from 'react';
import { Stock } from '@/types/stock';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// 中文注释：功能名称「涨跌趋势判断」，用法是根据股票涨跌幅判断涨跌状态。
function getTrend(stock: Stock): 'up' | 'down' | 'flat' {
  if (stock.changePercent > 0) return 'up';
  if (stock.changePercent < 0) return 'down';
  return 'flat';
}

// 中文注释：功能名称「价格格式化」，用法是将数字格式化为价格字符串。
function formatPrice(val: number): string {
  return val.toFixed(2);
}

// 中文注释：功能名称「涨跌格式化」，用法是将涨跌额格式化为带符号的字符串。
function formatChange(val: number): string {
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}`;
}

// 中文注释：功能名称「成交量格式化」，用法是将成交量格式化为易读的字符串。
function formatVolume(val: number): string {
  if (val >= 100000000) return `${(val / 100000000).toFixed(2)}亿`;
  if (val >= 10000) return `${(val / 10000).toFixed(2)}万`;
  return val.toLocaleString();
}

// 中文注释：功能名称「涨跌幅格式化」，用法是将涨跌幅格式化为百分比字符串。
function formatChangePercent(val: number): string {
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

interface StockCardProps {
  stock: Stock;
  removable?: boolean;
  onRemove?: (code: string) => void;
  showDetails?: boolean;
  onClick?: (stock: Stock) => void;
  className?: string;
}

export function StockCard({
  stock,
  removable = false,
  onRemove,
  showDetails = false,
  onClick,
  className
}: StockCardProps) {
  const trend = getTrend(stock);
  
  const trendColors = {
    up: { text: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
    down: { text: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    flat: { text: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/20' }
  };

  const styles = trendColors[trend];

  return (
    <div 
      className={cn(
        "relative p-4 rounded-lg border bg-card text-card-foreground transition-all hover:shadow-md",
        styles.bg,
        onClick && "cursor-pointer hover:scale-[1.02]",
        className
      )}
      onClick={() => onClick?.(stock)}
    >
      {removable && onRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-2 right-2"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(stock.code);
          }}
        >
          <XIcon className="h-3 w-3" />
        </Button>
      )}

      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-lg">{stock.name}</h3>
          <p className="text-xs text-muted-foreground">{stock.code}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{formatPrice(stock.price)}</div>
          <div className={cn("text-sm font-medium", styles.text)}>
            {formatChange(stock.change)} ({formatChangePercent(stock.changePercent)})
          </div>
        </div>
      </div>

      <div className="h-1 rounded-full overflow-hidden mb-3 bg-muted">
        <div 
          className={cn(
            "h-full transition-all",
            trend === 'up' && "bg-green-500",
            trend === 'down' && "bg-red-500",
            trend === 'flat' && "bg-gray-500"
          )}
          style={{ width: `${Math.min(100, 50 + stock.changePercent * 5)}%` }}
        />
      </div>

      {showDetails && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">今开</span>
            <span>{formatPrice(stock.open ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">昨收</span>
            <span>{formatPrice(stock.close ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">最高</span>
            <span>{formatPrice(stock.high ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">最低</span>
            <span>{formatPrice(stock.low ?? 0)}</span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">成交量</span>
            <span>{formatVolume(stock.volume ?? 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export default StockCard;
