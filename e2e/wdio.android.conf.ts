import path from "path";
import type { Options, Capabilities } from "@wdio/types";
import { config as iosConfig } from "./wdio.ios.conf";

type WdioConfig = Options.Testrunner &
  Capabilities.WithRequestedTestrunnerCapabilities;

export const config: WdioConfig = {
  ...iosConfig,

  capabilities: [
    {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:app": path.resolve(__dirname, "../artifacts/VoiceRepeat.apk"),
      "appium:autoGrantPermissions": true,
      "appium:uiautomator2ServerInstallTimeout": 60_000,
      "appium:uiautomator2ServerLaunchTimeout": 60_000,
      "appium:noReset": false,
      ...(process.env.E2E_ANDROID_UDID
        ? {
            "appium:udid": process.env.E2E_ANDROID_UDID,
          }
        : {
            "appium:avd": process.env.E2E_ANDROID_AVD,
          }),
    },
  ],

  mochaOpts: {
    ...iosConfig.mochaOpts,
    timeout: 300_000,
  },
};
