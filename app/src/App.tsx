/**
 * ============================================
 * Blockchain Frontend - Main App
 * ============================================
 */

import { useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import {
  Blocks,
  ArrowRightLeft,
  Shield,
  Wallet as WalletIcon,
  Menu
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ThemeProvider } from 'next-themes';
import { I18nProvider, useTranslation } from '@/contexts/I18nContext';
import { WalletProvider } from '@/contexts/WalletContext';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Toaster } from 'sonner';
import Explorer from '@/pages/Explorer';
import Exchange from '@/pages/Exchange';
import Admin from '@/pages/Admin';
import Wallet from '@/pages/Wallet';
import { Component, type ReactNode } from 'react';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-red-50 text-red-900 font-mono text-xs">
          <div className="max-w-2xl w-full bg-white p-6 rounded-lg shadow-xl border-2 border-red-500 overflow-auto max-h-[90vh]">
            <h1 className="text-xl font-bold mb-4">CRITICAL RUNTIME ERROR</h1>
            <p className="mb-2 font-bold">{this.state.error?.name}: {this.state.error?.message}</p>
            <pre className="p-4 bg-red-100 rounded border border-red-200 whitespace-pre-wrap">
              {this.state.error?.stack}
            </pre>
            <Button className="mt-4 w-full" onClick={() => window.location.reload()}>Reload Application</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();

  const navItems = [
    { path: '/', label: t('nav.explorer'), icon: Blocks },
    { path: '/exchange', label: t('nav.exchange'), icon: ArrowRightLeft },
    { path: '/wallet', label: t('nav.wallet'), icon: WalletIcon },
    { path: '/admin', label: t('nav.admin'), icon: Shield },
  ];

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Blocks className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg hidden sm:inline">{t('common.appName')}</span>
          </Link>

          <div className="flex items-center gap-2">
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1 mr-4">
              {navItems.map((item) => (
                <Link key={item.path} to={item.path}>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Button>
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <LanguageToggle />
              <ThemeToggle />

              {/* Mobile Navigation */}
              <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild className="md:hidden">
                  <Button variant="ghost" size="icon">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <div className="flex flex-col gap-4 mt-8">
                    {navItems.map((item) => (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setIsOpen(false)}
                      >
                        <Button variant="ghost" className="w-full justify-start gap-2">
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </Button>
                      </Link>
                    ))}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Toaster position="top-right" richColors closeButton />
      <I18nProvider>
        <WalletProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <div className="min-h-screen bg-background transition-colors duration-300">
                <Navigation />
                <Routes>
                  <Route path="/" element={<Explorer />} />
                  <Route path="/exchange" element={<Exchange />} />
                  <Route path="/wallet" element={<Wallet />} />
                  <Route path="/admin" element={<Admin />} />
                </Routes>
              </div>
            </ErrorBoundary>
          </BrowserRouter>
        </WalletProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
