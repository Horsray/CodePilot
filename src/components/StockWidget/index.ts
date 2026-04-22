/**
 * 股票小组件模块导出
 * 整合搜索、列表、卡片等子组件
 */

// 组件导出
export { StockCard } from './StockCard';
export { StockSearch } from './StockSearch';
export { StockList, SimpleStockList } from './StockList';
export { StockWidget } from './StockWidget';

// 类型导出
export type { Stock, SearchResult, StockTrend, MarketType } from '@/types/stock';

// API 函数导出
export { 
  fetchStockData, 
  fetchStockDataWithRetry,
  searchStocks,
  normalizeStockCode,
  isValidStockCode
} from '@/services/stockApi';

// 工具函数导出
export { 
  formatPrice, 
  formatChange, 
  formatVolume, 
  formatChangePercent,
  formatDate,
  formatTime,
  getChangeArrow,
  getChangeColorClass
} from '@/utils/formatters';

// 存储工具导出
export { 
  getStoredWatchlist,
  saveWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchlistOrder,
  isInWatchlist,
  clearWatchlist,
  getWatchlistCount
} from '@/utils/storage';
