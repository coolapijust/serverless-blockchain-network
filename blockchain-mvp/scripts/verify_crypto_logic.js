
const ed = require('@noble/ed25519');

const priv = "ae2d2df90c88fbe88e4af47db9fe5adb7b0711e93edfe568f2b15850710d1606";
const expectedAddr = "0xe6d85a43ae796ea851f8f11a1e0dd0ec32a1a5bf";

async function check() {
    console.log("Checking key derivation...");
    const pubBytes = await ed.getPublicKey(priv);
    const pubHex = Buffer.from(pubBytes).toString('hex');
    const addr = "0x" + pubHex.slice(0, 40);

    console.log("Derived Addr:", addr);
    console.log("Expected Addr:", expectedAddr);

    if (addr === expectedAddr) {
        console.log("✅ Match!");
    } else {
        console.log("❌ Mismatch!");
    }
}

check();
