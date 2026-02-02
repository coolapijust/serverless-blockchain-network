/**
 * ============================================
 * Wallet Page
 * ============================================
 */

import { useState, type FormEvent } from 'react';
import {
  Wallet as WalletIcon,
  Copy,
  Send,
  History,
  QrCode,
  Key,
  AlertTriangle,
  Download,
  Check
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useWallet } from '@/contexts/WalletContext';
import { useTranslation } from '@/contexts/I18nContext';
import { api } from '@/lib/api';
import { shortenAddress, formatAmount, signTransaction } from '@/lib/crypto';
import { toast } from 'sonner';


function SendDialog() {
  const { wallet } = useWallet();
  const { t } = useTranslation();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!wallet) return;

    setLoading(true);
    try {
      const amountInWei = BigInt(parseFloat(amount) * 1e18).toString();
      const nonce = wallet.nonce;
      const timestamp = Date.now();

      const signature = await signTransaction({
        from: wallet.address,
        to,
        amount: amountInWei,
        nonce,
        timestamp,
      }, wallet.privateKey);

      const response = await api.submitTransaction({
        from: wallet.address,
        to,
        amount: amountInWei,
        nonce,
        signature,
        publicKey: wallet.publicKey,
      });

      toast.success(`${t('wallet.sendDialog.success')}! Hash: ${response.txHash}`);
    } catch (error) {
      toast.error(`${t('wallet.sendDialog.error')}: ` + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="flex-1">
          <Send className="h-4 w-4 mr-2" />
          {t('wallet.send')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wallet.sendDialog.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <Label>{t('wallet.sendDialog.to')}</Label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="0x..."
            />
          </div>
          <div>
            <Label>{t('wallet.sendDialog.amount')}</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
              <span className="flex items-center text-sm text-muted-foreground">CF</span>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('wallet.sendDialog.sending') : t('wallet.send')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ address }: { address: string }) {
  const { t } = useTranslation();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex-1">
          <QrCode className="h-4 w-4 mr-2" />
          {t('wallet.receive')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wallet.receive')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center space-y-4">
          <div className="h-48 w-48 bg-muted rounded-lg flex items-center justify-center">
            <QrCode className="h-32 w-32" />
          </div>
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg w-full">
            <code className="flex-1 text-sm break-all">{address}</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(address);
                toast.success(t('common.copied'));
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            {t('wallet.address')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}


function GenerateSuccessDialog({
  wallet,
  open,
  onOpenChange
}: {
  wallet: { address: string; privateKey: string; publicKey: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!wallet) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(wallet.privateKey);
    setCopied(true);
    toast.success(t('common.copied'));
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([JSON.stringify(wallet, null, 2)], { type: 'application/json' });
    element.href = URL.createObjectURL(file);
    element.download = `cf-wallet-${wallet.address.slice(0, 8)}.json`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Wallet backup downloaded");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-500">
            <Key className="h-5 w-5" />
            {t('wallet.generateSuccess')}
          </DialogTitle>
          <DialogDescription>
            IMPORTANT: Save your private key now. You cannot recover it later!
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Wallet Address</Label>
            <div className="p-3 bg-muted rounded-md font-mono text-xs break-all">
              {wallet.address}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-red-500 font-bold">Private Key (SECRET)</Label>
            <div className="relative">
              <div className="p-3 bg-muted rounded-md font-mono text-xs break-all pr-10">
                {wallet.privateKey}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 h-7 w-7"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleCopy} variant="outline" className="flex-1">
              <Copy className="h-4 w-4 mr-2" />
              Copy Key
            </Button>
            <Button onClick={handleDownload} variant="outline" className="flex-1">
              <Download className="h-4 w-4 mr-2" />
              Download JSON
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => onOpenChange(false)} variant="default" className="w-full">
            I have saved my key
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


interface AccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AccountsDialog({ open, onOpenChange }: AccountsDialogProps) {
  const { wallets, wallet: activeWallet, switchAccount, removeAccount, connect, generateWallet } = useWallet();
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [newKey, setNewKey] = useState('');

  const handleImport = async () => {
    try {
      await connect(newKey);
      setNewKey('');
      setIsAdding(false);
      toast.success('Account imported');
    } catch (e) {
      toast.error('Import failed');
    }
  };

  const handleGenerate = async () => {
    try {
      const w = await generateWallet(); // Returns wallet object
      await connect(w.privateKey); // Add to context
      toast.success('New wallet generated');
      setIsAdding(false);
    } catch (e) {
      toast.error('Generation failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('wallet.title')}</DialogTitle>
          <DialogDescription>Manage your accounts</DialogDescription>
        </DialogHeader>

        {!isAdding ? (
          <div className="space-y-4">
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {wallets.map(w => (
                <div key={w.address} className={`p-3 rounded-lg border flex items-center justify-between ${activeWallet?.address === w.address ? 'bg-primary/5 border-primary' : 'bg-card'}`}>
                  <div className="flex flex-col overflow-hidden">
                    <span className="font-mono text-sm truncate w-[180px]">{shortenAddress(w.address)}</span>
                    <span className="text-xs text-muted-foreground">{formatAmount(w.balance)} CF</span>
                  </div>
                  <div className="flex gap-2">
                    {activeWallet?.address === w.address ? (
                      <Button size="sm" variant="ghost" disabled><Check className="h-4 w-4 mr-1" /> Active</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => switchAccount(w.address)}>Switch</Button>
                    )}
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeAccount(w.address)}>
                      <AlertTriangle className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button className="w-full" variant="outline" onClick={() => setIsAdding(true)}>
              <Key className="h-4 w-4 mr-2" /> Add Account
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Private Key</Label>
              <Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="0x..." />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleImport}>Import</Button>
              <Button className="flex-1" variant="outline" onClick={handleGenerate}>Generate New</Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setIsAdding(false)}>Cancel</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Wallet() {
  const { wallet, isConnected, connect, disconnect, generateWallet } = useWallet();
  const { t } = useTranslation();
  const [privateKey, setPrivateKey] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);

  // ... (handleConnect, handleGenerate Logic) ...
  const [newWallet, setNewWallet] = useState<{ address: string; privateKey: string; publicKey: string } | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await connect(privateKey);
    } catch (error) {
      toast.error('Invalid private key');
    }
  };

  const handleGenerate = async () => {
    try {
      const wallet = await generateWallet();
      setNewWallet(wallet);
      // Auto connect generated one? User might want to save it first.
      // Current logic: Just shows dialog.
    } catch (error) {
      console.error('Wallet generation failed:', error);
      toast.error('Failed to generate wallet: ' + (error instanceof Error ? error.message : String(error)));
    }
  };


  if (!isConnected) {
    return (
      // ... Login Screen ... (No changes needed, actually I replaced the whole component, so I must include it)
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground transition-colors duration-300">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WalletIcon className="h-6 w-6" />
              {t('wallet.import')}
            </CardTitle>
            <CardDescription>
              {t('wallet.sendDialog.password')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleConnect} className="space-y-4">
              <div>
                <Label>{t('wallet.sendDialog.password')}</Label>
                <div className="flex gap-2">
                  <Input
                    type={showPrivateKey ? 'text' : 'password'}
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="0x..."
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                  >
                    <Key className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Never share your private key with anyone.
                </AlertDescription>
              </Alert>
              <Button type="submit" className="w-full">
                {t('common.confirm')}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground uppercase">{t('common.or')}</span>
              </div>
            </div>

            <Button variant="outline" className="w-full" onClick={handleGenerate}>
              {t('wallet.generate')}
            </Button>
          </CardContent>
        </Card>

        {/* Success Dialog for Login Screen */}
        <GenerateSuccessDialog
          wallet={newWallet}
          open={!!newWallet}
          onOpenChange={(open) => !open && setNewWallet(null)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      <div className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <WalletIcon className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{t('wallet.title')}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-sm text-muted-foreground">{shortenAddress(wallet!.address)}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(wallet!.address);
                      toast.success(t('common.copied'));
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowAccounts(true)}>
                Switch Account
              </Button>
              <Button variant="ghost" onClick={disconnect} className="text-xs text-muted-foreground">
                Lock
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">{t('wallet.balance')}</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <p className="text-4xl font-bold">{formatAmount(wallet!.balance)}</p>
                  <span className="text-lg text-muted-foreground">CF</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-4">
              <SendDialog />
              <ReceiveDialog address={wallet!.address} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('wallet.accountInfo')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('wallet.nonce')}</span>
                  <span className="font-medium">{wallet!.nonce}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  {t('wallet.history')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="all">
                  <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
                    <TabsTrigger value="all">{t('common.all')}</TabsTrigger>
                    <TabsTrigger value="sent">{t('wallet.send')}</TabsTrigger>
                    <TabsTrigger value="received">{t('wallet.receive')}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="all" className="space-y-2">
                    <p className="text-center py-8 text-muted-foreground">{t('common.noData')}</p>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <GenerateSuccessDialog
        wallet={newWallet}
        open={!!newWallet}
        onOpenChange={(open) => !open && setNewWallet(null)}
      />
      <AccountsDialog open={showAccounts} onOpenChange={setShowAccounts} />
    </div>
  );
}
