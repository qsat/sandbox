import { exec } from "herdr";
import { WS } from "./ws-list";

/** ws を呼ぶ。失敗（終了コードが 0 以外・起動できない）は error に 1 つの文として返し、mod は壊さない */
export async function execWs(args: string[]) {
  try {
    const r = await exec(WS, args);
    const error = r.code !== 0 ? r.stderr.trim() || `ws ${args[0]}: exit ${r.code}` : "";
    return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, error };
  } catch (e) {
    return { ok: false, stdout: "", stderr: "", error: String((e as Error)?.message ?? e) };
  }
}
