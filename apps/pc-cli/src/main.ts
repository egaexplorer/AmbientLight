#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { runCheck } from "./check.js";
import { CliError, parseCommandLine, USAGE } from "./cli.js";
import { runColor, runDiscover, runDisplays, runState, runSync } from "./commands.js";
import { type ConfigFile, findConfigFile, loadConfigFile, resolveConfig } from "./config.js";
import { chooseLook } from "./film.js";
import { errorMessage } from "./log.js";
import { runRain } from "./rain.js";

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

  // Resolved before anything touches the bulb, so a wrong title doesn't change the light.
  const look = await chooseLook(flags);

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
      return runSync(config, { once: true, verbose: flags.verbose, saveFrame: flags.saveFrame, look });
    case "rain":
      // .env sits next to the config file.
      return runRain(config, flags, configPath ? path.dirname(configPath) : (process.env.INIT_CWD ?? process.cwd()));
    case "sync":
      return runSync(config, { once: false, verbose: flags.verbose, look });
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
