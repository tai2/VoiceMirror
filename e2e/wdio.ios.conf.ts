import path from "path";
import type { Options, Capabilities } from "@wdio/types";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

type WdioConfig = Options.Testrunner &
  Capabilities.WithRequestedTestrunnerCapabilities;

export const config: WdioConfig = {
  runner: "local",

  specs: ["./specs/**/*.spec.ts"],
  exclude: [],
  maxInstances: 1,

  capabilities: [
    {
      platformName: "iOS",
      "appium:deviceName": process.env.E2E_IOS_DEVICE_NAME ?? "iPhone 17 Pro",
      "appium:platformVersion": process.env.E2E_IOS_PLATFORM_VERSION ?? "26.3",
      "appium:automationName": "XCUITest",
      "appium:app": path.resolve(__dirname, "../artifacts/VoiceMirror.app"),
      "appium:noReset": false,
    },
  ],

  logLevel: "info",
  bail: 0,
  baseUrl: "http://localhost",
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  services: [["appium", {}]],
  framework: "mocha",

  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },

  reporters: ["spec"],
};
