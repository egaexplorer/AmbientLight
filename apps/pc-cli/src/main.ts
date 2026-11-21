#!/usr/bin/env node
import process from "node:process";
import { runCheck } from "./check.js";
import { CliError, parseCommandLine, USAGE } from "./cli.js";
import { runColor, runDiscover, runDisplays, runState, runSync } from "./commands.js";
import { type ConfigFile, findConfigFile, loadConfigFile, resolveConfig } from "./config.js";
import { errorMessage } from "./log.js";

async function main(argv: readonly string[]): Promise<number> {
  const { command, flags } = parseCommandLine(argv);
  if (flags.help || command === "help") {
    console.log(USAGE);
    return 0;
  }

  // npm runs workspace scripts inside apps/pc-cli; INIT_CWD is where the user typed the command.
  const configPath = flags.config ?? findConfigFile(process.env.INIT_CWD ?? process.cwd());
  const file: ConfigFile | undefined = configPath ? loadConfigFile(configPath) : undefined;
  if (configPath && flags.verbose) console.log(`Using config ${configPath}`);
  const config = resolveConfig(file, flags);

  switch (command) {
    case "discover":
      return runDiscover(flags);
    case "check":
      return runCheck(config, flags);
    case "state":
      return runState(config);
    case "displays":
      return runDisplays();
    case "color":
      return runColor(config, flags);
    case "once":
      return runSync(config, { once: true, verbose: flags.verbose });
    case "sync":
      return runSync(config, { once: false, verbose: flags.verbose });
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof CliError) console.error(`Error: ${error.message}`);
    else console.error(error instanceof Error ? (error.stack ?? error.message) : errorMessage(error));
    process.exitCode = 1;
  },
);
