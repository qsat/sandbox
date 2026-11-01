// Herdr app の mod API の仮の型宣言（型チェックとバンドル用）。
// 正は ~/.config/herdr-app/ の herdr.d.ts / gpui-kit.d.ts（起動のたびに版に合わせて書き直される）。
// 手元ではこのファイルを消し、それらを herdr-app/src/ に置き換えて型チェックを通すこと。

declare module "herdr" {
  export function terminals(): Array<{ address?: string; status?: string | { state?: string; kind?: string } }>;
  export function exec(cmd: string, args: string[], opts?: { cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }>;
  export const shared: Record<string, unknown> | undefined;
  export function setShared(value: Record<string, unknown>): void;
}

declare module "gpui-kit" {
  /** メソッドチェーンで組み立てる要素（div().flex().gap(6)…） */
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
