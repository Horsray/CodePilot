/**
 * 新浪财经股票 API 服务
 * 数据来源: http://hq.sinajs.cn/list=<股票代码>
 */

import { StockData, StockTestResult, SearchResult, MarketType } from '../types/stock';
import {
  normalizeStockCode,
  isValidStockCode,
} from '../utils/stockUtils';

export { normalizeStockCode, isValidStockCode };

const SINA_STOCK_API = 'http://hq.sinajs.cn/list=';
const SINA_REFERRER = 'http://finance.sina.com.cn';

/**
 * 获取单只或多只股票数据 (新浪财经)
 * @param codes 股票代码或股票代码数组，如 'sh600519' 或 ['sh600519', 'sz000001']
 */
export async function fetchStockData(code: string): Promise<StockData>;
export async function fetchStockData(codes: string[]): Promise<StockData[]>;
export async function fetchStockData(codes: string | string[]): Promise<StockData | StockData[]> {
  const codeList = Array.isArray(codes) ? codes : [codes];
  if (codeList.length === 0) {
    return Array.isArray(codes) ? [] : emptyStock('');
  }

  const normalizedCodes = codeList.map(normalizeStockCode);
  const url = `${SINA_STOCK_API}${normalizedCodes.join(',')}`;

  const response = await fetch(url, {
    headers: {
      'Referer': SINA_REFERRER,
      'Accept': '*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const text = await response.text();
  const stocks = parseSinaStockData(text);
  return Array.isArray(codes) ? stocks : (stocks[0] || emptyStock(normalizedCodes[0]));
}

export async function fetchMultipleStocks(codes: string[]): Promise<StockData[]> {
  return fetchStockData(codes);
}

export async function fetchStockDataWithRetry(code: string, retries = 2): Promise<StockData> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchStockData(code);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('获取股票数据失败');
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (isValidStockCode(trimmed)) {
    const code = normalizeStockCode(trimmed);
    try {
      const stock = await fetchStockData(code);
      return [{ code: stock.code || code, name: stock.name || code, market: getStockExchange(code) }];
    } catch {
      return [{ code, name: code, market: getStockExchange(code) }];
    }
  }

  return [];
}

export function formatStockCode(code: string): string {
  return normalizeStockCode(code);
}

export function getStockExchange(code: string): MarketType {
  const normalized = normalizeStockCode(code);
  if (normalized.startsWith('sz')) return 'sz';
  if (normalized.startsWith('hk')) return 'hk';
  if (normalized.startsWith('gb_')) return 'us';
  return 'sh';
}

/**
 * 测试股票代码是否有效
 * @param code 股票代码，如 '600519' 或 'sh600519'
 * @returns 股票测试结果，包含名称和价格
 * @throws 如果股票代码无效或查询失败
 */
export async function testStockCode(code: string): Promise<StockTestResult> {
  const normalizedCode = normalizeStockCode(code);
  const stocks = await fetchStockData([normalizedCode]);

  if (stocks.length === 0) {
    throw new Error('未找到该股票');
  }

  const stock = stocks[0];
  return {
    name: stock.name,
    price: stock.price,
    code: normalizedCode,
  };
}

/**
 * 解析新浪财经返回的数据
 * 返回格式: var hq_str_sh600519="贵州茅台,1800.00,1798.00,1805.00,1818.00,1785.00,1800.00,1800.00,32234,51726.56,100,1800.00,200,1799.00,1100,1798.00,300,1795.00,200,1792.00,2022-04-01,15:00:00,00";
 */
function parseSinaStockData(data: string): StockData[] {
  const results: StockData[] = [];
  
  // 按分号分割，每只股票一段
  const stocks = data.split(';').filter(s => s.trim());

  for (const stock of stocks) {
    try {
      const parsed = parseSingleStock(stock);
      if (parsed) {
        results.push(parsed);
      }
    } catch (error) {
      console.warn('解析股票数据失败:', stock, error);
    }
  }

  return results;
}

/**
 * 解析单只股票数据
 */
function parseSingleStock(stockData: string): StockData | null {
  // 提取股票代码
  const codeMatch = stockData.match(/hq_str_(\w+)="([^"]+)"/);
  if (!codeMatch) {
    return null;
  }

  const code = codeMatch[1];
  const fields = codeMatch[2].split(',');

  // 确保有足够的数据字段
  if (fields.length < 32) {
    return null;
  }

  const name = fields[0];
  const open = parseFloat(fields[1]) || 0;
  const close = parseFloat(fields[2]) || 0;  // 昨日收盘价
  const price = parseFloat(fields[3]) || 0;
  const high = parseFloat(fields[4]) || 0;
  const low = parseFloat(fields[5]) || 0;
  const volume = parseInt(fields[8]) || 0;   // 成交量(股)
  const amount = parseFloat(fields[9]) || 0;  // 成交额(元)
  const date = fields[30] || '';
  const time = fields[31] || '';

  // 计算涨跌额和涨跌幅
  const change = price - close;
  const changePercent = close !== 0 ? (change / close) * 100 : 0;

  return {
    code,
    name,
    price,
    change,
    changePercent,
    open,
    close,
    high,
    low,
    volume,
    amount,
    time,
    date,
    previousClose: close,
    market: getStockExchange(code),
  };
}

function emptyStock(code: string): StockData {
  return {
    code,
    name: code,
    price: 0,
    change: 0,
    changePercent: 0,
    open: 0,
    close: 0,
    high: 0,
    low: 0,
    volume: 0,
    amount: 0,
    time: '',
    date: '',
    previousClose: 0,
    market: getStockExchange(code),
  };
}
