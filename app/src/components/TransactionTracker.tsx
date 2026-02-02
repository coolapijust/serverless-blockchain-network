
import { useEffect, useState } from 'react';
import {
    CheckCircle2,
    Loader2,
    Server,
    Database,
    Cuboid,
    Network
} from 'lucide-react';
import { api } from '@/lib/api';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface TransactionTrackerProps {
    txHash: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void;
}

type StepStatus = 'waiting' | 'active' | 'completed';

interface Step {
    id: string;
    title: string;
    description: string;
    icon: React.ElementType;
}

export function TransactionTracker({
    txHash,
    open,
    onOpenChange,
    onComplete
}: TransactionTrackerProps) {
    // const { t } = useTranslation(); // Unused for now
    const [currentStep, setCurrentStep] = useState(0);
    const [progress, setProgress] = useState(0);
    const [txDetails, setTxDetails] = useState<any>(null);

    const steps: Step[] = [
        {
            id: 'broadcast',
            title: 'Broadcasting',
            description: 'Sending to Pending Queue',
            icon: Server,
        },
        {
            id: 'consensus',
            title: 'Consensus',
            description: 'Proposer & Validators Voting',
            icon: Network,
        },
        {
            id: 'commit',
            title: 'Finalizing',
            description: 'Committing to Block',
            icon: Cuboid,
        },
        {
            id: 'confirmed',
            title: 'Confirmed',
            description: 'Transaction Mined',
            icon: Database, // Or CheckCircle2
        },
    ];

    useEffect(() => {
        if (!open || !txHash) {
            setCurrentStep(0);
            setProgress(0);
            // setPollCount(0); // Removed
            setTxDetails(null);
            return;
        }

        // Initial state: Step 0 (Submitted)
        let isMounted = true;
        const pollInterval = setInterval(async () => {
            try {
                const tx = await api.getTransaction(txHash);
                if (!isMounted) return;

                setTxDetails(tx);

                // Status mapping to Steps
                // Backend Status: pending, processing, confirmed, failed

                switch (tx.status) {
                    case 'pending':
                        setCurrentStep(0); // Broadcasting
                        setProgress(33);
                        break;
                    case 'processing':
                        setCurrentStep(1); // Consensus
                        setProgress(66);
                        break;
                    case 'confirmed':
                        setCurrentStep(3); // Done
                        setProgress(100);
                        clearInterval(pollInterval);
                        setTimeout(() => {
                            if (onComplete) onComplete();
                        }, 1000);
                        break;
                    case 'failed':
                        clearInterval(pollInterval);
                        toast.error('Transaction Failed');
                        onOpenChange(false);
                        break;
                }

            } catch (e) {
                console.error('Polling error', e);
            }
        }, 1000);

        return () => {
            isMounted = false;
            clearInterval(pollInterval);
        };
    }, [txHash, open, onComplete, onOpenChange]);

    const getStepStatus = (index: number): StepStatus => {
        if (index < currentStep) return 'completed';
        if (index === currentStep) return 'active';
        return 'waiting';
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        TX Tracking
                        <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]" title={txHash || ''}>
                            {txHash?.slice(0, 10)}...
                        </span>
                    </DialogTitle>
                    <DialogDescription>
                        Monitoring blockchain consensus status
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-6">
                    {/* Progress Bar (Visual approximation) */}
                    <Progress value={progress} className="h-2" />

                    {/* Steps List */}
                    <div className="space-y-4">
                        {steps.map((step, index) => {
                            const status = getStepStatus(index);
                            const isLast = index === steps.length - 1;

                            return (
                                <div key={step.id} className="flex items-start gap-4">
                                    <div className={cn(
                                        "relative flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors z-10",
                                        status === 'completed' ? "bg-primary border-primary text-primary-foreground" :
                                            status === 'active' ? "border-primary text-primary animate-pulse" :
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
                                                "absolute top-8 left-1/2 w-0.5 h-6 -translate-x-1/2 -z-10",
                                                status === 'completed' ? "bg-primary" : "bg-muted"
                                            )} />
                                        )}
                                    </div>

                                    <div className="flex-1 pt-1">
                                        <h4 className={cn(
                                            "text-sm font-medium leading-none",
                                            status === 'waiting' && "text-muted-foreground"
                                        )}>
                                            {step.title}
                                        </h4>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {step.description}
                                        </p>
                                        {status === 'active' && step.id === 'consensus' && (
                                            <div className="mt-2 text-xs text-primary flex items-center gap-1">
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                Waiting for 2/3 Validators...
                                            </div>
                                        )}
                                        {status === 'completed' && step.id === 'commit' && txDetails?.blockHeight && (
                                            <div className="mt-1 text-xs text-green-600 font-mono">
                                                Block #{txDetails.blockHeight}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
