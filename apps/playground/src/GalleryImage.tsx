export interface GalleryImageProps {
  label: string;
  color: string;
}

/** Self-contained placeholder image, so the playground needs no assets. */
export function GalleryImage({ label, color }: GalleryImageProps) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#fff">${label}</text></svg>`;

  return (
    <figure className="gallery-image">
      <img
        src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
        alt={label}
        width={240}
        height={160}
      />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
