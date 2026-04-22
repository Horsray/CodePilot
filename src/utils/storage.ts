/**
 * 本地存储工具 - 自选股持久化管理
 */

const STORAGE_KEY = 'stock_watchlist';

/**
 * 存储的股票项结构
 */
export interface StoredStock {
  code: string;
  addedAt: number;
  sortOrder: number;
}

/**
 * 获取本地存储的自选股列表
 */
export function getStoredWatchlist(): StoredStock[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * 保存自选股列表到本地存储
 */
export function saveWatchlist(list: StoredStock[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save watchlist:', e);
  }
}

/**
 * 添加股票到自选股
 */
export function addToWatchlist(code: string): StoredStock[] {
  const list = getStoredWatchlist();
  if (list.some(item => item.code === code)) {
    return list;
  }
  const newItem: StoredStock = {
    code,
    addedAt: Date.now(),
    sortOrder: list.length,
  };
  const newList = [...list, newItem];
  saveWatchlist(newList);
  return newList;
}

/**
 * 从自选股移除
 */
export function removeFromWatchlist(code: string): StoredStock[] {
  const list = getStoredWatchlist().filter(item => item.code !== code);
  saveWatchlist(list);
  return list;
}

/**
 * 更新自选股排序
 */
export function updateWatchlistOrder(codes: string[]): void {
  const list = getStoredWatchlist();
  const updated = codes.map((code, index) => {
    const item = list.find(i => i.code === code);
    return item ? { ...item, sortOrder: index } : { code, addedAt: Date.now(), sortOrder: index };
  });
  saveWatchlist(updated);
}

/**
 * 检查股票是否已在自选股中
 */
export function isInWatchlist(code: string): boolean {
  const list = getStoredWatchlist();
  return list.some(item => item.code === code);
}

/**
 * 清空自选股
 */
export function clearWatchlist(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 获取自选股数量
 */
export function getWatchlistCount(): number {
  return getStoredWatchlist().length;
}