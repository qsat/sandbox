/** ステータスラインの印 */

/** ステータスラインに出す印（対応が要るものの有無だけ） */
export interface StatusFlags {
  waiting: boolean;
  asking: boolean;
  unseen: boolean;
  error: boolean;
}
