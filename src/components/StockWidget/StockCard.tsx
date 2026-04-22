/**
 * 股票卡片组件
 * 展示单只股票的实时行情信息
 */
import React from 'react';
import { Stock, StockTrend, getStockTrend } from '@/types/stock';
import { formatPrice, formatChange, formatVolume, formatChangePercent } from '@/utils/formatters';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StockCardProps {
  /** 股票数据 */
  stock: Stock;
  /** 是否可删除 */
  removable?: boolean;
  /** 删除回调 */
  onRemove?: (code: string) => void;
  /** 是否显示详细数据 */
  showDetails?: boolean;
  /** 点击回调 */
  onClick?: (stock: Stock) => void;
  /** 自定义类名 */
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
  const trend = getStockTrend(stock);
  
  // 根据涨跌状态获取样式
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
      {/* 删除按钮 */}
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

      {/* 股票基本信息 */}
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

      {/* 涨跌指示条 */}
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

      {/* 详细数据 */}
      {showDetails && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">今开</span>
            <span>{formatPrice(stock.open || 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">昨收</span>
            <span>{formatPrice(stock.previousClose || 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">最高</span>
            <span>{formatPrice(stock.high || 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">最低</span>
            <span>{formatPrice(stock.low || 0)}</span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">成交量</span>
            <span>{formatVolume(stock.volume ?? 0)}</span>
          </div>
        </div>
      )}

      {/* 市场标签 */}
      {stock.market && (
        <div className="absolute bottom-2 left-2">
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded",
            stock.market === 'sh' && "bg-blue-500/20 text-blue-500",
            stock.market === 'sz' && "bg-orange-500/20 text-orange-500",
            stock.market === 'hk' && "bg-purple-500/20 text-purple-500",
            stock.market === 'us' && "bg-cyan-500/20 text-cyan-500"
          )}>
            {stock.market.toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
}

// X 图标组件
function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export default StockCard;
