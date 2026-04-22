'use client';

import React from 'react';
import { Stock } from '@/types/stock';
import { StockCard } from './StockCard';
import { cn } from '@/lib/utils';

/**
 * 股票列表组件属性
 */
interface StockListProps {
  /** 股票数据列表 */
  stocks: Stock[];
  /** 是否可删除 */
  removable?: boolean;
  /** 删除回调 */
  onRemove?: (code: string) => void;
  /** 是否显示详细数据 */
  showDetails?: boolean;
  /** 股票点击回调 */
  onStockClick?: (stock: Stock) => void;
  /** 空状态文本 */
  emptyText?: string;
  /** 自定义类名 */
  className?: string;
  /** 布局模式 */
  layout?: 'grid' | 'list';
  /** 列数 */
  columns?: number;
}

/**
 * 股票列表组件
 * 展示多只股票的行情列表
 * 
 * @example
 * ```tsx
 * <StockList 
 *   stocks={stockList}
 *   removable={true}
 *   onRemove={(code) => removeStock(code)}
 *   layout="grid"
 *   columns={2}
 * />
 * ```
 */
export function StockList({
  stocks,
  removable = false,
  onRemove,
  showDetails = false,
  onStockClick,
  emptyText = "暂无股票数据",
  className,
  layout = 'list',
  columns = 1
}: StockListProps) {
  // 空状态
  if (stocks.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        {emptyText}
      </div>
    );
  }

  // 网格布局
  if (layout === 'grid') {
    return (
      <div 
        className={cn(
          "grid gap-4",
          columns === 1 && "grid-cols-1",
          columns === 2 && "grid-cols-1 md:grid-cols-2",
          columns === 3 && "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
          className
        )}
      >
        {stocks.map((stock) => (
          <StockCard
            key={stock.code}
            stock={stock}
            removable={removable}
            onRemove={onRemove}
            showDetails={showDetails}
            onClick={onStockClick}
          />
        ))}
      </div>
    );
  }

  // 列表布局
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {stocks.map((stock, index) => (
        <div 
          key={stock.code}
          className="group relative"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <StockCard
            stock={stock}
            removable={removable}
            onRemove={onRemove}
            showDetails={showDetails}
            onClick={onStockClick}
            className="group-hover:opacity-80 transition-opacity"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * 简化股票列表（仅显示代码和名称）
 */
export function SimpleStockList({
  stocks,
  onStockClick,
  className
}: {
  stocks: Stock[];
  onStockClick?: (stock: Stock) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {stocks.map((stock) => (
        <button
          key={stock.code}
          onClick={() => onStockClick?.(stock)}
          className="flex items-center justify-between p-2 hover:bg-accent rounded transition-colors text-left"
        >
          <div>
            <span className="font-medium">{stock.name}</span>
            <span className="text-xs text-muted-foreground ml-2">{stock.code}</span>
          </div>
          <div className="text-right">
            <span className="font-medium">{stock.price.toFixed(2)}</span>
            <span className={cn(
              "text-xs ml-2",
              stock.change > 0 && "text-green-500",
              stock.change < 0 && "text-red-500",
              stock.change === 0 && "text-muted-foreground"
            )}>
              {stock.change > 0 ? '+' : ''}{stock.change.toFixed(2)}%
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

export default StockList;
