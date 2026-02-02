const ed = require('@noble/ed25519');
const crypto = require('crypto');

async function gen() {
    for (let i = 0; i < 3; i++) {
        const privBytes = crypto.randomBytes(32);
        const pubBytes = await ed.getPublicKey(privBytes);
        const privHex = '0x' + privBytes.toString('hex');
        const pubHex = '0x' + Buffer.from(pubBytes).toString('hex');
        const addr = '0x' + pubHex.slice(2, 42);
        console.log(`Node ${i}:`);
        console.log(`  Private: ${privHex}`);
        console.log(`  Public:  ${pubHex}`);
        console.log(`  Address: ${addr}`);
    }
}

gen();
