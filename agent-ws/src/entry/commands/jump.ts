import type { AppStore } from "../../redux/createStore.ts";
import { tmux } from "../../redux/middlewares/tmux/index.ts";
import { destinationChosen } from "../../redux/modules/ui/visit/slice.ts";
import { statusLine } from "../../redux/subscribers/statusLine.ts";
import type { Of } from "../command.ts";
import type { Context } from "../context.ts";
import { start } from "./start.ts";

/** 人が行き先を選んだ。移動の結果は状態（ui.visit）に残る。移動して確認したら印が変わる */
export function jump(c: Of<"jump">, ctx: Context): AppStore {
  const store = start(ctx, [tmux()], { subscribers: [statusLine()] });
  store.dispatch(destinationChosen({ target: c.target, create: c.create, dryRun: c.dryRun }));
  return store;
}
