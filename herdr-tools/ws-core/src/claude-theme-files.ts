import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promptColorTheme } from "./claude-code";
import type { PromptColorThemes } from "./ports";

const THEME_NAME_PREFIX = "ws-";
const THEME_KEY_LENGTH = 8;

/** Claude Code のカスタムのテーマのファイル（~/.claude/themes/<テーマの名前>.json） */
export class ClaudeThemeFiles implements PromptColorThemes {
  private readonly dir: string;

  constructor(home: string) {
    this.dir = join(home, ".claude", "themes");
  }

  async create(color: string) {
    const theme = `${THEME_NAME_PREFIX}${randomUUID().slice(0, THEME_KEY_LENGTH)}`;
    await this.recolor(theme, color);
    return theme;
  }

  async recolor(theme: string, color: string) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${theme}.json`), JSON.stringify(promptColorTheme(theme, color)) + "\n");
  }
}
