import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchStockData } from '../services/stockApi';
import { StockData } from '../types/stock';

/**
 * 股票数据Hook
 * 支持自动刷新功能
 * 
 * @param code 股票代码
 * @param autoRefresh 是否自动刷新，默认true
 * @param refreshInterval 刷新间隔(ms)，默认1000（1秒）
 */
export function useStockData(
  code: string,
  autoRefresh: boolean = true,
  refreshInterval: number = 1000
) {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  
  // 使用ref存储上一次的code，防止闭包问题
  const codeRef = useRef(code);
  codeRef.current = code;
  
  // 获取数据的函数
  const fetchData = useCallback(async () => {
    // 如果没有股票代码，不获取数据
    if (!codeRef.current) {
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await fetchStockData(codeRef.current);
      setData(result);
      setLastUpdate(new Date());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '获取股票数据失败';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);
  
  // 手动刷新函数
  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);
  
  // 设置自动刷新
  useEffect(() => {
    // 初始加载
    fetchData();
    
    // 如果启用自动刷新，设置定时器
    if (autoRefresh && codeRef.current) {
      const timer = setInterval(() => {
        fetchData();
      }, refreshInterval);
      
      return () => {
        clearInterval(timer);
      };
    }
  }, [fetchData, autoRefresh, refreshInterval]);
  
  return {
    data,           // 股票数据
    loading,        // 加载状态
    error,          // 错误信息
    lastUpdate,     // 最后更新时间
    refresh,        // 手动刷新函数
    isPositive: data ? data.change >= 0 : null  // 是否上涨
  };
}

/**
 * 简化版股票数据Hook
 * 适用于不需要手动控制的场景
 */
export function useSimpleStockData(
  code: string,
  refreshInterval: number = 1000
) {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    let mounted = true;
    
    const updateData = async () => {
      if (!code) {
        setLoading(false);
        return;
      }
      
      try {
        const result = await fetchStockData(code);
        if (mounted) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : '获取股票数据失败');
        }
      }
    };
    
    // 初始加载
    updateData();
    setLoading(false);
    
    // 设置定时刷新
    const timer = setInterval(() => {
      updateData();
    }, refreshInterval);
    
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [code, refreshInterval]);
  
  return { data, loading, error };
}
