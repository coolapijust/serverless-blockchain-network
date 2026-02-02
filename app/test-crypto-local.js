
import { generateKeyPair, importKeyPairFromPrivateKey } from './src/lib/crypto.ts';

// Mock Browser Crypto if needed (Node.js 19+ has specific requirements, but let's try direct imports first)
// Wait, local imports might fail in standalone script if it imports from 'src/lib/crypto' using TS imports.
// I will create a simpler test that uses the library directly to prove the library version works.

import * as ed from '@noble/ed25519';

async function test() {
    console.log("Testing @noble/ed25519 v1.7.1...");

    // 1. Generate Private Key
    const privKey = ed.utils.randomPrivateKey();
    console.log("Private Key Generated (Bytes):", privKey.length);

    // 2. Derive Public Key
    try {
        const pubKey = await ed.getPublicKey(privKey);
        console.log("Public Key Derived Successfully:", Buffer.from(pubKey).toString('hex'));
        console.log("TEST PASSED!");
    } catch (err) {
        console.error("TEST FAILED:", err);
        process.exit(1);
    }
}

test();
