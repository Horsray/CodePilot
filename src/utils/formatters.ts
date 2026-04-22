/**
 * 数据格式化工具
 */

/**
 * 格式化价格
 */
export function formatPrice(price: number): string {
  if (price === 0) return '--';
  return price.toFixed(2);
}

/**
 * 格式化涨跌幅
 */
export function formatChangePercent(percent: number): string {
  if (percent === 0) return '0.00%';
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

/**
 * 格式化涨跌额
 */
export function formatChange(change: number): string {
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}`;
}

/**
 * 格式化成交量
 */
export function formatVolume(volume: number): string {
  if (volume >= 100000000) {
    return (volume / 100000000).toFixed(2) + '亿';
  }
  if (volume >= 10000) {
    return (volume / 10000).toFixed(2) + '万';
  }
  return volume.toString();
}

/**
 * 格式化成交额
 */
export function formatAmount(amount: number): string {
  if (amount >= 100000000) {
    return (amount / 100000000).toFixed(2) + '亿';
  }
  if (amount >= 10000) {
    return (amount / 10000).toFixed(2) + '万';
  }
  return amount.toFixed(2);
}

/**
 * 格式化时间
 */
export function formatTime(time: string): string {
  if (!time) return '--:--:--';
  return time;
}

/**
 * 格式化日期
 */
export function formatDate(date: string): string {
  if (!date) return '--';
  return date;
}

/**
 * 获取涨跌颜色类名
 */
export function getChangeColorClass(change: number): string {
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'unchanged';
}

/**
 * 获取涨跌箭头
 */
export function getChangeArrow(change: number): string {
  if (change > 0) return '▲';
  if (change < 0) return '▼';
  return '●';
}

/**
 * 格式化市场名称
 */
export function formatMarketName(market: string): string {
  const names: Record<string, string> = {
    sh: '上证',
    sz: '深证',
    hk: '港股',
    us: '美股',
  };
  return names[market] || market;
}

/**
 * 解析股票代码获取市场
 */
export function getMarketFromCode(code: string): string {
  if (code.startsWith('sh')) return 'sh';
  if (code.startsWith('sz')) return 'sz';
  if (code.startsWith('hk')) return 'hk';
  if (code.startsWith('gb_')) return 'us';
  return 'sh';
}