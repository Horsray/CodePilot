"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { X, ZoomIn, ChevronLeft, ChevronRight, Download } from "lucide-react";

/**
 * 图片查看器组件 - 全屏查看大图
 * @description 提供图片全屏查看、缩放、左右切换功能
 */
interface ImageViewerProps {
  images: { src: string; alt?: string }[];
  initialIndex?: number;
  onClose: () => void;
}

export function ImageViewer({ images, initialIndex = 0, onClose }: ImageViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);

  const currentImage = images[currentIndex];

  // 切换上一张
  const goPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    setScale(1);
  }, [images.length]);

  // 切换下一张
  const goNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    setScale(1);
  }, [images.length]);

  // 放大/缩小
  const handleZoom = (direction: "in" | "out") => {
    setScale((prev) => {
      if (direction === "in") return Math.min(prev * 1.2, 5);
      return Math.max(prev / 1.2, 0.5);
    });
  };

  // 下载图片
  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = currentImage.src;
    link.download = currentImage.alt || "image";
    link.click();
  };

  // 键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          goPrevious();
          break;
        case "ArrowRight":
          goNext();
          break;
        case "+":
        case "=":
          handleZoom("in");
          break;
        case "-":
          handleZoom("out");
          break;
      }
    },
    [onClose, goPrevious, goNext]
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* 头部控制栏 */}
      <div className="absolute top-0 left-0 right-0 h-14 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between px-4 z-10">
        <div className="text-white text-sm">
          {currentIndex + 1} / {images.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleZoom("out")}
            className="p-2 hover:bg-white/20 rounded-full transition-colors"
            title="缩小 (-)"
          >
            <span className="text-white text-lg">−</span>
          </button>
          <span className="text-white text-sm w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => handleZoom("in")}
            className="p-2 hover:bg-white/20 rounded-full transition-colors"
            title="放大 (+)"
          >
            <span className="text-white text-lg">+</span>
          </button>
          <button
            onClick={handleDownload}
            className="p-2 hover:bg-white/20 rounded-full transition-colors"
            title="下载"
          >
            <Download className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-full transition-colors ml-2"
            title="关闭 (Esc)"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* 图片区域 */}
      <div className="flex-1 flex items-center justify-center p-14">
        <div
          className="relative transition-transform duration-200"
          style={{ transform: `scale(${scale})` }}
        >
          <Image
            src={currentImage.src}
            alt={currentImage.alt || ""}
            width={1200}
            height={800}
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
            quality={100}
            unoptimized={currentImage.src.startsWith("data:") || currentImage.src.startsWith("blob:")}
          />
        </div>
      </div>

      {/* 左右切换按钮 */}
      {images.length > 1 && (
        <>
          <button
            onClick={goPrevious}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 hover:bg-white/20 rounded-full transition-colors"
            title="上一张 (←)"
          >
            <ChevronLeft className="w-8 h-8 text-white" />
          </button>
          <button
            onClick={goNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 hover:bg-white/20 rounded-full transition-colors"
            title="下一张 (→)"
          >
            <ChevronRight className="w-8 h-8 text-white" />
          </button>
        </>
      )}

      {/* 缩略图条 */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-black/60 rounded-lg max-w-[90vw] overflow-x-auto">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={() => {
                setCurrentIndex(idx);
                setScale(1);
              }}
              className={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-all ${
                idx === currentIndex ? "border-blue-500 opacity-100" : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              <Image
                src={img.src}
                alt={img.alt || ""}
                width={64}
                height={64}
                className="w-full h-full object-cover"
                unoptimized={img.src.startsWith("data:") || img.src.startsWith("blob:")}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
