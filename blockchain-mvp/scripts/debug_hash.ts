
import { hashBlock } from '../src/crypto';

async function test() {
    const header = {
        height: 1,
        timestamp: 1234567890,
        prevHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        txRoot: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        stateRoot: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        proposer: "node-0",
        txCount: 1
    };

    const hash = await hashBlock(header);
    console.log("Header:", JSON.stringify(header, null, 2));
    console.log("Hash:", hash);
}

test().catch(console.error);
