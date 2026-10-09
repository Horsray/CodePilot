'use client';

export function ImageThumbnail({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
  if (!src) return null;
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border/50 bg-muted/20 cursor-pointer hover:border-border transition-colors"
      onClick={onClick}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-32 w-full object-cover rounded-lg"
      />
    </div>
  );
}
