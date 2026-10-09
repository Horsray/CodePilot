/**
 * 股票小组件使用示例
 * 中文注释：功能名称「股票组件示例」，用法是展示股票组件的基本使用方式。
 */

import React from 'react';
import { StockWidget } from './StockWidget';
import { StockData } from '@/types/stock';

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

export default StockWidgetDemo;
