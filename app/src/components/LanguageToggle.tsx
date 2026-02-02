import { Button } from "@/components/ui/button";
import { useTranslation } from "@/contexts/I18nContext";
import { Languages } from "lucide-react";

export function LanguageToggle() {
    const { locale, setLocale } = useTranslation();

    return (
        <Button
            variant="ghost"
            size="sm"
            className="hidden sm:flex items-center gap-2 h-9 px-3"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
        >
            <Languages className="h-4 w-4" />
            <span className="text-xs font-semibold">{locale === 'zh' ? 'EN' : '中'}</span>
        </Button>
    );
}
