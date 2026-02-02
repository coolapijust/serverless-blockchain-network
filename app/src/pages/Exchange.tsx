/**
 * ============================================
 * Exchange Page
 * ============================================
 */

import { useState } from 'react';
import { CandlestickChart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWallet } from '@/contexts/WalletContext';
import { useTranslation } from '@/contexts/I18nContext';
import type { MarketData } from '@/types';
import { api } from '@/lib/api';
import { signTransaction } from '@/lib/crypto';
import { toast } from 'sonner';
import { TransactionTracker } from '@/components/TransactionTracker';

// 模拟市场数据
const MOCK_MARKET_DATA: MarketData = {
  price: '1.25',
  change24h: '+5.23',
  volume24h: '1250000',
  high24h: '1.35',
  low24h: '1.18',
  lastUpdate: Date.now(),
};

// 模拟挂单数据
// const MOCK_ORDERS = {
//   buy: [
//     { price: '1.24', amount: '120', total: '148.80' },
//     { price: '1.23', amount: '450', total: '553.50' },
//     { price: '1.22', amount: '800', total: '976.00' },
//   ],
//   sell: [
//     { price: '1.26', amount: '230', total: '289.80' },
//     { price: '1.27', amount: '150', total: '190.50' },
//     { price: '1.28', amount: '600', total: '768.00' },
//   ],
// };

// 模拟成交记录
// const MOCK_TRADES = [
//   { price: '1.25', amount: '100', time: '12:05:23', type: 'buy' },
//   { price: '1.24', amount: '50', time: '12:04:12', type: 'sell' },
//   { price: '1.26', amount: '200', time: '12:03:45', type: 'buy' },
// ];

function PriceChart() {
  const points = [30, 45, 35, 50, 40, 55, 45, 60, 50, 65, 55, 70];
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min;

  const pathPoints = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = 100 - ((p - min) / range) * 80 - 10;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="h-64 w-full bg-card rounded-lg p-4 group">
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,100 ${pathPoints} 100,100`}
          className="fill-primary/20 transition-all group-hover:fill-primary/30"
        />
        <polyline
          points={pathPoints}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="0.5"
        />
      </svg>
    </div>
  );
}


function TradingForm({ type }: { type: 'buy' | 'sell' }) {
  const { wallet, isConnected, refreshBalance } = useWallet();
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState(MOCK_MARKET_DATA.price);
  const [loading, setLoading] = useState(false);

  // Tracker State
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);

  const total = amount && price ? (parseFloat(amount) * parseFloat(price)).toFixed(2) : '0';

  const handleTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet) return;

    setLoading(true);
    try {
      if (type === 'buy') {
        if (!amount || isNaN(Number(amount))) throw new Error(t('common.invalidAmount') || 'Invalid amount');

        // Basic Integer conversion for MVP (1 CF = 1e18 Wei)
        const weiAmount = (BigInt(Math.floor(Number(amount))) * 1000000000000000000n).toString();

        const res = await api.requestFaucet(wallet.address, weiAmount);

        // Show Tracker
        if (res.txHash) {
          setTxHash(res.txHash);
          setIsTrackerOpen(true);
        } else {
          toast.success(`${t('exchange.buy')} Success! Received CF`);
        }
      } else {
        if (!amount || isNaN(Number(amount))) throw new Error(t('common.invalidAmount') || 'Invalid amount');

        // Fetch nonce
        let nonce = 1;
        try {
          const account = await api.getAccount(wallet.address);
          nonce = account.nonce + 1;
        } catch {
          // Account might not exist yet
          nonce = 1;
        }

        const value = (BigInt(Math.floor(Number(amount))) * 1000000000000000000n).toString();
        const tx = {
          from: wallet.address,
          to: '0x0000000000000000000000000000000000000000', // Burn/Exchange Address
          amount: value,
          nonce,
          timestamp: Date.now(),
        };

        const signature = await signTransaction(tx, wallet.privateKey);
        const res = await api.submitTransaction({
          ...tx,
          signature,
          publicKey: wallet.publicKey
        });

        // Show Tracker
        if (res.txHash) {
          setTxHash(res.txHash);
          setIsTrackerOpen(true);
        } else {
          toast.success(`${t('exchange.sell')} Order Submitted!`);
        }
      }

      setAmount('');
    } catch (error) {
      console.error('Trade failed:', error);
      toast.error('Trade failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground mb-4">{t('exchange.connectWallet')}</p>
        <Button variant="outline" disabled>
          {type === 'buy' ? t('exchange.buy') : t('exchange.sell')} CF
        </Button>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleTrade} className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('exchange.price')} (USD)</label>
          <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium">{t('exchange.amount')} (CF)</label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div className="text-sm text-muted-foreground">
          {t('exchange.price')}: {total} USD
        </div>
        <Button type="submit" className="w-full" variant={type === 'buy' ? 'default' : 'destructive'} disabled={loading}>
          {loading ? 'Processing...' : (type === 'buy' ? t('exchange.buy') : t('exchange.sell')) + ' CF'}
        </Button>
        {wallet && (
          <p className="text-xs text-muted-foreground text-center">
            {t('exchange.demoMode')} - {type === 'buy' ? 'Requests Faucet Drip' : 'Sends to Burn Address'}
          </p>
        )}
      </form>

      <TransactionTracker
        txHash={txHash}
        open={isTrackerOpen}
        onOpenChange={setIsTrackerOpen}
        onComplete={() => {
          refreshBalance();
        }}
      />
    </>
  );
}

export default function Exchange() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('buy');

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      <div className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <CandlestickChart className="h-8 w-8 text-primary" />
                {t('exchange.title')}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-muted-foreground">
                  {t('exchange.zeroGas')}
                </p>
                <span className="inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:text-yellow-200">
                  {t('exchange.demoMode')}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">{MOCK_MARKET_DATA.price} USD</p>
              <p className="text-green-500">{MOCK_MARKET_DATA.change24h}% (24h)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle>{t('exchange.market')}</CardTitle></CardHeader>
              <CardContent><PriceChart /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('exchange.tradeHistory')}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-center py-8 text-muted-foreground">{t('common.noData')}</p>
              </CardContent>
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>{t('exchange.buy')} / {t('exchange.sell')}</CardTitle></CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="buy">{t('exchange.buy')}</TabsTrigger>
                    <TabsTrigger value="sell">{t('exchange.sell')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="buy" className="mt-4"><TradingForm type="buy" /></TabsContent>
                  <TabsContent value="sell" className="mt-4"><TradingForm type="sell" /></TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
