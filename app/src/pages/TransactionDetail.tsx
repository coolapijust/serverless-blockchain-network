import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/contexts/I18nContext';
import { api } from '@/lib/api';
import { shortenAddress, formatAmount, timeAgo } from '@/lib/crypto';
import type { Transaction } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRightLeft, Clock, ArrowLeft } from 'lucide-react';

export default function TransactionDetail() {
    const { hash } = useParams();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [tx, setTx] = useState<Transaction | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (hash) {
            loadTx(hash);
        }
    }, [hash]);

    async function loadTx(txHash: string) {
        try {
            setLoading(true);
            setError('');
            const data = await api.getTransaction(txHash);
            setTx(data);
        } catch (e: any) {
            console.error('Failed to load transaction:', e);
            setError(e.message || 'Transaction not found');
        } finally {
            setLoading(false);
        }
    }

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

    if (loading) {
        return (
            <div className="container mx-auto px-4 py-8 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error || !tx) {
        return (
            <div className="container mx-auto px-4 py-8">
                <div className="mb-4">
                    <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate(-1)}>
                        <ArrowLeft className="h-4 w-4" />
                        {t('common.back')}
                    </Button>
                </div>
                <Card className="border-red-200 bg-red-50">
                    <CardContent className="p-8 text-center text-red-600">
                        <h2 className="text-xl font-bold mb-2">{t('explorer.status.failed')}</h2>
                        <p>{error || t('common.noData')}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <ArrowRightLeft className="h-6 w-6" />
                    {t('tx.title')}
                </h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('tx.overview')}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-1">
                                <span className="text-sm text-muted-foreground">{t('common.hash')}</span>
                                <div className="font-mono text-sm break-all bg-muted p-2 rounded">
                                    {tx.hash}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-1">
                                    <span className="text-sm text-muted-foreground">{t('tx.status')}</span>
                                    <div className="flex items-center gap-2">
                                        <div className={`h-2 w-2 rounded-full ${statusColors[tx.status]}`} />
                                        <span className="font-medium capitalize">{statusLabels[tx.status] || tx.status}</span>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <span className="text-sm text-muted-foreground">{t('tx.blockHeight')}</span>
                                    <div className="flex items-center gap-2">
                                        {tx.blockHeight !== undefined ? (
                                            <Link to={`/block/${tx.blockHeight}`} className="text-primary hover:underline font-mono">
                                                #{tx.blockHeight}
                                            </Link>
                                        ) : (
                                            <span className="text-muted-foreground italic">{t('tx.unconfirmed')}</span>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <span className="text-sm text-muted-foreground">{t('common.timestamp')}</span>
                                    <div className="flex items-center gap-2 text-sm">
                                        <Clock className="h-4 w-4 text-muted-foreground" />
                                        {new Date(tx.timestamp).toLocaleString()} ({timeAgo(tx.timestamp)})
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <span className="text-sm text-muted-foreground">{t('common.amount')}</span>
                                    <div className="text-xl font-bold">
                                        {formatAmount(tx.amount)} CF
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <span className="text-sm text-muted-foreground">{t('common.from')}</span>
                                    <div className="flex items-center gap-2 font-mono text-sm break-all">
                                        <Link to={`/address/${tx.from}`} className="hover:underline text-primary">
                                            {shortenAddress(tx.from)}
                                        </Link>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <span className="text-sm text-muted-foreground">{t('common.to')}</span>
                                    <div className="flex items-center gap-2 font-mono text-sm break-all">
                                        <Link to={`/address/${tx.to}`} className="hover:underline text-primary">
                                            {shortenAddress(tx.to)}
                                        </Link>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-dashed">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-sm text-muted-foreground">{t('tx.sigAlgo')}</span>
                                        <div className="text-sm font-medium">Ed25519 (Modern Edge Crypto)</div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-sm text-muted-foreground">{t('tx.dataModel')}</span>
                                        <div className="text-sm font-medium">Account-based (Standard Ledger)</div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">{t('tx.signatory')}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-1">
                                <span className="text-sm text-muted-foreground">{t('tx.publicKey')}</span>
                                <div className="font-mono text-xs break-all bg-muted p-2 rounded">
                                    {tx.publicKey}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-sm text-muted-foreground">{t('tx.signature')}</span>
                                <div className="font-mono text-xs break-all bg-muted p-2 rounded">
                                    {tx.signature}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card className="bg-primary/5 border-primary/20">
                        <CardContent className="p-4 space-y-3">
                            <h3 className="font-bold text-sm uppercase tracking-wider text-primary">{t('tx.edgeAnalysis')}</h3>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                {t('tx.edgeDesc')}
                            </p>
                            <ul className="text-xs space-y-2 list-disc pl-4 text-muted-foreground">
                                <li>{t('tx.determinism')}</li>
                                <li>{t('tx.finality')}</li>
                                <li>{t('tx.efficiency')}</li>
                            </ul>
                        </CardContent>
                    </Card>

                    <div className="p-4 rounded-lg bg-muted text-xs text-muted-foreground italic border">
                        {t('tx.note')}
                    </div>
                </div>
            </div>
        </div>
    );
}
