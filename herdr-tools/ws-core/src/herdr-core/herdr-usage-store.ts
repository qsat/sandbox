import type { ClaudeUsage } from "../domain/usage";
import type { UsageStore } from "../ports";
import type { HcClient } from "./hc-client";

const DOC_NAME = "claude-usage";

export class HerdrUsageStore implements UsageStore {
  constructor(private readonly hc: HcClient) {}

  async read() {
    return ((await this.hc.docGet(DOC_NAME)).value as ClaudeUsage | null) ?? undefined;
  }

  async write(usage: ClaudeUsage) {
    for (let attempt = 0; ; attempt++) {
      const { version } = await this.hc.docGet(DOC_NAME);
      try {
        return await this.hc.docSet(DOC_NAME, usage, version);
      } catch (e) {
        if ((e as { kind?: string }).kind !== "conflict" || attempt > 0) throw e;
      }
    }
  }
}
