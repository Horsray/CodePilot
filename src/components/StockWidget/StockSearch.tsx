/**
 * 股票搜索组件
 * 支持按股票代码或名称搜索
 */
'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { searchStocks } from '@/services/stockApi';
import { SearchResult } from '@/types/stock';
import { cn } from '@/lib/utils';

interface StockSearchProps {
  /** 选择股票回调 */
  onSelect?: (stock: SearchResult) => void;
  /** 自定义类名 */
  className?: string;
  /** 占位符文本 */
  placeholder?: string;
}

export function StockSearch({
  onSelect,
  className,
  placeholder = "搜索股票代码或名称..."
}: StockSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const searchResults = await searchStocks(searchQuery);
      setResults(searchResults);
      setIsOpen(searchResults.length > 0);
    } catch (err) {
      setError('搜索失败，请稍后重试');
      console.error('Stock search error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        handleSearch(query);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, handleSearch]);

  const handleSelect = (stock: SearchResult) => {
    onSelect?.(stock);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setError(null);
  };

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pr-20"
          onFocus={() => results.length > 0 && setIsOpen(true)}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
          {query && (
            <Button variant="ghost" size="icon-xs" onClick={handleClear}>
              <XIcon className="h-3 w-3" />
            </Button>
          )}
          {isLoading && (
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          )}
        </div>
      </div>

      {error && <p className="text-xs text-destructive mt-1">{error}</p>}

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-60 overflow-auto">
          {results.map((stock) => (
            <button
              key={stock.code}
              className="w-full px-4 py-2 text-left hover:bg-accent transition-colors flex items-center justify-between"
              onClick={() => handleSelect(stock)}
            >
              <div>
                <span className="font-medium">{stock.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{stock.code}</span>
              </div>
              {stock.market && (
                <span className="text-xs text-muted-foreground">{stock.market.toUpperCase()}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && !isLoading && query && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg p-4 text-center text-sm text-muted-foreground">
          未找到相关股票
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

export default StockSearch;
