
import { fetch } from 'undici';

async function trigger() {
    try {
        const res = await fetch('https://blockchain-mvp-proposer.lovelylove.workers.dev/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp: 1700000000 })
        });

        if (!res.ok) {
            const text = await res.text();
            console.log('Error status:', res.status);
            console.log('Error body:', text);
        } else {
            const json = await res.json();
            console.log('Success:', json);
        }
    } catch (err) {
        console.error('Fetch failed:', err);
    }
}

trigger();
