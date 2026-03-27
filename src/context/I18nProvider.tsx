import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { useLocales } from "expo-localization";
import i18n from "../i18n";

const SUPPORTED_LANGUAGES = ["en", "ja"];

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locales = useLocales();

  useEffect(() => {
    const deviceLang = locales[0]?.languageCode ?? "en";
    const lang = SUPPORTED_LANGUAGES.includes(deviceLang) ? deviceLang : "en";
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
  }, [locales]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
