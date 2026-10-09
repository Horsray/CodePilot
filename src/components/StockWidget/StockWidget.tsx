/**
 * 股票小组件主容器组件
 * 中文注释：功能名称「股票小组件」，用法是整合搜索、列表、数据刷新等功能。
 */
'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { StockData } from '@/types/stock';
import { StockSearch } from './StockSearch';
import { StockList } from './StockList';
import { Button } from '@/components/ui/button';
import { fetchStockData } from '@/services/stockApi';
import { cn } from '@/lib/utils';

const DEFAULT_STOCKS = ['sh600000', 'sh600036', 'sh601318', 'sz000001', 'sz002594'];

interface StockWidgetContainerProps {
  className?: string;
  showSearch?: boolean;
  showDetails?: boolean;
  initialStocks?: string[];
  refreshInterval?: number;
  title?: string;
}

export function StockWidget({
  className,
  showSearch = true,
  showDetails = false,
  initialStocks,
  refreshInterval = 30000,
  title = "股票行情"
}: StockWidgetContainerProps) {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  // 中文注释：功能名称「加载股票数据」，用法是从 API 获取多只股票的实时行情。
  const loadStocks = useCallback(async () => {
    const stockCodes = initialStocks || DEFAULT_STOCKS;

    try {
      setIsRefreshing(true);
      const quotes = await fetchStockData(stockCodes);
      setStocks(quotes);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      console.error('Failed to load stocks:', err);
      setError('获取股票数据失败');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [initialStocks]);

  useEffect(() => {
    loadStocks();
  }, [loadStocks]);

  useEffect(() => {
    if (refreshInterval > 0) {
      const timer = setInterval(loadStocks, refreshInterval);
      return () => clearInterval(timer);
    }
  }, [refreshInterval, loadStocks]);

  // 中文注释：功能名称「添加股票」，用法是搜索并添加新股票到自选列表。
  const handleAddStock = useCallback(async (stock: StockData) => {
    if (stocks.some(s => s.code === stock.code)) {
      return;
    }
    setStocks(prev => [...prev, stock]);
  }, [stocks]);

  const handleRemoveStock = useCallback((code: string) => {
    setStocks(prev => prev.filter(s => s.code !== code));
  }, []);

  const handleRefresh = () => {
    loadStocks();
  };

  const formatLastUpdate = () => {
    if (!lastUpdate) return '';
    return lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex items-center justify-between pb-4 border-b">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {lastUpdate && (
            <span className="text-xs text-muted-foreground">更新: {formatLastUpdate()}</span>
          )}
          <Button variant="ghost" size="icon-xs" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCwIcon className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => setIsEditMode(!isEditMode)}>
            {isEditMode ? <CheckIcon className="h-4 w-4" /> : <EditIcon className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {showSearch && (
        <div className="py-4">
          <StockSearch onSelect={handleAddStock} placeholder="搜索并添加股票..." />
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center h-32 text-destructive">
          <AlertIcon className="h-8 w-8 mb-2" />
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={handleRefresh} className="mt-2">重试</Button>
        </div>
      )}

      {!isLoading && !error && (
        <div className="flex-1 overflow-auto">
          <StockList
            stocks={stocks}
            removable={isEditMode}
            onRemove={handleRemoveStock}
            showDetails={showDetails}
          />
        </div>
      )}
    </div>
  );
}

function RefreshCwIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

export default StockWidget;
