/**
 * 股票相关类型定义
 */

/**
 * 股票数据接口
 */
export interface StockData {
  code: string;           // 股票代码
  name: string;          // 股票名称
  price: number;         // 当前价格
  change: number;         // 涨跌额
  changePercent: number;  // 涨跌幅百分比
  open: number;           // 开盘价
  close: number;         // 昨日收盘价
  high: number;          // 最高价
  low: number;           // 最低价
  volume: number;        // 成交量(股)
  amount: number;        // 成交额(元)
  time: string;          // 更新时间
  date: string;          // 更新日期
  previousClose?: number; // 兼容旧版 StockWidget 字段
  market?: MarketType;    // 交易所/市场
}

export type MarketType = 'sh' | 'sz' | 'hk' | 'us';
export type StockTrend = 'up' | 'down' | 'flat';

export interface Stock {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open?: number;
  close?: number;
  previousClose?: number;
  high?: number;
  low?: number;
  volume?: number;
  amount?: number;
  time?: string;
  date?: string;
  market?: MarketType;
}

export interface SearchResult {
  code: string;
  name: string;
  market?: MarketType;
}

export interface StockApiResponse {
  stocks: Stock[];
  error?: string;
}

export interface StockWidgetProps {
  className?: string;
  showSearch?: boolean;
  showDetails?: boolean;
  initialStocks?: string[];
  refreshInterval?: number;
  title?: string;
}

export function getStockTrend(stock: Pick<StockData, 'change' | 'changePercent'>): StockTrend {
  if (stock.change > 0 || stock.changePercent > 0) return 'up';
  if (stock.change < 0 || stock.changePercent < 0) return 'down';
  return 'flat';
}

/**
 * 用户设置接口
 */
export interface StockSettings {
  stockCode: string;       // 股票代码，如 sh600519 或 600519
  refreshInterval: number; // 刷新间隔(秒)，最小5秒，最大300秒
}

/**
 * 设置面板状态
 */
export interface SettingsPanelState {
  isOpen: boolean;
  inputCode: string;
  isTesting: boolean;
  testResult: 'idle' | 'success' | 'error';
  testMessage: string;
}

/**
 * 股票测试结果
 */
export interface StockTestResult {
  name: string;           // 股票名称
  price: number;          // 当前价格
  code: string;          // 标准化后的股票代码
}

/**
 * Hook 返回数据类型
 */
export interface UseStockDataReturn {
  data: StockData | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * 默认股票设置
 */
export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  stockCode: 'sh600519',  // 贵州茅台
  refreshInterval: 30    // 30秒刷新一次
};
