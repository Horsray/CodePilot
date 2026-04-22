/**
 * 股票小组件演示页面
 * 访问 /stock-demo 查看效果
 */
'use client';

import { StockWidget } from '@/components/StockWidget';

export default function StockDemoPage() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">股票小组件演示</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 基础版本 */}
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">基础版本</h3>
          <StockWidget title="实时行情" />
        </div>
        
        {/* 详细版本 */}
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">显示详情</h3>
          <StockWidget title="我的自选股" showDetails={true} />
        </div>
        
        {/* 简洁版本 */}
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">简洁版（无搜索）</h3>
          <StockWidget title="关注列表" showSearch={false} />
        </div>
        
        {/* 快速刷新 */}
        <div className="bg-card rounded-lg border p-4 shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">快速刷新（10秒）</h3>
          <StockWidget title="快讯" refreshInterval={10000} />
        </div>
      </div>
    </div>
  );
}
