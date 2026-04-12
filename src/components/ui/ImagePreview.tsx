"use client";

import { useState } from "react";
import Image from "next/image";
import { ZoomIn, ExternalLink } from "lucide-react";
import { ImageViewer } from "./ImageViewer";

/**
 * 图片预览组件 - 显示缩略图，点击打开大图查看器
 * @description 聊天消息中的图片展示，支持多图预览
 */
interface ImagePreviewProps {
  images: { src: string; alt?: string }[];
  maxWidth?: number;
  maxHeight?: number;
  layout?: "grid" | "flex";
}

export function ImagePreview({ images, maxWidth = 400, maxHeight = 300, layout = "grid" }: ImagePreviewProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // 打开查看器
  const openViewer = (index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  };

  // 单图展示
  if (images.length === 1) {
    return (
      <>
        <div
          className="relative group cursor-pointer rounded-lg overflow-hidden border border-zinc-700 hover:border-blue-500 transition-all"
          style={{ maxWidth, maxHeight }}
          onClick={() => openViewer(0)}
        >
          <Image
            src={images[0].src}
            alt={images[0].alt || "图片"}
            width={maxWidth}
            height={maxHeight}
            className="w-full h-auto object-cover"
            style={{ maxHeight }}
            unoptimized={images[0].src.startsWith("data:") || images[0].src.startsWith("blob:")}
          />
          {/* 悬停遮罩 */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <ZoomIn className="w-8 h-8 text-white" />
            </div>
          </div>
        </div>

        {viewerOpen && (
          <ImageViewer images={images} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
        )}
      </>
    );
  }

  // 多图网格展示
  const gridClass =
    images.length === 2
      ? "grid grid-cols-2 gap-1"
      : images.length === 3
      ? "grid grid-cols-2 gap-1"
      : "grid grid-cols-2 gap-1";

  return (
    <>
      <div className={gridClass} style={{ maxWidth }}>
        {images.slice(0, 4).map((img, idx) => (
          <div
            key={idx}
            className="relative group cursor-pointer rounded-lg overflow-hidden border border-zinc-700 hover:border-blue-500 transition-all"
            style={{
              gridColumn: images.length === 3 && idx === 0 ? "span 2" : undefined,
            }}
            onClick={() => openViewer(idx)}
          >
            <Image
              src={img.src}
              alt={img.alt || `图片 ${idx + 1}`}
              width={images.length === 3 && idx === 0 ? 800 : 400}
              height={images.length === 3 && idx === 0 ? 300 : 200}
              className={`w-full object-cover ${images.length === 3 && idx === 0 ? "h-48" : "h-32"}`}
              unoptimized={img.src.startsWith("data:") || img.src.startsWith("blob:")}
            />
            {/* 更多图片提示 */}
            {idx === 3 && images.length > 4 && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span className="text-white text-xl font-semibold">+{images.length - 4}</span>
              </div>
            )}
            {/* 悬停遮罩 */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {viewerOpen && (
        <ImageViewer images={images} initialIndex={viewerIndex} onClose={() => setViewerOpen(false)} />
      )}
    </>
  );
}
