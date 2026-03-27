import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../i18n/locales/en/translation.json";

export function setupTestI18n() {
  if (i18n.isInitialized) return i18n;

  i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });

  return i18n;
}
