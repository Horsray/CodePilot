/**
 * 股票小组件主容器组件
 * 整合搜索、列表、数据刷新等功能
 */
'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Stock, SearchResult } from '@/types/stock';
import { StockSearch } from './StockSearch';
import { StockList } from './StockList';
import { Button } from '@/components/ui/button';
import { fetchStockData, fetchMultipleStocks, normalizeStockCode } from '@/services/stockApi';
import { getStoredWatchlist, addToWatchlist, removeFromWatchlist } from '@/utils/storage';
import { cn } from '@/lib/utils';

// 默认股票列表
const DEFAULT_STOCKS = ['sh600000', 'sh600036', 'sh601318', 'sz000001', 'sz002594'];

interface StockWidgetProps {
  /** 自定义类名 */
  className?: string;
  /** 是否显示搜索框 */
  showSearch?: boolean;
  /** 是否显示详细信息 */
  showDetails?: boolean;
  /** 初始股票列表（用于自定义） */
  initialStocks?: string[];
  /** 刷新间隔（毫秒），0表示不自动刷新 */
  refreshInterval?: number;
  /** 自定义标题 */
  title?: string;
}

export function StockWidget({
  className,
  showSearch = true,
  showDetails = false,
  initialStocks,
  refreshInterval = 30000,
  title = "股票行情"
}: StockWidgetProps) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const loadStocks = useCallback(async () => {
    let stockCodes = initialStocks || getStoredWatchlist().map(s => s.code);
    
    if (stockCodes.length === 0) {
      stockCodes = DEFAULT_STOCKS;
    }

    try {
      setIsRefreshing(true);
      const quotes = await fetchMultipleStocks(stockCodes);
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

  const handleAddStock = useCallback(async (stock: SearchResult) => {
    if (stocks.some(s => s.code === stock.code)) {
      return;
    }

    try {
      const normalizedCode = normalizeStockCode(stock.code);
      const quote = await fetchStockData(normalizedCode);
      setStocks(prev => [...prev, quote]);
      addToWatchlist(stock.code);
    } catch (err) {
      console.error('Failed to add stock:', err);
    }
  }, [stocks]);

  const handleRemoveStock = useCallback((code: string) => {
    setStocks(prev => prev.filter(s => s.code !== code));
    removeFromWatchlist(code);
  }, []);

  const handleStockClick = useCallback((stock: Stock) => {
    console.log('Stock clicked:', stock);
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
      {/* 标题栏 */}
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

      {/* 搜索框 */}
      {showSearch && (
        <div className="py-4">
          <StockSearch onSelect={handleAddStock} placeholder="搜索并添加股票..." />
        </div>
      )}

      {/* 加载状态 */}
      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {/* 错误状态 */}
      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center h-32 text-destructive">
          <AlertIcon className="h-8 w-8 mb-2" />
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={handleRefresh} className="mt-2">重试</Button>
        </div>
      )}

      {/* 股票列表 */}
      {!isLoading && !error && (
        <div className="flex-1 overflow-auto">
          <StockList
            stocks={stocks}
            removable={isEditMode}
            onRemove={handleRemoveStock}
            showDetails={showDetails}
            onStockClick={handleStockClick}
            emptyText="暂无自选股，请点击上方搜索添加"
          />
        </div>
      )}
    </div>
  );
}

// 图标组件
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
