import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";

import en from "./locales/en/translation.json";
import ja from "./locales/ja/translation.json";

const SUPPORTED_LANGUAGES = ["en", "ja"] as const;

function getDeviceLanguage(): string {
  const locales = getLocales();
  const deviceLang = locales[0]?.languageCode ?? "en";
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(deviceLang)) {
    return deviceLang;
  }
  return "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
  },
  lng: getDeviceLanguage(),
  fallbackLng: "en",
  supportedLngs: ["en", "ja"],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
