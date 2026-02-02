
// Node 18+ has native fetch

const NODES = [
    'https://blockchain-mvp.lovelylove.workers.dev',
    'https://blockchain-mvp-proposer.lovelylove.workers.dev',
    'https://blockchain-mvp-validator1.lovelylove.workers.dev',
    'https://blockchain-mvp-validator2.lovelylove.workers.dev'
];

async function check() {
    for (const url of NODES) {
        try {
            console.log(`Checking ${url}...`);
            const res = await fetch(`${url}/health`);
            if (res.ok) {
                const json = await res.json();
                console.log(`[OK] ${url}:`, JSON.stringify(json));
            } else {
                console.error(`[FAIL] ${url}: HTTP ${res.status}`);
                const text = await res.text();
                console.error('Body:', text);
            }
        } catch (e) {
            console.error(`[ERR] ${url}:`, e.message);
        }
    }

    // Check Status
    try {
        const statusRes = await fetch('https://blockchain-mvp.lovelylove.workers.dev/status');
        const status = await statusRes.json();
        console.log('Network Status:', JSON.stringify(status, null, 2));
    } catch (e) {
        console.error('Failed to get status');
    }
}

check();
