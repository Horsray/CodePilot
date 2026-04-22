import React, { useState, useRef, useEffect } from 'react';
import { useStockData } from '../../hooks/useStockData';
import { StockData } from '../../types/stock';

interface StockWidgetProps {
  initialCode?: string;        // 初始股票代码
  width?: number;              // 组件宽度，默认290px
  autoRefresh?: boolean;       // 是否自动刷新，默认true
  refreshInterval?: number;    // 刷新间隔(ms)，默认1000
  onCodeChange?: (code: string) => void;  // 股票代码变化回调
}

/**
 * 股票小组件
 * 功能：
 * 1. 宽度收窄到290px
 * 2. 仅显示一条股票行情
 * 3. 点击可输入股票代码联网查询
 * 4. 每1秒自动刷新
 */
export function StockWidget({
  initialCode = '600519',  // 默认显示茅台
  width = 290,
  autoRefresh = true,
  refreshInterval = 1000,
  onCodeChange
}: StockWidgetProps) {
  // 股票代码状态
  const [code, setCode] = useState(initialCode);
  // 输入框值状态
  const [inputValue, setInputValue] = useState(initialCode);
  // 是否处于编辑模式
  const [isEditing, setIsEditing] = useState(false);
  // 输入框引用
  const inputRef = useRef<HTMLInputElement>(null);
  
  // 获取股票数据
  const { data, loading, error, lastUpdate, refresh } = useStockData(
    code,
    autoRefresh,
    refreshInterval
  );
  
  // 当股票代码变化时，调用回调
  useEffect(() => {
    if (onCodeChange) {
      onCodeChange(code);
    }
  }, [code, onCodeChange]);
  
  // 当进入编辑模式时，自动聚焦输入框
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);
  
  // 处理表单提交
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const trimmedCode = inputValue.trim();
    if (trimmedCode && /^\d{6}$/.test(trimmedCode)) {
      setCode(trimmedCode);
      setIsEditing(false);
    }
  };
  
  // 处理点击事件（进入编辑模式）
  const handleContainerClick = () => {
    setIsEditing(true);
    setInputValue(code);
  };
  
  // 处理输入框点击（阻止冒泡）
  const handleInputClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };
  
  // 处理ESC键退出编辑
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue(code);
    }
  };
  
  // 格式化数字（添加千分位）
  const formatNumber = (num: number): string => {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  // 格式化成交量
  const formatVolume = (volume: number): string => {
    if (volume >= 100000000) {
      return (volume / 100000000).toFixed(2) + '亿';
    } else if (volume >= 10000) {
      return (volume / 10000).toFixed(2) + '万';
    }
    return volume.toString();
  };
  
  // 判断涨跌颜色
  const getChangeColor = (): string => {
    if (!data) return '#666';
    return data.change >= 0 ? '#ef4444' : '#22c55e';
  };
  
  // 获取涨跌符号
  const getChangeSign = (): string => {
    if (!data) return '';
    return data.change >= 0 ? '+' : '';
  };
  
  // 获取交易所提示
  const getExchangeHint = (stockCode: string): string => {
    if (/^(600|601|603|688)\d{3}$/.test(stockCode)) {
      return '上证';
    }
    if (/^(000|001|002|003|300)\d{3}$/.test(stockCode)) {
      return '深证';
    }
    return '';
  };
  
  return (
    <div
      onClick={handleContainerClick}
      style={{
        width: `${width}px`,
        minHeight: '120px',
        padding: '12px',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        backgroundColor: '#ffffff',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.12)';
        e.currentTarget.style.borderColor = '#d1d5db';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
        e.currentTarget.style.borderColor = '#e5e7eb';
      }}
    >
      {/* 编辑模式 - 输入股票代码 */}
      {isEditing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{
            fontSize: '11px',
            color: '#6b7280',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span>📝</span>
            <span>点击输入股票代码（6位数字）</span>
          </div>
          <form onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onClick={handleInputClick}
              onKeyDown={handleKeyDown}
              placeholder="如: 600519"
              maxLength={6}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '2px solid #3b82f6',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '500',
                textAlign: 'center',
                letterSpacing: '2px',
                outline: 'none',
                boxSizing: 'border-box',
                backgroundColor: '#f0f9ff'
              }}
            />
            <div style={{
              marginTop: '8px',
              fontSize: '10px',
              color: '#9ca3af',
              textAlign: 'center'
            }}>
              按 Enter 确认 | Esc 取消
            </div>
          </form>
        </div>
      ) : (
        <>
          {/* 股票代码标签 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                fontSize: '12px',
                fontWeight: '600',
                color: '#374151',
                backgroundColor: '#f3f4f6',
                padding: '2px 8px',
                borderRadius: '4px'
              }}>
                {getExchangeHint(code)} {code}
              </span>
              {autoRefresh && (
                <span style={{
                  fontSize: '10px',
                  color: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px'
                }}>
                  <span style={{
                    display: 'inline-block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: '#10b981',
                    animation: 'pulse 1s ease-in-out infinite'
                  }}></span>
                  实时
                </span>
              )}
            </div>
            <span style={{
              fontSize: '10px',
              color: '#9ca3af'
            }}>
              点击修改
            </span>
          </div>
          
          {/* 加载状态 */}
          {loading && !data && (
            <div style={{
              textAlign: 'center',
              padding: '20px 0',
              color: '#6b7280'
            }}>
              <div style={{
                width: '24px',
                height: '24px',
                border: '3px solid #e5e7eb',
                borderTopColor: '#3b82f6',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 8px'
              }}></div>
              <span style={{ fontSize: '12px' }}>加载中...</span>
            </div>
          )}
          
          {/* 错误状态 */}
          {error && !data && (
            <div style={{
              textAlign: 'center',
              padding: '16px 0',
              color: '#ef4444'
            }}>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>⚠️</div>
              <div style={{ fontSize: '12px' }}>{error}</div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  refresh();
                }}
                style={{
                  marginTop: '8px',
                  padding: '4px 12px',
                  fontSize: '11px',
                  backgroundColor: '#fef2f2',
                  color: '#ef4444',
                  border: '1px solid #fecaca',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                重试
              </button>
            </div>
          )}
          
          {/* 股票数据展示 */}
          {data && (
            <div>
              {/* 股票名称 */}
              <div style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#1f2937',
                marginBottom: '4px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {data.name}
              </div>
              
              {/* 当前价格 */}
              <div style={{
                fontSize: '28px',
                fontWeight: '700',
                color: getChangeColor(),
                marginBottom: '4px',
                lineHeight: '1.2'
              }}>
                ¥{formatNumber(data.price)}
              </div>
              
              {/* 涨跌信息 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '13px',
                color: getChangeColor(),
                marginBottom: '8px'
              }}>
                <span>
                  {getChangeSign()}{formatNumber(data.change)} {getChangeSign()}{data.changePercent.toFixed(2)}%
                </span>
                <span style={{
                  fontSize: '11px',
                  padding: '1px 6px',
                  backgroundColor: data.change >= 0 ? '#fef2f2' : '#f0fdf4',
                  borderRadius: '3px',
                  fontWeight: '500'
                }}>
                  {data.change >= 0 ? '涨' : '跌'}
                </span>
              </div>
              
              {/* 行情详情 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid #f3f4f6',
                fontSize: '11px',
                color: '#6b7280'
              }}>
                <div>
                  <div style={{ marginBottom: '2px' }}>开盘</div>
                  <div style={{ fontWeight: '500', color: '#374151' }}>
                    {formatNumber(data.open ?? 0)}
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: '2px' }}>最高</div>
                  <div style={{ fontWeight: '500', color: '#374151' }}>
                    {formatNumber(data.high ?? 0)}
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: '2px' }}>最低</div>
                  <div style={{ fontWeight: '500', color: '#374151' }}>
                    {formatNumber(data.low ?? 0)}
                  </div>
                </div>
              </div>
              
              {/* 成交量 */}
              <div style={{
                marginTop: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: '#9ca3af'
              }}>
                <span>成交量: {formatVolume(data.volume ?? 0)}</span>
                <span>成交额: {formatVolume(data.amount ?? 0)}</span>
              </div>
              
              {/* 更新时间 */}
              {lastUpdate && (
                <div style={{
                  marginTop: '6px',
                  fontSize: '10px',
                  color: '#d1d5db',
                  textAlign: 'right'
                }}>
                  {lastUpdate.toLocaleTimeString('zh-CN')}
                </div>
              )}
            </div>
          )}
        </>
      )}
      
      {/* CSS动画 */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

export default StockWidget;
