/**
 * ============================================
 * Block Explorer Page
 * ============================================
 */

import { useState, useEffect, memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  Box,
  ArrowRightLeft,
  Clock,
  Activity
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/contexts/I18nContext';
import { api } from '@/lib/api';
import { shortenAddress, formatAmount, timeAgo } from '@/lib/crypto';
import type { Block, Transaction, NetworkStatus } from '@/types';

const StatCard = memo(function StatCard({
  title,
  value,
  subtitle,
  icon: Icon
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

const BlockCard = memo(function BlockCard({ block }: { block: Block }) {
  const { t } = useTranslation();
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Box className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{t('explorer.height')} #{block?.header?.height}</p>
              <p className="text-sm text-muted-foreground">{timeAgo(block?.header?.timestamp)}</p>
            </div>
          </div>
          <div className="text-right">
            <Badge variant="secondary">{block?.header?.txCount} {t('explorer.transactions')}</Badge>
            <p className="text-sm text-muted-foreground mt-1">
              {shortenAddress(block?.hash)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

const TransactionCard = memo(function TransactionCard({ tx }: { tx: Transaction }) {
  const { t } = useTranslation();
  const statusColors = {
    pending: 'bg-yellow-500',
    processing: 'bg-blue-500',
    confirmed: 'bg-green-500',
    failed: 'bg-red-500',
  };

  const statusLabels: Record<string, string> = {
    pending: t('explorer.status.pending'),
    processing: t('explorer.status.processing'),
    confirmed: t('explorer.status.confirmed'),
    failed: t('explorer.status.failed'),
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{shortenAddress(tx.hash)}</span>
                <Badge variant="outline" className="text-[10px] h-4">
                  <div className={`h-1.5 w-1.5 rounded-full mr-1 ${statusColors[tx.status]}`} />
                  {statusLabels[tx.status]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('common.from')}: {shortenAddress(tx.from)}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-sm">{formatAmount(tx.amount)} CF</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(tx.timestamp)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

export default function Explorer() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);
  const [latestBlocks, setLatestBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    // Temporarily disabled auto-refresh to debug infinite loop issue
    // const interval = setInterval(loadData, 5000);
    // return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const status = await api.getNetworkStatus();
      setNetworkStatus(status);
      (window as any).DEBUG_NETWORK_STATUS = status;

      const blocks = await api.getBlocks(1, 10);
      setLatestBlocks(blocks);
      (window as any).DEBUG_LATEST_BLOCKS = blocks;
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const query = searchQuery.trim();

    if (query.startsWith('0x')) {
      if (query.length === 66) {
        navigate(`/tx/${query}`);
      } else if (query.length === 42) {
        navigate(`/address/${query}`);
      }
    } else if (/^\d+$/.test(query)) {
      navigate(`/block/${query}`);
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Activity className="h-8 w-8 text-primary" />
                {t('explorer.title')}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t('common.appName')} - {t('explorer.description')}
              </p>
            </div>
            <form onSubmit={handleSearch} className="flex gap-2 max-w-md w-full">
              <Input
                placeholder={t('common.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button type="submit">
                <Search className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title={t('explorer.networkStats.blocks')}
            value={networkStatus?.latestBlockHeight?.toString() || '0'}
            subtitle={t('explorer.height')}
            icon={Box}
          />
          <StatCard
            title={t('explorer.networkStats.txs')}
            value={networkStatus?.totalTransactions?.toLocaleString() || '0'}
            subtitle={t('explorer.networkStats.txs')}
            icon={ArrowRightLeft}
          />
          <StatCard
            title={t('wallet.nonce')}
            value={networkStatus?.pendingTransactions?.toString() || '0'}
            subtitle={t('explorer.status.pending')}
            icon={Clock}
          />
          <StatCard
            title={t('explorer.networkStats.peers')}
            value={networkStatus?.networkId || 'Unknown'}
            subtitle={`Chain ID: ${networkStatus?.chainId || '0'}`}
            icon={Activity}
          />
        </div>

        {/* Main Content */}
        <Tabs defaultValue="blocks" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
            <TabsTrigger value="blocks">{t('explorer.latestBlocks')}</TabsTrigger>
            <TabsTrigger value="transactions">{t('explorer.latestTxs')}</TabsTrigger>
          </TabsList>

          <TabsContent value="blocks" className="space-y-4">
            {latestBlocks.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Box className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t('common.noData')}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {latestBlocks.filter(b => b?.header?.height !== undefined).map((block) => (
                  <Link
                    key={block.hash}
                    to={`/block/${block.header.height}`}
                    onMouseEnter={() => import('@/pages/BlockDetail')}
                  >
                    <BlockCard block={block} />
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="transactions" className="space-y-4">
            {latestBlocks.filter(b => b?.transactions).flatMap(b => b.transactions).length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <ArrowRightLeft className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t('common.noData')}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {latestBlocks
                  .filter(b => b?.transactions)
                  .flatMap(b => b.transactions)
                  .slice(0, 20)
                  .map((tx) => (
                    <Link
                      key={tx.hash}
                      to={`/tx/${tx.hash}`}
                      onMouseEnter={() => import('@/pages/TransactionDetail')}
                    >
                      <TransactionCard tx={tx} />
                    </Link>
                  ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
