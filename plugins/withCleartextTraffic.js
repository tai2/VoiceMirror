const { withAndroidManifest } = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true"/>
</network-security-config>
`;

function withAndroidCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const xmlDir = path.join(
      config.modRequest.platformProjectRoot,
      "app/src/main/res/xml",
    );
    fs.mkdirSync(xmlDir, { recursive: true });
    fs.writeFileSync(
      path.join(xmlDir, "network_security_config.xml"),
      NETWORK_SECURITY_CONFIG,
    );

    const application = config.modResults.manifest.application[0];
    application.$["android:networkSecurityConfig"] =
      "@xml/network_security_config";
    return config;
  });
}

module.exports = function withCleartextTraffic(config) {
  if (process.env.EXPO_PUBLIC_E2E !== "1") {
    return config;
  }
  config = withAndroidCleartextTraffic(config);
  return config;
};
