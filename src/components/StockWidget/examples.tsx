/**
 * 股票小组件使用示例
 */

import React from 'react';
import { StockWidget, StockCard, StockSearch, StockList } from './index';
import { Stock } from '@/types/stock';

// 示例1: 基础使用 - 全功能小组件
export function StockWidgetDemo() {
  return (
    <div className="w-full max-w-md p-4 border rounded-lg">
      <StockWidget 
        title="我的自选股"
        refreshInterval={30000}
        showSearch={true}
        showDetails={true}
      />
    </div>
  );
}

// 示例2: 简化列表
export function SimpleStockListDemo() {
  const mockStocks: Stock[] = [
    { code: 'sh600000', name: '浦发银行', price: 8.50, change: 0.15, changePercent: 1.8, volume: 15000000 },
    { code: 'sh600036', name: '招商银行', price: 35.20, change: -0.30, changePercent: -0.85, volume: 25000000 },
    { code: 'sz000001', name: '平安银行', price: 12.80, change: 0.20, changePercent: 1.59, volume: 18000000 },
  ];

  return (
    <div className="w-full max-w-md p-4 border rounded-lg">
      <StockList 
        stocks={mockStocks}
        layout="list"
        onStockClick={(stock) => console.log('Clicked:', stock)}
      />
    </div>
  );
}

// 示例3: 网格卡片布局
export function StockGridDemo() {
  const mockStocks: Stock[] = [
    { code: 'sh600000', name: '浦发银行', price: 8.50, change: 0.15, changePercent: 1.8, volume: 15000000, market: 'sh' as const },
    { code: 'sh600036', name: '招商银行', price: 35.20, change: -0.30, changePercent: -0.85, volume: 25000000, market: 'sh' as const },
    { code: 'sz000001', name: '平安银行', price: 12.80, change: 0.20, changePercent: 1.59, volume: 18000000, market: 'sz' as const },
    { code: 'hk00700', name: '腾讯控股', price: 380.00, change: 5.00, changePercent: 1.33, volume: 12000000, market: 'hk' as const },
  ];

  return (
    <div className="w-full p-4 border rounded-lg">
      <StockList 
        stocks={mockStocks}
        layout="grid"
        columns={2}
        showDetails={true}
        removable={true}
        onRemove={(code) => console.log('Remove:', code)}
      />
    </div>
  );
}

// 示例4: 单独使用股票卡片
export function SingleStockCardDemo() {
  const stock: Stock = {
    code: 'sh600000',
    name: '浦发银行',
    price: 8.50,
    change: 0.15,
    changePercent: 1.8,
    volume: 15000000,
    high: 8.60,
    low: 8.40,
    open: 8.35,
    previousClose: 8.35,
    market: 'sh'
  };

  return (
    <div className="w-80 p-4">
      <StockCard 
        stock={stock}
        showDetails={true}
        removable={true}
        onRemove={(code) => console.log('Remove:', code)}
      />
    </div>
  );
}

// 示例5: 单独使用搜索组件
export function SearchOnlyDemo() {
  return (
    <div className="w-full max-w-sm p-4">
      <StockSearch 
        onSelect={(stock) => console.log('Selected:', stock)}
        placeholder="输入股票代码或名称搜索..."
      />
    </div>
  );
}

// 示例6: 自定义初始股票列表
export function CustomStocksDemo() {
  const initialCodes = ['sh601318', 'sh600519', 'sz002594'];
  
  return (
    <div className="w-full max-w-md p-4 border rounded-lg">
      <StockWidget 
        initialStocks={initialCodes}
        refreshInterval={60000}
        showSearch={true}
      />
    </div>
  );
}

export default {
  StockWidgetDemo,
  SimpleStockListDemo,
  StockGridDemo,
  SingleStockCardDemo,
  SearchOnlyDemo,
  CustomStocksDemo
};
