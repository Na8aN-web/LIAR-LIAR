import { colorInfo, type ColorId } from '@wtc/shared';

export function ColorChip({ color, dim, strong }: { color: ColorId; dim?: boolean; strong?: boolean }) {
  const info = colorInfo(color);
  return (
    <span className={`chip${dim ? ' dim' : ''}${strong ? ' strong' : ''}`}>
      <span className="swatch" style={{ background: info.hex }} />
      {info.name}
    </span>
  );
}
