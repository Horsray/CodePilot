/**
 * 股票相关工具函数
 */

/**
 * 规范化股票代码格式
 * - 输入: '600519' 或 'sh600519' 或 'SH600519'
 * - 输出: 'sh600519' 或 'sz000001'
 * 
 * 规则:
 * - 以6开头的6位数字 -> sh
 * - 以0或3开头的6位数字 -> sz
 * - 已经带sh/sz前缀的直接返回
 */
export function normalizeStockCode(code: string): string {
  const trimmed = code.trim().toLowerCase();
  
  // 如果已经带有前缀，直接返回小写
  if (trimmed.startsWith('sh') || trimmed.startsWith('sz')) {
    return trimmed;
  }
  
  // 如果是6位数字，根据首数字判断
  if (/^\d{6}$/.test(trimmed)) {
    if (trimmed.startsWith('6')) {
      return `sh${trimmed}`;
    }
    if (trimmed.startsWith('0') || trimmed.startsWith('3')) {
      return `sz${trimmed}`;
    }
  }
  
  // 返回原始值（可能是其他类型股票代码）
  return trimmed;
}

/**
 * 格式化价格显示
 * @param price 价格
 * @param decimals 小数位数，默认2位
 */
export function formatPrice(price: number, decimals: number = 2): string {
  return price.toFixed(decimals);
}

/**
 * 格式化涨跌幅显示
 * @param percent 涨跌幅百分比
 */
export function formatChangePercent(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

/**
 * 格式化涨跌额显示
 * @param change 涨跌额
 */
export function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}`;
}

/**
 * 格式化成交量显示
 * @param volume 成交量(股)
 */
export function formatVolume(volume: number): string {
  if (volume >= 100000000) {
    return `${(volume / 100000000).toFixed(2)}亿`;
  }
  if (volume >= 10000) {
    return `${(volume / 10000).toFixed(2)}万`;
  }
  return volume.toString();
}

/**
 * 格式化成交额显示
 * @param amount 成交额(元)
 */
export function formatAmount(amount: number): string {
  if (amount >= 100000000) {
    return `${(amount / 100000000).toFixed(2)}亿`;
  }
  if (amount >= 10000) {
    return `${(amount / 10000).toFixed(2)}万`;
  }
  return amount.toFixed(2);
}

/**
 * 获取涨跌状态样式类名
 * @param change 涨跌额
 */
export function getChangeClass(change: number): 'up' | 'down' | 'neutral' {
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'neutral';
}

/**
 * 验证股票代码格式是否有效
 * @param code 股票代码
 */
export function isValidStockCode(code: string): boolean {
  const trimmed = code.trim();
  
  // 6位纯数字
  if (/^\d{6}$/.test(trimmed)) {
    return true;
  }
  
  // sh/sz 前缀 + 6位数字
  if (/^(sh|sz)\d{6}$/i.test(trimmed)) {
    return true;
  }
  
  return false;
}

/**
 * 获取股票市场的简称
 * @param code 股票代码
 */
export function getMarketName(code: string): string {
  const normalized = normalizeStockCode(code);
  if (normalized.startsWith('sh')) {
    return '上海';
  }
  if (normalized.startsWith('sz')) {
    return '深圳';
  }
  return '未知';
}
