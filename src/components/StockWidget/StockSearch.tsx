/**
 * 股票搜索组件
 * 中文注释：功能名称「股票搜索」，用法是支持按股票代码或名称搜索。
 */
'use client';

import React, { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StockData } from '@/types/stock';
import { cn } from '@/lib/utils';

interface StockSearchProps {
  onSelect?: (stock: StockData) => void;
  className?: string;
  placeholder?: string;
}

export function StockSearch({
  onSelect,
  className,
  placeholder = '输入股票代码或名称搜索...'
}: StockSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const { fetchStockData } = await import('@/services/stockApi');
      const data = await fetchStockData([query.trim()]);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} disabled={loading || !query.trim()}>
          {loading ? '搜索中...' : '搜索'}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((stock) => (
            <div
              key={stock.code}
              className="p-2 hover:bg-muted rounded cursor-pointer text-sm"
              onClick={() => onSelect?.(stock)}
            >
              {stock.name} ({stock.code}) - {stock.price.toFixed(2)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default StockSearch;
