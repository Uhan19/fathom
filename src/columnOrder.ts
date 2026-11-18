export interface HeadBox {
  id: number;
  left: number;
  right: number;
}

export function pickGap(heads: HeadBox[], x: number): number {
  return heads.filter((head) => (head.left + head.right) / 2 < x).length;
}

export function landingIndex(ids: number[], id: number, gap: number): number | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const index = gap > from ? gap - 1 : gap;
  return index === from ? null : index;
}

export function gapX(heads: HeadBox[], gap: number): number | null {
  if (heads.length === 0) return null;
  if (gap <= 0) return heads[0].left;
  if (gap >= heads.length) return heads[heads.length - 1].right;
  return (heads[gap - 1].right + heads[gap].left) / 2;
}

export function moveTo<T extends { id: number }>(items: T[], id: number, index: number): T[] {
  const moving = items.find((item) => item.id === id);
  if (!moving) return items;
  const rest = items.filter((item) => item.id !== id);
  return [...rest.slice(0, index), moving, ...rest.slice(index)];
}
