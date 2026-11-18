const SHELL_SPECIAL = /[\s\\'"`!#$&*;|<>?()[\]{}~^]/g;

export function escapedPath(path: string): string {
  return path.replace(SHELL_SPECIAL, (c) => `\\${c}`);
}

export function droppedPathsText(paths: string[]): string {
  return paths.length === 0 ? "" : paths.map(escapedPath).join(" ") + " ";
}
