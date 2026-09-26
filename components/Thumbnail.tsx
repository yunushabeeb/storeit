import React from 'react';
import Image from 'next/image';
import { cn, getFileIcon } from '@/lib/utils';

export const Thumbnail = ({
  type,
  extension,
  url = '',
  imageClassName,
  className,
}: ThumbnailProps) => {
  // SVG is an image type but is not rendered from the file URL. The view URL
  // is a download, and an inline SVG can carry script. The icon is used instead.
  const isImage = type === 'image' && extension !== 'svg';

  return (
    <figure className={cn('thumbnail', className)}>
      <Image
        src={isImage ? url : getFileIcon(extension, type)}
        alt="thumbnail"
        width={100}
        height={100}
        className={cn(
          'size-8 object-contain',
          imageClassName,
          isImage && 'thumbnail-image',
        )}
      />
    </figure>
  );
};
export default Thumbnail;
