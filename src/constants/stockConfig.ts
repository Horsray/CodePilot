/**
 * 股票小组件配置常量
 */

// 默认配置
export const DEFAULT_CONFIG = {
  refreshInterval: 30000,  // 30秒
  maxWatchlist: 50,
  theme: 'light' as const,
};

// API地址
export const API_CONFIG = {
  SINA_REALTIME: 'https://hq.sinajs.cn/list=',
  SINA_SEARCH: 'https://suggest3.sinajs.cn/suggest',
  TENCENT_QUOTE: 'https://qt.gtimg.cn/q=',
  EASTMONEY_QUOTE: 'http://push2.eastmoney.com/api/qt/stock/get',
};

// 市场前缀映射
export const MARKET_PREFIX: Record<string, string> = {
  sh: 'sh',    // 上证
  sz: 'sz',    // 深证
  hk: 'hk',    // 港股
  us: 'gb_',   // 美股
};

// 市场名称
export const MARKET_NAMES: Record<string, string> = {
  sh: '上证',
  sz: '深证',
  hk: '港股',
  us: '美股',
};

// 股票类型
export const STOCK_TYPES: Record<string, string> = {
  '11': '沪市A股',
  '12': '深市A股',
  '13': '沪市B股',
  '14': '深市B股',
  '15': '沪市ETF',
  '31': '港股',
  '41': '美股',
};

// 颜色配置
export const COLORS = {
  up: '#ee0000',       // 涨
  down: '#00a000',     // 跌
  unchanged: '#666666', // 平
};

// 搜索类型代码
export const SEARCH_TYPES = '11,12,13,14,15,31,41';