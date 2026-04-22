import { StockData, StockApiResponse, SearchResult } from '../types/stock';

// 新浪财经API基地址
const SINA_API_BASE = 'https://hq.sinajs.cn/list=';

// 判断股票交易市场
function getMarket(code: string): 'sh' | 'sz' {
  // 上海股票以600、601、603、688开头
  if (/^(600|601|603|688)\d{3}$/.test(code)) {
    return 'sh';
  }
  // 深圳股票以000、001、002、003、300开头
  if (/^(000|001|002|003|300)\d{3}$/.test(code)) {
    return 'sz';
  }
  // 默认返回上海
  return 'sh';
}

/**
 * 获取股票数据
 * 使用新浪财经API
 * @param code 股票代码（如: 600001, 000001）
 */
export async function fetchStockData(code: string): Promise<StockData> {
  const market = getMarket(code);
  const fullCode = `${market}${code}`;
  
  try {
    // 使用fetch调用新浪财经API
    const response = await fetch(`${SINA_API_BASE}${fullCode}`, {
      headers: {
        'Referer': 'https://finance.sina.com.cn',
        'Accept': '*/*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const text = await response.text();
    
    // 解析新浪财经返回的数据格式
    // 格式: var hq_str_sh600001="name,open,yclose,price,high,low,buy,sell,volume,amount,time,date,...";
    const match = text.match(/="([^"]+)"/);
    
    if (!match || !match[1]) {
      throw new Error('无法解析股票数据');
    }
    
    const parts = match[1].split(',');
    
    if (parts.length < 32) {
      throw new Error('股票数据格式不正确');
    }
    
    // 解析数据字段
    const [
      name,      // 0: 股票名称
      open,      // 1: 开盘价
      yclose,    // 2: 昨收价
      price,     // 3: 当前价格
      high,      // 4: 最高价
      low,       // 5: 最低价
      buy,       // 6: 买一价
      sell,      // 7: 卖一价
      volume,    // 8: 成交量（股）
      amount,    // 9: 成交额（元）
      b1vol,     // 10: 买一成交量
      b1price,   // 11: 买一价格
      b2vol,     // 12: 买二成交量
      b2price,   // 13: 买二价格
      b3vol,     // 14: 买三成交量
      b3price,   // 15: 买三价格
      b4vol,     // 16: 买四成交量
      b4price,   // 17: 买四价格
      b5vol,     // 18: 买五成交量
      b5price,   // 19: 买五价格
      s1vol,     // 20: 卖一成交量
      s1price,   // 21: 卖一价格
      s2vol,     // 22: 卖二成交量
      s2price,   // 23: 卖二价格
      s3vol,     // 24: 卖三成交量
      s3price,   // 25: 卖三价格
      s4vol,     // 26: 卖四成交量
      s4price,   // 27: 卖四价格
      s5vol,     // 28: 卖五成交量
      s5price,   // 29: 卖五价格
      date,      // 30: 日期
      time,      // 31: 时间
      _          // 32: 未知
    ] = parts;
    
    const currentPrice = parseFloat(price) || 0;
    const yesterdayClose = parseFloat(yclose) || 0;
    const change = currentPrice - yesterdayClose;
    const changePercent = yesterdayClose > 0 ? (change / yesterdayClose) * 100 : 0;
    
    return {
      code: code,
      name: name || '未知',
      price: currentPrice,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      open: parseFloat(open) || 0,
      high: parseFloat(high) || 0,
      low: parseFloat(low) || 0,
      volume: parseInt(volume) || 0,
      amount: parseFloat(amount) || 0,
      time: `${date} ${time}`
    };
    
  } catch (error) {
    console.error('获取股票数据失败:', error);
    throw error instanceof Error ? error : new Error('获取股票数据失败');
  }
}

/**
 * 批量获取股票数据
 * @param codes 股票代码数组
 */
export async function fetchMultipleStocks(codes: string[]): Promise<StockData[]> {
  const results: StockData[] = [];
  
  for (const code of codes) {
    try {
      const data = await fetchStockData(code);
      results.push(data);
    } catch (error) {
      console.error(`获取股票 ${code} 数据失败:`, error);
    }
  }
  
  return results;
}

/**
 * 格式化股票代码（添加市场前缀）
 * @param code 股票代码
 */
export function formatStockCode(code: string): string {
  const market = getMarket(code);
  return `${market}${code}`;
}

/**
 * 获取股票对应的交易所
 * @param code 股票代码
 */
export function getStockExchange(code: string): string {
  return getMarket(code) === 'sh' ? '上海' : '深圳';
}

/**
 * 带重试的股票数据获取
 * @param code 股票代码
 * @param maxRetries 最大重试次数
 * @param delay 重试延迟(ms)
 */
export async function fetchStockDataWithRetry(
  code: string,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<StockData> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchStockData(code);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('获取股票数据失败');
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('获取股票数据失败');
}

/**
 * 搜索股票（通过名称或代码）
 * @param query 搜索关键词
 */
export async function searchStocks(query: string): Promise<SearchResult[]> {
  const searchCode = query.trim();
  if (!searchCode) return [];
  
  try {
    const data = await fetchStockData(searchCode);
    return [{
      code: data.code,
      name: data.name,
      market: data.market || getMarket(data.code)
    }];
  } catch {
    return [];
  }
}

/**
 * 规范化股票代码（移除空格和特殊字符）
 * @param code 股票代码
 */
export function normalizeStockCode(code: string): string {
  return code.replace(/[\s\u4e00-\u9fa5]/g, '').replace(/^(sh|sz|sx)/i, '');
}

/**
 * 验证股票代码格式是否正确
 * @param code 股票代码
 */
export function isValidStockCode(code: string): boolean {
  const normalized = normalizeStockCode(code);
  return /^(600|601|603|688|000|001|002|003|300)\d{3}$/.test(normalized);
}
