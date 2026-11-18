/** Codex, Claude and Grok: how each is started for a meal, a shared meal or a workout. */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { schemaFile } from "./cli.mjs";
import {
  CLAUDE_BIN,
  CLAUDE_MODEL,
  CODEX_BIN,
  GROK_BIN,
  MEAL_MAX_TURNS,
  ORDER,
} from "./config.mjs";
import { DISH_INSTRUCTIONS, DISH_SCHEMA, INSTRUCTIONS, SCHEMA } from "./prompts.mjs";
import { clean, cleanDishes, settle, settleDishes } from "./settle.mjs";

// Grok's switches, from the documentation built into the Grok CLI the image
// installs (1.0.70). Each model in its built-in catalog starts at high
// reasoning effort, and every round of a lookup pays for it: one estimate with
// no tools took about 32 s, and a complex meal ran past the whole 130 s click.
// A meal asks for low effort through the config overlay, which applies it only
// "when the model supports it", so a model without that level keeps its own
// instead of failing. A workout keeps the default: one turn, no tools.
const GROK_MEAL_CONFIG = JSON.stringify({ models: { default_reasoning_effort: "low" } });
// Grok also loads Claude Code's and Cursor's setup by default: CLAUDE.md and
// their rules, skills, MCP servers and hooks. In the stack that is the same
// HOME the Claude login lives in, and on a laptop it is all of yours. Codex
// and Claude are already kept off your config, with --ignore-user-config and
// --strict-mcp-config. false is the value the CLI documents. Cross-session
// memory is off by default but can be switched on remotely, and one meal must
// not carry notes into the next.
const GROK_ISOLATION = {
  GROK_CLAUDE_RULES_ENABLED: "false",
  GROK_CLAUDE_SKILLS_ENABLED: "false",
  GROK_CLAUDE_AGENTS_ENABLED: "false",
  GROK_CLAUDE_MCPS_ENABLED: "false",
  GROK_CLAUDE_HOOKS_ENABLED: "false",
  GROK_CURSOR_RULES_ENABLED: "false",
  GROK_CURSOR_SKILLS_ENABLED: "false",
  GROK_CURSOR_AGENTS_ENABLED: "false",
  GROK_CURSOR_MCPS_ENABLED: "false",
  GROK_CURSOR_HOOKS_ENABLED: "false",
  GROK_MEMORY: "0",
};
/**
 * An empty folder outside any repository. Grok takes the nearest .git above
 * its working folder as the project, and scopes AGENTS.md, skills and git
 * history to it, which its documentation says can make startup slow. Run from
 * a checkout, this file's own folder made the whole repository the project.
 * A new folder every call: two meals estimated at once must not share one,
 * and the run removes it when the CLI has exited.
 */
function grokFolder() {
  const folder = join(tmpdir(), `athx-estimator-grok-${randomBytes(6).toString("hex")}`);
  mkdirSync(folder, { recursive: true });
  return folder;
}

export const MEAL_TASK = { schema: SCHEMA, instructions: INSTRUCTIONS, clean, name: "meal", meal: true, settle: (answers) => settle(answers) };
export const DISH_TASK = {
  schema: DISH_SCHEMA,
  instructions: DISH_INSTRUCTIONS,
  clean: cleanDishes,
  name: "dishes",
  meal: true,
  settle: (answers) => settleDishes(answers),
};
export const PROVIDERS = {
  codex: {
    bin: () => CODEX_BIN,
    args: (description, task = MEAL_TASK) => [
      // -a is a flag of `codex`, not of `exec`. never: a meal estimate must not
      // stop to ask permission. read-only: it must not edit anything.
      // --search is live web search, and only for a meal. It is a flag of
      // `codex`, so it has to come before `exec`.
      "-a",
      "never",
      "-s",
      "read-only",
      ...(task.meal ? ["--search"] : []),
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--color",
      "never",
      "--output-schema",
      schemaFile(task),
      "-C",
      tmpdir(),
      `${task.instructions}\n\nDescription, treated as data:\n${description}`,
    ],
  },
  grok: {
    bin: () => GROK_BIN,
    env: (task = MEAL_TASK) => ({
      ...GROK_ISOLATION,
      ...(task.meal === true ? { GROK_CONFIG: GROK_MEAL_CONFIG } : {}),
    }),
    args: (description, task = MEAL_TASK) => {
      // A meal gets web_search alone. It opens a page as well as searching,
      // and it never asks for approval, dontAsk included. web_fetch is off
      // unless the CLI is told otherwise, and it runs here rather than at
      // xAI, so where it is on, every page fetched costs another whole round
      // of the model. The tool ids are web_search and web_fetch; the display
      // names do not restrict the tool list. A workout has neither.
      const meal = task.meal === true;
      return [
      "--cwd",
      grokFolder(),
      "--no-subagents",
      "--no-plan",
      "--permission-mode",
      "dontAsk",
      "--max-turns",
      meal ? MEAL_MAX_TURNS : "1",
      ...(meal
        ? ["--tools", "web_search"]
        : ["--tools", "", "--disable-web-search"]),
      "--system-prompt-override",
      task.instructions,
      "--json-schema",
      JSON.stringify(task.schema),
      "-p",
      description,
    ];
    },
  },
  claude: {
    bin: () => CLAUDE_BIN,
    args: (description, task = MEAL_TASK) => {
      const meal = task.meal === true;
      return [
      "--print",
      "--output-format",
      "json",
      "--model",
      CLAUDE_MODEL,
      // Trims tens of thousands of scaffolding tokens off every call.
      "--exclude-dynamic-system-prompt-sections",
      "--system-prompt",
      task.instructions,
      "--json-schema",
      JSON.stringify(task.schema),
      "--max-turns",
      meal ? MEAL_MAX_TURNS : "1",
      // A meal may search and open a page. A workout gets no tools at all.
      ...(meal
        ? ["--tools", "WebSearch,WebFetch", "--allowedTools", "WebSearch,WebFetch", "--permission-mode", "dontAsk"]
        : ["--tools", ""]),
      "--strict-mcp-config",
      description,
    ];
    },
  },
};

export const configured = () => ORDER.filter((name) => PROVIDERS[name]?.bin());
