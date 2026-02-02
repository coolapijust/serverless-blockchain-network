import { createServer } from 'node:http';
import api from './src/workers/api.ts';

// 仿真状态存储
const state = {
    accounts: new Map<string, { balance: bigint, nonce: number }>(),
    blocks: [] as any[],
    pendingQueue: [] as any[]
};

// 仿真环境变量逻辑
const mockEnv = {
    NETWORK_ID: "cloudflare-mvp-devnet",
    CHAIN_ID: "13371337",
    CONSENSUS_COORDINATOR: {
        idFromName: () => ({ toString: () => 'mock-id' }),
        get: () => ({
            fetch: async (url: string, init: any) => {
                const path = new URL(url).pathname;
                console.log(`[Mock DO] GET: ${path}`);

                if (path === '/state') {
                    return new Response(JSON.stringify({
                        success: true,
                        worldState: {
                            latestBlockHeight: state.blocks.length - 1,
                            latestBlockHash: state.blocks[state.blocks.length - 1]?.hash || '0x0',
                            totalTransactions: state.blocks.reduce((acc, b) => acc + b.transactions.length, 0)
                        },
                        pendingCount: state.pendingQueue.length
                    }));
                }

                if (path === '/queue') {
                    return new Response(JSON.stringify({
                        success: true,
                        transactions: state.pendingQueue
                    }));
                }

                if (path.startsWith('/account/')) {
                    const address = path.split('/').pop()!;
                    const acc = state.accounts.get(address) || { balance: 0n, nonce: 0 };
                    return new Response(JSON.stringify({
                        balance: acc.balance.toString(),
                        nonce: acc.nonce
                    }));
                }

                if (path === '/admin/init-genesis') {
                    state.blocks = [{ hash: '0xgenesis', header: { height: 0, timestamp: Date.now(), txCount: 0 }, transactions: [] }];
                    return new Response(JSON.stringify({ success: true }));
                }

                return new Response(JSON.stringify({ success: true, data: {} }));
            }
        })
    },
    CONFIG_KV: {
        get: async () => null,
        put: async () => { }
    }
};

const server = createServer(async (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url!, `${protocol}://${host}`);

    let body: any = null;
    if (req.method === 'POST') {
        const buffers = [];
        for await (const chunk of req) {
            buffers.push(chunk);
        }
        body = Buffer.concat(buffers).toString();
    }

    // 处理 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    const webReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers as any,
        body: body
    });

    try {
        const webRes = await api.fetch(webReq, mockEnv as any);
        res.statusCode = webRes.status;
        webRes.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'content-encoding') {
                res.setHeader(key, value);
            }
        });

        const responseBody = await webRes.text();
        res.end(responseBody);
    } catch (e: any) {
        console.error('[Mock Server Error]', e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
    }
});

const PORT = 8787;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Final Mock Backend running at http://localhost:${PORT}`);
    console.log(`SUCCESS: Bypassing wrangler/async.c conflict on Node v24.`);
});
