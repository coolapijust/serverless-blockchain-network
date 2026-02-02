/**
 * ============================================
 * Blockchain Frontend - Main App
 * ============================================
 */

import { useState, lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  Blocks,
  ArrowRightLeft,
  Shield,
  Wallet as WalletIcon,
  Menu,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ThemeProvider } from 'next-themes';
import { I18nProvider, useTranslation } from '@/contexts/I18nContext';
import { WalletProvider } from '@/contexts/WalletContext';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Toaster } from 'sonner';

// Lazy load pages for performance
const Explorer = lazy(() => import('@/pages/Explorer'));
const Exchange = lazy(() => import('@/pages/Exchange'));
const Admin = lazy(() => import('@/pages/Admin'));
const Wallet = lazy(() => import('@/pages/Wallet'));
const BlockDetail = lazy(() => import('@/pages/BlockDetail'));
const TransactionDetail = lazy(() => import('@/pages/TransactionDetail'));
const AddressDetail = lazy(() => import('@/pages/AddressDetail'));

import { Component, type ReactNode } from 'react';

// NProgress
import nprogress from 'nprogress';
import 'nprogress/nprogress.css';

// Configure NProgress
nprogress.configure({
  showSpinner: false,
  minimum: 0.1,
  speed: 400
});

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

// Helper to preload components (Simple Cache)
const preloaded = new Set<string>();
const preloadMap: Record<string, () => Promise<any>> = {
  '/': () => import('@/pages/Explorer'),
  '/exchange': () => import('@/pages/Exchange'),
  '/wallet': () => import('@/pages/Wallet'),
  '/admin': () => import('@/pages/Admin'),
};

function RouteTransition() {
  const location = useLocation();

  useEffect(() => {
    // Finish progress bar on location change
    nprogress.done();
    return () => {
      // Start progress bar on unmount (start of next navigation)
      // Actually, we need to detect START of navigation.
      // In legacy router, we can't easily detect "click" before lazy load starts.
      // But we can ensure it finishes.
    };
  }, [location]);

  return null;
}

// Fallback that triggers NProgress
function PageLoader() {
  useEffect(() => {
    nprogress.start();
    return () => {
      nprogress.done();
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground animate-pulse">Loading experience...</p>
    </div>
  );
}

function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();
  const location = useLocation();

  const handleMouseEnter = (path: string) => {
    // Optimization: Only preload if not already loaded
    if (!preloaded.has(path) && preloadMap[path]) {
      // Debounce/Delay slightly to avoid spamming network on fast hover
      // But for now, just checking 'preloaded' Set avoids repeat calls
      console.log(`[Perf] Preloading ${path}...`);
      preloadMap[path]();
      preloaded.add(path);
    }
  };

  const handleClick = () => {
    // Immediate feedback on click
    nprogress.start();
    setIsOpen(false);
  };

  const navItems = [
    { path: '/', label: t('nav.explorer'), icon: Blocks },
    { path: '/exchange', label: t('nav.exchange'), icon: ArrowRightLeft },
    { path: '/wallet', label: t('nav.wallet'), icon: WalletIcon },
    { path: '/admin', label: t('nav.admin'), icon: Shield },
  ];

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <RouteTransition />
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2"
            onMouseEnter={() => handleMouseEnter('/')}
            onClick={handleClick}
          >
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Blocks className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg hidden sm:inline">{t('common.appName')}</span>
            <span className="hidden lg:inline text-[9px] bg-red-100 text-red-600 px-1 rounded ml-1 font-mono">v1.0.2-perf</span>
          </Link>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-1 mr-4">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onMouseEnter={() => handleMouseEnter(item.path)}
                  onClick={() => nprogress.start()} // Explicit start
                >
                  <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Button>
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <LanguageToggle />
              <ThemeToggle />

              <Sheet open={isOpen} onOpenChange={setIsOpening => setIsOpen(setIsOpening)}>
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
                        onClick={handleClick}
                      >
                        <Button variant="ghost" className="w-full justify-start gap-2">
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </Button>
                      </Link>
                    ))}
                  </div>
                  <div className="mt-auto p-4 border-t text-[10px] font-mono text-muted-foreground">
                    Debug: {location.pathname} | v1.0.2-perf
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

function NotFoundDebugger() {
  const location = useLocation();
  console.error(`[Router] No match for path: "${location.pathname}"`);
  return (
    <div className="container mx-auto px-4 py-8 text-center">
      <h1 className="text-2xl font-bold mb-2">Page Not Found</h1>
      <p className="text-muted-foreground mb-4">The route "{location.pathname}" does not exist.</p>
      <Link to="/">
        <Button>Go Back Home</Button>
      </Link>
    </div>
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
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/" element={<Explorer />} />
                    <Route path="/exchange" element={<Exchange />} />
                    <Route path="/wallet" element={<Wallet />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/block/:height" element={<BlockDetail />} />
                    <Route path="/tx/:hash" element={<TransactionDetail />} />
                    <Route path="/address/:address" element={<AddressDetail />} />
                    <Route path="*" element={<NotFoundDebugger />} />
                  </Routes>
                </Suspense>
              </div>
            </ErrorBoundary>
          </BrowserRouter>
        </WalletProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
