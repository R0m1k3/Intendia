// Entry of the web app. The English dictionary is only downloaded for an English interface, and before any module
// of the app is evaluated: `t()` is called in module-level constants, so the language must be ready first.
import { getLang, setEnglish } from './i18n';

async function start(): Promise<void> {
  if (getLang() === 'en') setEnglish((await import('./i18n/en-all')).default);
  await import('./app');
}

void start();
