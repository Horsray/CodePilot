'use client';

import { cn } from '@/lib/utils';

interface HueyingIconProps {
  size?: number;
  className?: string;
}

/**
 * HueyingIcon - 绘影智能体品牌图标组件
 * 引用 /public/icons/hueying-agent.png 图像资源
 */
export function HueyingIcon({ size = 16, className }: HueyingIconProps) {
  return (
    <img
      src="/icons/hueying-agent.png"
      alt="Hueying"
      width={size}
      height={size}
      className={cn('object-contain', className)}
    />
  );
}
