// 股票数据类型定义
export interface StockData {
  code: string;       // 股票代码
  name: string;       // 股票名称
  price: number;      // 当前价格
  change: number;     // 涨跌额
  changePercent: number;  // 涨跌幅百分比
  open?: number;       // 开盘价
  high?: number;       // 最高价
  low?: number;        // 最低价
  volume?: number;     // 成交量
  amount?: number;     // 成交额
  time?: string;       // 更新时间
  market?: string;    // 市场标识 (sh/sz/hk/us)
  previousClose?: number;  // 昨收价
}

// 股票类型别名（与 StockData 相同，用于组件兼容性）
export type Stock = StockData;

// 股票趋势类型
export type StockTrend = 'up' | 'down' | 'flat';

// 股票市场类型
export type MarketType = 'sh' | 'sz' | 'sx';

// 搜索结果类型
export interface SearchResult {
  code: string;
  name: string;
  market: string;
}

/**
 * 根据涨跌额获取股票趋势
 * @param stock 股票数据
 */
export function getStockTrend(stock: StockData): StockTrend {
  if (stock.change > 0) return 'up';
  if (stock.change < 0) return 'down';
  return 'flat';
}

export interface StockWidgetProps {
  initialCode?: string;      // 初始股票代码
  width?: number;            // 组件宽度，默认290px
  autoRefresh?: boolean;     // 是否自动刷新，默认true
  refreshInterval?: number;  // 刷新间隔(ms)，默认1000
}

// API响应类型
export interface StockApiResponse {
  success: boolean;
  data?: StockData;
  error?: string;
}
