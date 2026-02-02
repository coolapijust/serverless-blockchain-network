import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/contexts/I18nContext';
import { api } from '@/lib/api';
import { shortenAddress, formatAmount, timeAgo } from '@/lib/crypto';
import type { Block } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Loader2, Box, Clock, ShieldCheck, Database, Hash, ArrowLeft } from 'lucide-react';

import { ErrorBoundary } from '@/components/ErrorBoundary';

function BlockDetailContent() {
    const { height } = useParams();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [block, setBlock] = useState<Block | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        console.log('[BlockDetail] useEffect triggered, height:', height);
        if (height) {
            loadBlock(parseInt(height));
        } else {
            console.error('[BlockDetail] No height parameter in URL');
            setError('No block height specified');
            setLoading(false);
        }
    }, [height]);

    async function loadBlock(h: number) {
        try {
            setLoading(true);
            setError('');
            console.log(`[BlockDetail] Loading block ${h}...`);
            const data = await api.getBlock(h);
            console.log(`[BlockDetail] Received block data:`, {
                hasData: !!data,
                hasHeader: !!data?.header,
                height: data?.header?.height,
                txCount: data?.transactions?.length
            });

            if (!data) {
                throw new Error('Block data is null');
            }
            if (!data.header) {
                console.error('[BlockDetail] Missing header in block data:', data);
                throw new Error('Invalid block data: missing header');
            }

            console.log(`[BlockDetail] Setting block state for height ${h}`);
            setBlock(data);
            console.log(`[BlockDetail] Block state set successfully`);
        } catch (e: any) {
            console.error('[BlockDetail] Failed to load block:', e);
            setError(e.message || 'Block not found');
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="container mx-auto px-4 py-8 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error || !block) {
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
                        <h2 className="text-xl font-bold mb-2">Error Loading Block</h2>
                        <p>{error || 'Block not found'}</p>
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
                    <Box className="h-6 w-6" />
                    Block #{block.header.height}
                </h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Block Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                            <span className="text-sm text-muted-foreground">{t('common.hash')}</span>
                            <div className="font-mono text-sm break-all">{block.hash}</div>
                        </div>

                        <div className="space-y-1">
                            <span className="text-sm text-muted-foreground">{t('common.timestamp')}</span>
                            <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                {block?.header?.timestamp ? (
                                    <>
                                        {new Date(block.header.timestamp).toLocaleString()} ({timeAgo(block.header.timestamp)})
                                    </>
                                ) : (
                                    <span className="text-muted-foreground italic">Pending</span>
                                )}
                            </div>
                        </div>

                        <div className="space-y-1">
                            <span className="text-sm text-muted-foreground">{t('explorer.proposer') || 'Proposer'}</span>
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                                <span className="font-mono">{block.header.proposer}</span>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <span className="text-sm text-muted-foreground">{t('explorer.transactions')}</span>
                            <div className="flex items-center gap-2">
                                <Database className="h-4 w-4 text-muted-foreground" />
                                {block.header.txCount}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <span className="text-sm text-muted-foreground">State Root</span>
                        <div className="font-mono text-xs break-all bg-muted p-2 rounded">
                            {block.header.stateRoot}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Hash className="h-5 w-5" />
                        {t('explorer.transactions')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {block.transactions && block.transactions.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('common.txHash') || 'Hash'}</TableHead>
                                    <TableHead>{t('common.from') || 'From'}</TableHead>
                                    <TableHead>{t('common.to') || 'To'}</TableHead>
                                    <TableHead className="text-right">{t('common.amount') || 'Amount'}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {block.transactions.map((tx) => (
                                    <TableRow key={tx.hash}>
                                        <TableCell className="font-mono text-xs">{tx.hash}</TableCell>
                                        <TableCell className="font-mono text-xs">
                                            <Link to={`/address/${tx.from}`} className="hover:underline text-primary">
                                                {shortenAddress(tx.from)}
                                            </Link>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            <Link to={`/address/${tx.to}`} className="hover:underline text-primary">
                                                {shortenAddress(tx.to)}
                                            </Link>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs">{formatAmount(tx.amount)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <div className="text-center py-8 text-muted-foreground">
                            {t('common.noData') || 'No transactions in this block'}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function BlockDetail() {
    return (
        <ErrorBoundary>
            <BlockDetailContent />
        </ErrorBoundary>
    );
}
