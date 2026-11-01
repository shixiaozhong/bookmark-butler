// All interface text comes from _locales/. By default Chrome picks the language from
// its own settings, falling back to English (default_locale in the manifest). Chrome
// has no way to override that, so a language chosen in the extension is read directly
// from its message file.

export const LANGUAGE_KEY = 'language';
export const AUTO = 'auto';
/** Each language under its own name, so it can be found whatever is on screen now. */
export const LANGUAGES = { en: 'English', zh_CN: '中文' };

let chosenMessages = null;

export async function getLanguage() {
  const { [LANGUAGE_KEY]: language } = await chrome.storage.local.get(LANGUAGE_KEY);
  return Object.hasOwn(LANGUAGES, language ?? '') ? language : AUTO;
}

export async function setLanguage(language) {
  await chrome.storage.local.set({ [LANGUAGE_KEY]: language });
}

/**
 * Loads the chosen language. Call this before any text is shown. If the file can't
 * be read, Chrome's own choice still gives a working interface.
 */
export async function initI18n() {
  chosenMessages = null;
  const language = await getLanguage();
  if (language === AUTO) return;
  try {
    const response = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`));
    chosenMessages = await response.json();
  } catch (error) {
    console.error('Could not load language', language, error);
  }
}

/**
 * Does what chrome.i18n.getMessage does with a message. One pass over the message
 * only, so a bookmark title containing "$1" isn't expanded again.
 */
export function formatMessage(messages, key, substitutions) {
  const message = messages[key]?.message ?? '';
  return message.replace(/\$(\d|\$)/g, (_, token) => (token === '$' ? '$' : (substitutions[Number(token) - 1] ?? '')));
}

export function t(key, ...substitutions) {
  const values = substitutions.map(String);
  return chosenMessages ? formatMessage(chosenMessages, key, values) : chrome.i18n.getMessage(key, values);
}

/**
 * The language of the text being shown, which isn't always the browser's: someone
 * using Chrome in Russian reads the English fallback, so numbers and plurals have
 * to follow English rules.
 */
export function textLocale() {
  return t('locale_code');
}

/**
 * For messages that depend on a count. Looks up `key_one` or `key_other` by the
 * language's plural rules, passing the count as $1. Chinese has only `_other`.
 */
export function plural(key, count, ...substitutions) {
  const form = new Intl.PluralRules(textLocale()).select(count);
  return t(`${key}_${form}`, count, ...substitutions) || t(`${key}_other`, count, ...substitutions);
}

/** Fills in text marked in the HTML, like data-i18n="save" or data-i18n-title="save". */
export function localizeDocument(root = document) {
  document.documentElement.lang = textLocale();
  const attributes = { 'data-i18n-title': 'title', 'data-i18n-aria-label': 'aria-label', 'data-i18n-placeholder': 'placeholder' };
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const [marker, attribute] of Object.entries(attributes)) {
    for (const element of root.querySelectorAll(`[${marker}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(marker)));
    }
  }
}
