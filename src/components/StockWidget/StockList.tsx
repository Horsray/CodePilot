/**
 * 股票列表组件
 * 中文注释：功能名称「股票列表」，用法是展示多只股票的行情列表。
 */
'use client';

import React from 'react';
import { Stock } from '@/types/stock';
import { StockCard } from './StockCard';
import { cn } from '@/lib/utils';

interface StockListProps {
  stocks: Stock[];
  removable?: boolean;
  onRemove?: (code: string) => void;
  showDetails?: boolean;
  onStockClick?: (stock: Stock) => void;
  emptyText?: string;
  className?: string;
  layout?: 'grid' | 'list';
  columns?: number;
}

export function StockList({
  stocks,
  removable = false,
  onRemove,
  showDetails = false,
  onStockClick,
  emptyText = '暂无股票数据',
  className,
  layout = 'list',
  columns = 1
}: StockListProps) {
  if (stocks.length === 0) {
    return (
      <div className={cn('text-center py-8 text-muted-foreground', className)}>
        {emptyText}
      </div>
    );
  }

  if (layout === 'grid') {
    return (
      <div
        className={cn(
          'grid gap-4',
          columns === 1 && 'grid-cols-1',
          columns === 2 && 'grid-cols-1 md:grid-cols-2',
          columns === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
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

  return (
    <div className={cn('space-y-2', className)}>
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

export default StockList;
