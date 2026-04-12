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
      "appium:avd": process.env.E2E_ANDROID_AVD ?? "Pixel_9_API_36",
      "appium:automationName": "UiAutomator2",
      "appium:app": path.resolve(__dirname, "../artifacts/VoiceMirror.apk"),
      "appium:noReset": false,
    },
  ],

  mochaOpts: {
    ...iosConfig.mochaOpts,
    timeout: 300_000,
  },
};
