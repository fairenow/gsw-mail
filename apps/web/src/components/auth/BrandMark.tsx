export function BrandMark({ size, className }: { size: number; className?: string }) {
  return (
    <img
      src="/favicon.png"
      alt="Guided Steps Mail"
      className={className}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
