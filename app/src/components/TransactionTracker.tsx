import { useEffect, useState, useRef } from 'react';
import {
    CheckCircle2,
    Loader2,
    Server,
    Database,
    Cuboid,
    Network,
    ExternalLink
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from '@/contexts/I18nContext';

interface TransactionTrackerProps {
    txHash: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void;
}

type StepStatus = 'waiting' | 'active' | 'completed';

interface Step {
    id: string;
    titleKey: string;
    descKey: string;
    icon: React.ElementType;
}

export function TransactionTracker({
    txHash,
    open,
    onOpenChange,
    onComplete
}: TransactionTrackerProps) {
    const { t } = useTranslation();

    // Animation Queue State
    const [visualStep, setVisualStep] = useState(0);
    const [progress, setProgress] = useState(0);
    const [txDetails, setTxDetails] = useState<any>(null);
    const [isFinished, setIsFinished] = useState(false);

    // Refs for queue management
    const targetStepRef = useRef(0);
    const processingRef = useRef(false);

    const steps: Step[] = [
        {
            id: 'broadcast',
            titleKey: 'tracker.step1.title',
            descKey: 'tracker.step1.desc',
            icon: Server,
        },
        {
            id: 'consensus',
            titleKey: 'tracker.step2.title',
            descKey: 'tracker.step2.desc',
            icon: Network,
        },
        {
            id: 'commit',
            titleKey: 'tracker.step3.title',
            descKey: 'tracker.step3.desc',
            icon: Cuboid,
        },
        {
            id: 'confirmed',
            titleKey: 'tracker.step4.title',
            descKey: 'tracker.step4.desc',
            icon: Database,
        },
    ];

    // Refs for stable callback access
    const onCompleteRef = useRef(onComplete);
    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    // Reset Effect (Only on open change or new txHash)
    useEffect(() => {
        if (!open || !txHash) { // If dialog is closed or txHash is null, reset everything
            setVisualStep(0);
            targetStepRef.current = 0;
            setProgress(0);
            setTxDetails(null);
            setIsFinished(false);
            processingRef.current = false;
        } else { // If dialog is open with a txHash, prepare for new tracking
            setVisualStep(0);
            targetStepRef.current = 0;
            setProgress(5);
            setIsFinished(false);
            setTxDetails(null);
            processingRef.current = false;
        }
    }, [open, txHash]);

    // Polling Effect
    useEffect(() => {
        if (!open || !txHash) return;

        let isMounted = true;
        const pollInterval = setInterval(async () => {
            try {
                const tx = await api.getTransaction(txHash);
                if (!isMounted) return;

                setTxDetails(tx);

                let backendTarget = 0;
                switch (tx.status) {
                    case 'pending': backendTarget = 0; break;
                    case 'processing': backendTarget = 1; break;
                    case 'confirmed': backendTarget = 3; break;
                    case 'failed':
                        clearInterval(pollInterval);
                        toast.error(t('tracker.failed'));
                        return;
                }

                if (backendTarget > targetStepRef.current) {
                    targetStepRef.current = backendTarget;
                }

                if (tx.status === 'confirmed') {
                    clearInterval(pollInterval);
                    // Use ref to avoid dependency re-run
                    if (onCompleteRef.current) onCompleteRef.current();
                }

            } catch (e) {
                console.error('Polling error', e);
            }
        }, 1000);

        return () => {
            isMounted = false;
            clearInterval(pollInterval);
        };
    }, [txHash, open, t]); // Removed onComplete

    // Animation Effect Loop
    useEffect(() => {
        if (!open) return;

        const processQueue = async () => {
            if (processingRef.current) return;
            processingRef.current = true;

            // While visual step is behind target step
            while (visualStep < targetStepRef.current) {
                // Wait for minimum duration (e.g., 600ms per step)
                // This creates the "smooth animation" even if backend is instant
                await new Promise(r => setTimeout(r, 600));

                setVisualStep(prev => {
                    const next = prev + 1;
                    // Update progress bar
                    const newProgress = Math.min(100, Math.floor(((next + 1) / steps.length) * 100));
                    setProgress(newProgress);
                    return next;
                });
            }

            // If we reached the end
            if (targetStepRef.current === 3 && visualStep === 3) {
                setIsFinished(true);
                setProgress(100);
            }

            processingRef.current = false;
        };

        // Check if we need to advance every 100ms
        const animationCheck = setInterval(() => {
            if (visualStep < targetStepRef.current) {
                processQueue();
            } else if (visualStep === 3 && targetStepRef.current === 3 && !isFinished) {
                setIsFinished(true);
                setProgress(100);
            }
        }, 100);

        return () => clearInterval(animationCheck);
    }, [visualStep, open, isFinished]);


    const getStepStatus = (index: number): StepStatus => {
        if (index < visualStep) return 'completed';
        if (index === visualStep) return 'active';
        return 'waiting';
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {t('tracker.title')}
                        <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]" title={txHash || ''}>
                            {txHash?.slice(0, 10)}...
                        </span>
                    </DialogTitle>
                    <DialogDescription>
                        {t('tracker.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-6">
                    {/* Progress Bar */}
                    <Progress value={progress} className="h-2 transition-all duration-500" />

                    {/* Steps List */}
                    <div className="space-y-5">
                        {steps.map((step, index) => {
                            const status = getStepStatus(index);
                            const isLast = index === steps.length - 1;

                            return (
                                <div key={step.id} className="flex items-start gap-4 h-10 relative">
                                    <div className={cn(
                                        "relative flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all duration-300 z-10 shrink-0",
                                        status === 'completed' ? "bg-primary border-primary text-primary-foreground scale-110" :
                                            status === 'active' ? "border-primary text-primary shadow-lg shadow-primary/20 scale-110" :
                                                "border-muted text-muted-foreground"
                                    )}>
                                        {status === 'completed' ? (
                                            <CheckCircle2 className="w-4 h-4" />
                                        ) : (
                                            <step.icon className="w-4 h-4" />
                                        )}

                                        {/* Vertical Line Connection */}
                                        {!isLast && (
                                            <div className={cn(
                                                "absolute top-8 left-1/2 w-0.5 h-10 -translate-x-1/2 -z-10 transition-colors duration-500 delay-150",
                                                status === 'completed' ? "bg-primary" : "bg-muted"
                                            )} />
                                        )}
                                    </div>

                                    <div className="flex-1 pt-0.5 min-w-0">
                                        <h4 className={cn(
                                            "text-sm font-medium leading-none transition-colors",
                                            status === 'waiting' ? "text-muted-foreground" : "text-foreground"
                                        )}>
                                            {t(step.titleKey)}
                                        </h4>
                                        <p className="text-xs text-muted-foreground mt-1 truncate">
                                            {t(step.descKey)}
                                        </p>

                                        {/* Dynamic Status Detail */}
                                        {status === 'active' && step.id === 'consensus' && (
                                            <div className="mt-2 text-xs text-primary flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                {t('tracker.waitingValidators')}
                                            </div>
                                        )}
                                        {status === 'completed' && step.id === 'commit' && txDetails?.blockHeight && (
                                            <div className="mt-1 text-xs text-green-600 font-mono animate-in fade-in">
                                                Block #{txDetails.blockHeight}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Completion Action */}
                    {isFinished && txHash && (
                        <div className="pt-2 animate-in fade-in slide-in-from-bottom-2">
                            <Link to={`/tx/${txHash}`} onClick={() => onOpenChange(false)} className="w-full block">
                                <Button className="w-full gap-2">
                                    {t('tracker.viewDetail')}
                                    <ExternalLink className="w-4 h-4" />
                                </Button>
                            </Link>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
