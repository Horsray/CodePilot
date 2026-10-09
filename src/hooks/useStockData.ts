/**
 * 股票数据获取 Hook
 * 提供股票数据的自动刷新和状态管理
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { StockData, StockSettings, DEFAULT_STOCK_SETTINGS } from '../types/stock';
import { fetchStockData } from '../services/stockApi';

interface UseStockDataOptions {
  settings?: StockSettings;
  onError?: (error: Error) => void;
  onSuccess?: (data: StockData) => void;
}

interface UseStockDataReturn {
  data: StockData | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  lastUpdate: Date | null;
}

/**
 * 股票数据获取 Hook
 */
export function useStockData(options: UseStockDataOptions = {}): UseStockDataReturn {
  const { settings = DEFAULT_STOCK_SETTINGS, onError, onSuccess } = options;
  
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  
  // 使用 ref 追踪组件是否已卸载
  const isMountedRef = useRef(true);
  // 使用 ref 追踪上次的设置，避免不必要的重新获取
  const settingsRef = useRef(settings);

  const fetchData = useCallback(async () => {
    if (!settings.stockCode.trim()) {
      setError(new Error('请输入股票代码'));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const result = await fetchStockData([settings.stockCode]);
      
      if (isMountedRef.current) {
        setData(result[0] || null);
        setLastUpdate(new Date());
        setLoading(false);
        onSuccess?.(result[0] || null as unknown as StockData);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const error = err instanceof Error ? err : new Error('获取股票数据失败');
        setError(error);
        setLoading(false);
        onError?.(error);
      }
    }
  }, [settings.stockCode, onError, onSuccess]);

  // 初始加载和设置变化时重新获取
  useEffect(() => {
    const settingsChanged = JSON.stringify(settingsRef.current) !== JSON.stringify(settings);
    if (settingsChanged) {
      settingsRef.current = settings;
    }
    
    // 首次加载或设置变化时立即获取
    if (settingsChanged || !data) {
      fetchData();
    }
  }, [fetchData, settings.stockCode]);

  // 自动刷新
  useEffect(() => {
    // 清理函数标志
    let isActive = true;
    
    // 如果刷新间隔大于0，设置自动刷新
    if (settings.refreshInterval > 0) {
      const intervalId = setInterval(() => {
        if (isActive) {
          fetchData();
        }
      }, settings.refreshInterval * 1000);

      return () => {
        isActive = false;
        clearInterval(intervalId);
      };
    }

    return () => {
      isActive = false;
    };
  }, [fetchData, settings.refreshInterval]);

  // 组件卸载时标记
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
    lastUpdate,
  };
}

/**
 * 股票设置持久化 Hook
 * 使用 localStorage 保存用户设置
 */
export function useStockSettings() {
  const STORAGE_KEY = 'stock-widget-settings';

  const loadSettings = useCallback((): StockSettings => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      console.warn('读取股票设置失败，使用默认设置');
    }
    return DEFAULT_STOCK_SETTINGS;
  }, []);

  const saveSettings = useCallback((settings: StockSettings): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      console.warn('保存股票设置失败');
    }
  }, []);

  const [settings, setSettings] = useState<StockSettings>(loadSettings);

  const updateSettings = useCallback((newSettings: StockSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, [saveSettings]);

  return {
    settings,
    updateSettings,
    loadSettings,
  };
}
