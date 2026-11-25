export interface PreviewRequests {
  readonly open: boolean;
  start(): () => boolean;
  end(): void;
}

export function previewRequests(): PreviewRequests {
  let latest = 0;
  let open = false;
  return {
    get open() {
      return open;
    },
    start() {
      open = true;
      const request = ++latest;
      return () => request === latest;
    },
    end() {
      open = false;
      latest += 1;
    },
  };
}
