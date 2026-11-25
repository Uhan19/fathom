export function states(flags: Record<string, boolean | null | undefined>): string | undefined {
  const on = Object.keys(flags).filter((name) => flags[name]);
  return on.length > 0 ? on.join(" ") : undefined;
}
