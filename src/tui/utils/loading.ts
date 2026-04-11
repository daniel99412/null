const LOADING_BAR_WIDTH = 12;

export function renderLoadingBar(pos: number): string {
  const left = " ".repeat(Math.max(0, pos));
  const right = " ".repeat(Math.max(0, LOADING_BAR_WIDTH - pos - 1));
  return `[${left}█${right}]`;
}

export { LOADING_BAR_WIDTH };
