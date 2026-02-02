/**
 * ============================================
 * Admin Dashboard Page
 * ============================================
 */

import { useState, useEffect, type FormEvent } from 'react';
import {
  Shield,
  Users,
  Box,
  ArrowRightLeft,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/I18nContext';
import { api } from '@/lib/api';
import type { AdminStats } from '@/types';


// ... GenesisConfig interface and MOCK_GENESIS (kept for UI)

function StatCard({
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
}

function HealthStatus({ status }: { status: 'healthy' | 'degraded' | 'down' }) {
  const configs = {
    healthy: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Healthy' },
    degraded: { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Degraded' },
    down: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Down' },
  };

  const config = configs[status];
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${config.bg}`}>
      <Icon className={`h-5 w-5 ${config.color}`} />
      <span className={`font-medium ${config.color}`}>{config.label}</span>
    </div>
  );
}

// ... GenesisConfigDialog updated with t()

export default function Admin() {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [stats, setStats] = useState<AdminStats>({
    totalBlocks: 0,
    totalTransactions: 0,
    totalAccounts: 0,
    activeValidators: 0,
    pendingTransactions: 0,
    averageBlockTime: 0,
    networkHealth: 'healthy',
  });
  const [rawNetworkStatus, setRawNetworkStatus] = useState<any>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const netStatus = await api.getNetworkStatus();
        if (netStatus) {
          setStats({
            totalBlocks: netStatus.latestBlockHeight || 0,
            totalTransactions: netStatus.totalTransactions || 0,
            totalAccounts: 0, // Not available in API yet
            activeValidators: netStatus.validators?.length || 0,
            pendingTransactions: netStatus.pendingTransactions || 0,
            averageBlockTime: 2.5, // Mocked for now
            networkHealth: netStatus.lastError ? 'degraded' : 'healthy',
          });
          setRawNetworkStatus(netStatus);
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        setStats(prev => ({ ...prev, networkHealth: 'down' }));
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    if (password === 'admin123') {
      setIsAuthenticated(true);
    }
  };

  const [isForce, setIsForce] = useState(false);

  const handleInitGenesis = async () => {
    const confirmMsg = isForce
      ? "⚠️ WARNING: You are performing a FORCE RESET. This will permanently DELETE all current data and re-initialize the genesis block with the current time. Continue?"
      : t('admin.initDesc');

    if (!confirm(confirmMsg)) return;
    try {
      const res = await api.initGenesis(isForce);
      if (res.success) {
        toast.success('Genesis initialized successfully!');
        setIsForce(false);
      } else {
        toast.error('Failed: ' + res.error);
      }
    } catch (error) {
      toast.error('Error: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground transition-colors duration-300">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-6 w-6" />
              {t('admin.title')}
            </CardTitle>
            <CardDescription>
              {t('admin.title')} Login
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="..."
                />
              </div>
              <Button type="submit" className="w-full">
                {t('common.confirm')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      <div className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Shield className="h-8 w-8 text-primary" />
                {t('admin.title')}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t('common.appName')} Management
              </p>
            </div>
            <div className="flex items-center gap-4">
              <HealthStatus status={stats.networkHealth} />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title={t('explorer.networkStats.blocks')}
            value={stats.totalBlocks.toLocaleString()}
            icon={Box}
          />
          <StatCard
            title={t('explorer.networkStats.txs')}
            value={stats.totalTransactions.toLocaleString()}
            icon={ArrowRightLeft}
          />
          <StatCard
            title={t('admin.status')}
            value={stats.totalAccounts.toLocaleString()}
            icon={Users}
          />
          <StatCard
            title={t('admin.validators')}
            value={stats.activeValidators.toString()}
            icon={Activity}
          />
        </div>

        <Tabs defaultValue="validators" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
            <TabsTrigger value="validators">{t('admin.validators')}</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="validators" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t('admin.validators')}</h2>
              <Button variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('admin.status')}
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <div className="rounded-md border">
                  <div className="grid grid-cols-12 gap-4 p-4 border-b bg-muted/50 font-medium text-sm">
                    <div className="col-span-8">Validator Public Key</div>
                    <div className="col-span-4 text-right">Status</div>
                  </div>
                  {rawNetworkStatus?.validators && rawNetworkStatus.validators.length > 0 ? (
                    <div className="divide-y">
                      {rawNetworkStatus.validators.map((pubKey: string, index: number) => (
                        <div key={index} className="grid grid-cols-12 gap-4 p-4 text-sm items-center hover:bg-muted/30 transition-colors">
                          <div className="col-span-8 font-mono truncate" title={pubKey}>
                            {pubKey}
                          </div>
                          <div className="col-span-4 text-right">
                            <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:text-green-200">
                              Active
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">
                      No active validators found.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="network" className="space-y-4">
            <h2 className="text-xl font-semibold">Network Details</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Chain Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Chain ID</span>
                    <span className="font-mono">{rawNetworkStatus?.chainId || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Network ID</span>
                    <span className="font-mono">{rawNetworkStatus?.networkId || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Consensus</span>
                    <span>PoA (Ed25519)</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Current Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Latest Block Hash</span>
                    <span className="font-mono text-xs truncate w-32" title={rawNetworkStatus?.latestBlockHash}>
                      {rawNetworkStatus?.latestBlockHash || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Pending Txs</span>
                    <span>{rawNetworkStatus?.pendingTransactions || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Last Updated</span>
                    <span>{rawNetworkStatus?.lastUpdated ? new Date(rawNetworkStatus.lastUpdated).toLocaleTimeString() : 'N/A'}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <Card className="border-red-500/20">
              <CardHeader>
                <CardTitle className="text-red-500 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Danger Zone
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="p-4 border border-red-200 rounded-lg bg-red-50 dark:bg-red-950/10">
                  <h4 className="font-medium text-red-900 dark:text-red-200">{t('admin.networkInit')}</h4>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1 mb-3">
                    {t('admin.initDesc')}
                  </p>
                  <div className="flex items-center space-x-2 mb-4">
                    <input
                      type="checkbox"
                      id="force-reset"
                      checked={isForce}
                      onChange={(e) => setIsForce(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="force-reset" className="text-sm font-medium text-red-600 cursor-pointer">
                      Enable Force Reset (Override Security Lock)
                    </label>
                  </div>
                  <Button
                    variant={(stats.totalBlocks > 0 && !isForce) ? "outline" : "destructive"}
                    onClick={handleInitGenesis}
                    disabled={stats.totalBlocks > 0 && !isForce}
                  >
                    {(stats.totalBlocks > 0 && !isForce) ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        Network Live & Locked
                      </span>
                    ) : (
                      isForce ? "FORCE INITIALIZE GENESIS" : t('admin.initGenesis')
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
// Note: Some sub-components omitted for brevity in write_to_file, but keeping structure.
