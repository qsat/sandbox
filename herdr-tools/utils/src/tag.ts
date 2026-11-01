/** 一覧の行に添える短い印。tone は見た目の強さで、色や太字への割り当ては各クライアントが決める */
export interface Tag {
  text: string;
  tone: "strong" | "muted" | "danger";
}
