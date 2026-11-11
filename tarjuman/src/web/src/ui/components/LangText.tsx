import type { ReactNode } from 'react';

import { LANGUAGES, type LangCode } from '../../../../shared/languages';
import { cx } from '../lib/cx';

/** Class that switches Arabic-script text to the Urdu typeface chosen in the settings. */
export function scriptClass(lang: LangCode): string | false {
  return LANGUAGES[lang].script === 'Arab' && 'script-arab';
}

interface LangTextProps {
  lang: LangCode;
  as?: 'span' | 'p' | 'div';
  className?: string;
  title?: string;
  children: ReactNode;
}

/**
 * Text in a known language. Sets `lang` and the language's text direction so the right
 * font, shaping and alignment apply wherever the text appears.
 */
export function LangText({ lang, as: Tag = 'span', className, title, children }: LangTextProps) {
  return (
    <Tag lang={lang} dir={LANGUAGES[lang].dir} className={cx(scriptClass(lang), className)} title={title}>
      {children}
    </Tag>
  );
}
