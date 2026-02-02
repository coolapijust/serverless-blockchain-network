import React, { createContext, useContext, useState, useCallback } from 'react';
import { zh } from '../locales/zh';
import { en } from '../locales/en';

type Language = 'zh' | 'en';
type TranslationDict = typeof zh;

interface I18nContextType {
    locale: Language;
    setLocale: (lang: Language) => void;
    t: (path: string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const translations: Record<Language, TranslationDict> = { zh, en };

export function I18nProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Language>(() => {
        const saved = localStorage.getItem('app-locale');
        return (saved as Language) || (navigator.language.startsWith('zh') ? 'zh' : 'en');
    });

    const setLocale = useCallback((lang: Language) => {
        setLocaleState(lang);
        localStorage.setItem('app-locale', lang);
    }, []);

    const t = useCallback((path: string): string => {
        const keys = path.split('.');
        let result: any = translations[locale];

        for (const key of keys) {
            if (result && result[key]) {
                result = result[key];
            } else {
                return path; // Fallback to path string
            }
        }

        return typeof result === 'string' ? result : path;
    }, [locale]);

    return (
        <I18nContext.Provider value={{ locale, setLocale, t }}>
            {children}
        </I18nContext.Provider>
    );
}

export function useTranslation() {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error('useTranslation must be used within I18nProvider');
    }
    return context;
}
