
// Node 18+ has native fetch

const GATEWAY = 'https://blockchain-mvp.lovelylove.workers.dev';
const TEST_ADDR = '0x1234567890123456789012345678901234567890';

async function trace() {
    console.log('--- 1. Requesting Faucet ---');
    const res = await fetch(`${GATEWAY}/faucet`, {
        method: 'POST',
        body: JSON.stringify({ address: TEST_ADDR, amount: '1000000000000000000' }),
        headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    console.log('Faucet Response:', JSON.stringify(data, null, 2));

    if (!data.success) return;
    const txHash = data.data.txHash;

    console.log('\n--- 2. Checking Status Immediately ---');
    const statusRes = await fetch(`${GATEWAY}/status`);
    const status = await statusRes.json();
    console.log('Network Status:', JSON.stringify(status, null, 2));

    console.log('\n--- 3. Checking Transaction State ---');
    const txRes = await fetch(`${GATEWAY}/tx/${txHash}`);
    const txStatus = await txRes.json();
    console.log('TX Status:', JSON.stringify(txStatus, null, 2));

    console.log('\n--- 4. Manually Triggering Proposer ---');
    const triggerRes = await fetch('https://blockchain-mvp-proposer.lovelylove.workers.dev/internal/trigger', {
        method: 'POST'
    });
    const triggerData = await triggerRes.json();
    console.log('Trigger Response:', JSON.stringify(triggerData, null, 2));

    console.log('\n--- 5. Final Status Check ---');
    const finalStatusRes = await fetch(`${GATEWAY}/status`);
    const finalStatus = await finalStatusRes.json();
    console.log('Final Status:', JSON.stringify(finalStatus, null, 2));
}

trace();
