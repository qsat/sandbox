// 正は ~/.config/herdr-app/ の herdr.d.ts / gpui-kit.d.ts。手元ではこのファイルをそれらに置き換える

declare module "herdr" {
  export function terminals(): Array<{ address: string; status: { state: string; kind?: string | null } | null }>;
  export function exec(cmd: string, args: string[], opts?: { cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }>;
  export const shared: Record<string, unknown> | undefined;
  export function setShared(value: Record<string, unknown>): void;
}

declare module "gpui-kit" {
  export interface Element {
    [method: string]: any;
  }
  export interface Context {
    notify(): void;
    timer?(ms: number, fn: () => void): unknown;
  }
  export function div(): Element;
  export function text(s: string): Element;
  export function button(label: string): Element;
  export const scroll: ((el: Element) => Element) | undefined;
}
