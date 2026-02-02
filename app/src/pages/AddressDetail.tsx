import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/contexts/I18nContext';
import { api } from '@/lib/api';
import { shortenAddress, formatAmount, timeAgo } from '@/lib/crypto';
import type { Account, Transaction } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    ArrowLeft,
    Wallet,
    History,
    ArrowRightLeft,
    Loader2,
    Copy,
    Check
} from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { toast } from 'sonner';

function AddressDetailContent() {
    const { address } = useParams<{ address: string }>();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [account, setAccount] = useState<Account | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (address) {
            loadData(address);
        }
    }, [address]);

    async function loadData(addr: string) {
        setLoading(true);
        try {
            console.log(`[AddressDetail] Fetching data for ${addr}...`);
            const [accData, txsData] = await Promise.all([
                api.getAccount(addr),
                api.getAccountTransactions(addr)
            ]);

            setAccount(accData);
            setTransactions(txsData || []);
        } catch (error) {
            console.error('[AddressDetail] Failed to load data:', error);
            toast.error(t('common.error') || 'Failed to load address data');
        } finally {
            setLoading(false);
        }
    }

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success(t('common.copied'));
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) {
        return (
            <div className="container mx-auto px-4 py-12 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 space-y-6">
            <div className="flex items-center justify-between mb-2">
                <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate(-1)}>
                    <ArrowLeft className="h-4 w-4" />
                    {t('common.back')}
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Account Overview */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Wallet className="h-5 w-5 text-primary" />
                            {t('address.overview')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div>
                            <p className="text-sm text-muted-foreground mb-1">{t('wallet.address')}</p>
                            <div className="flex items-center gap-2 bg-muted p-2 rounded-lg break-all font-mono text-xs">
                                {address}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 shrink-0"
                                    onClick={() => address && copyToClipboard(address)}
                                >
                                    {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                </Button>
                            </div>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground mb-1">{t('address.balance')}</p>
                            <p className="text-3xl font-bold text-primary">
                                {account ? formatAmount(account.balance) : '0.00'} <span className="text-sm font-normal text-muted-foreground">CF</span>
                            </p>
                        </div>

                        {account && account.nonce !== undefined && (
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">{t('wallet.nonce')}</p>
                                <p className="font-mono">{account.nonce}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Transaction History */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <History className="h-5 w-5 text-primary" />
                            {t('address.transactions')}
                        </CardTitle>
                        <CardDescription>
                            {transactions.length} {t('address.transactions').toLowerCase()}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {transactions.length === 0 ? (
                            <div className="text-center py-12 border rounded-lg border-dashed bg-muted/30">
                                <History className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                                <p className="text-muted-foreground">{t('common.noData')}</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {transactions.map((tx) => (
                                    <Link key={tx.hash} to={`/tx/${tx.hash}`} className="block">
                                        <div className="p-4 border rounded-xl flex items-center justify-between hover:bg-accent hover:border-primary/20 transition-all cursor-pointer group">
                                            <div className="flex items-center gap-4">
                                                <div className={`p-2.5 rounded-full ${tx.from.toLowerCase() === address?.toLowerCase() ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>
                                                    {tx.from.toLowerCase() === address?.toLowerCase() ?
                                                        <ArrowRightLeft className="h-5 w-5" /> :
                                                        <ArrowRightLeft className="h-5 w-5 rotate-180" />
                                                    }
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-sm flex items-center gap-2">
                                                        {tx.from.toLowerCase() === address?.toLowerCase() ? t('wallet.sent') : t('wallet.received')}
                                                        <span className="text-xs font-normal text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                                            {tx.status || 'Confirmed'}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-muted-foreground font-mono mt-1">
                                                        {new Date(tx.timestamp).toLocaleString()} • {timeAgo(tx.timestamp)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className={`font-bold ${tx.from.toLowerCase() === address?.toLowerCase() ? 'text-foreground' : 'text-green-600'}`}>
                                                    {tx.from.toLowerCase() === address?.toLowerCase() ? '-' : '+'}{formatAmount(tx.amount)} CF
                                                </div>
                                                <div className="text-[10px] text-muted-foreground font-mono mt-1 group-hover:text-primary transition-colors">
                                                    {shortenAddress(tx.hash)}
                                                </div>
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default function AddressDetail() {
    return (
        <ErrorBoundary>
            <AddressDetailContent />
        </ErrorBoundary>
    );
}
