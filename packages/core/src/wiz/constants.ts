/** UDP port every WiZ bulb listens on for local (LAN) control. */
export const WIZ_PORT = 38899;

/** WiZ firmware accepts `dimming` from 10 to 100 (%). */
export const WIZ_MIN_DIMMING = 10;
export const WIZ_MAX_DIMMING = 100;

/** Typical white color-temperature range in Kelvin (varies slightly by model). */
export const WIZ_MIN_TEMP = 2200;
export const WIZ_MAX_TEMP = 6500;

/** Limited broadcast address used for discovery when no subnet broadcast is known. */
export const WIZ_BROADCAST = "255.255.255.255";
