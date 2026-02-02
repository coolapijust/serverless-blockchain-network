/**
 * ============================================
 * Cloudflare Serverless Blockchain MVP
 * 加密工具库 - Ed25519 + SHA-256
 * ============================================
 * 
 * 设计原则：
 * 1. 使用 @noble/ed25519 进行所有签名操作（更稳定，跨环境一致）
 * 2. 使用 @noble/hashes 补充 Web Crypto 缺失的哈希函数
 * 3. SHA-256 依然优先使用 Web Crypto (SubtleCrypto)
 * 4. 解决 Cloudflare 上的 "invalid usage" 和 "Expected 3, got 2" 问题
 */

import type { HexString, Signature, Address, TxHash, BlockHash, KeyPair } from './types';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// 注册哈希函数库（@noble/ed25519 v3.0.0 必需）
// 我们同时注册同步和异步版本以确保最大兼容性
ed.hashes.sha512 = (msg) => sha512(msg);
ed.hashes.sha512Async = (msg) => Promise.resolve(sha512(msg));

// ============================================
// 编码工具
// ============================================

export function hexToBytes(hex: HexString): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string: length must be even');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): HexString {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function addHexPrefix(hex: string): HexString {
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function objectToBytes(obj: unknown): Uint8Array {
  const sorted = JSON.stringify(obj, Object.keys(obj as object).sort());
  return stringToBytes(sorted);
}

// ============================================
// SHA-256 哈希 (保持原生以获得最高性能)
// ============================================

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? stringToBytes(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(hashBuffer);
}

export async function sha256Hex(data: Uint8Array | string): Promise<HexString> {
  const hash = await sha256(data);
  return addHexPrefix(bytesToHex(hash));
}

export async function hashTransaction(tx: {
  from: string;
  to: string;
  amount: string;
  nonce: number;
  timestamp: number;
  gasPrice: string;
  gasLimit: string;
  publicKey: HexString;
}): Promise<TxHash> {
  const txData = {
    from: tx.from.toLowerCase(),
    to: tx.to.toLowerCase(),
    amount: tx.amount,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    gasPrice: tx.gasPrice,
    gasLimit: tx.gasLimit,
    publicKey: tx.publicKey,
  };
  return await sha256Hex(objectToBytes(txData));
}

export async function hashBlock(header: {
  height: number;
  timestamp: number;
  prevHash: string;
  txRoot: string;
  stateRoot: string;
  proposer: string;
  txCount: number;
}): Promise<BlockHash> {
  const headerData = {
    height: header.height,
    timestamp: header.timestamp,
    prevHash: header.prevHash.toLowerCase(),
    txRoot: header.txRoot.toLowerCase(),
    stateRoot: header.stateRoot.toLowerCase(),
    proposer: header.proposer,
    txCount: header.txCount,
  };
  return sha256Hex(objectToBytes(headerData));
}

export async function computeMerkleRoot(hashes: HexString[]): Promise<BlockHash> {
  if (hashes.length === 0) return sha256Hex('');
  if (hashes.length === 1) return hashes[0];

  let level = hashes.map(h => hexToBytes(h));
  while (level.length > 1) {
    const nextLevel: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const combined = new Uint8Array(64);
        combined.set(level[i], 0);
        combined.set(level[i + 1], 32);
        nextLevel.push(await sha256(combined));
      } else {
        nextLevel.push(level[i]);
      }
    }
    level = nextLevel;
  }
  return addHexPrefix(bytesToHex(level[0]));
}

// ============================================
// Ed25519 签名 (全部迁移到 Noble)
// ============================================

export async function generateKeyPair(): Promise<KeyPair> {
  const privKey = ed.utils.randomSecretKey();
  const pubKey = await ed.getPublicKeyAsync(privKey);
  return {
    privateKey: addHexPrefix(bytesToHex(privKey)),
    publicKey: addHexPrefix(bytesToHex(pubKey)),
  };
}

export async function importKeyPairFromPrivateKey(privateKeyHex: HexString): Promise<KeyPair> {
  try {
    const cleanKey = privateKeyHex.replace('0x', '');
    const keyBytes = hexToBytes(cleanKey);
    // 使用异步接口以确保最大兼容性
    const publicKeyBytes = await ed.getPublicKeyAsync(keyBytes);
    return {
      privateKey: addHexPrefix(cleanKey),
      publicKey: addHexPrefix(bytesToHex(publicKeyBytes)),
    };
  } catch (e: any) {
    throw new Error(`NOBLE-CRYPTO (KeyDerive) failed: ${e.message}`);
  }
}

export async function signWithPrivateKey(
  message: Uint8Array | string,
  privateKeyHex: HexString
): Promise<Signature> {
  try {
    const bytes = typeof message === 'string' ? stringToBytes(message) : message;
    const cleanKey = privateKeyHex.replace('0x', '');
    const keyBytes = hexToBytes(cleanKey);

    const signature = await ed.signAsync(bytes, keyBytes);
    return addHexPrefix(bytesToHex(signature));
  } catch (e: any) {
    throw new Error(`NOBLE-CRYPTO (Sign) failed: ${e.message}`);
  }
}

export async function verifySignature(
  message: Uint8Array | string,
  signature: Signature,
  publicKey: HexString
): Promise<boolean> {
  try {
    const bytes = typeof message === 'string' ? stringToBytes(message) : message;
    const signatureBytes = hexToBytes(signature);
    const cleanPubKey = publicKey.replace('0x', '');
    const pubKeyBytes = hexToBytes(cleanPubKey);

    return await ed.verifyAsync(signatureBytes, bytes, pubKeyBytes);
  } catch (error) {
    console.error('[Crypto] Noble verify failed:', error);
    return false;
  }
}

// ============================================
// 地址与辅助函数 (保持逻辑一致)
// ============================================

export function publicKeyToAddress(publicKey: HexString): Address {
  const cleanKey = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
  // 取前 40 字符（20 字节）- 务必确保公钥长度至少 20 字节
  const address = cleanKey.slice(0, 40).toLowerCase();
  return addHexPrefix(address);
}

export function isValidAddress(address: string): boolean {
  if (!address) return false;
  const clean = address.startsWith('0x') ? address.slice(2) : address;
  return clean.length === 40 && /^[0-9a-fA-F]+$/.test(clean);
}

export function createSignData(tx: {
  from: string;
  to: string;
  amount: string;
  nonce: number;
  timestamp: number;
}): string {
  const data = {
    from: tx.from.toLowerCase(),
    to: tx.to.toLowerCase(),
    amount: tx.amount,
    nonce: tx.nonce,
    timestamp: tx.timestamp,
  };
  return JSON.stringify(data, Object.keys(data).sort());
}

export async function signTransaction(
  tx: { from: string; to: string; amount: string; nonce: number; timestamp: number; },
  privateKeyHex: HexString
): Promise<Signature> {
  return signWithPrivateKey(createSignData(tx), privateKeyHex);
}

export async function verifyTransactionSignature(
  tx: { from: string; to: string; amount: string; nonce: number; timestamp: number; signature: string; },
  publicKeyHex: HexString
): Promise<boolean> {
  return verifySignature(createSignData(tx), tx.signature, publicKeyHex);
}

export function createBlockSignData(blockHash: BlockHash): string {
  return `block:${blockHash}`;
}

export async function signBlock(blockHash: BlockHash, privateKeyHex: HexString): Promise<Signature> {
  return signWithPrivateKey(createBlockSignData(blockHash), privateKeyHex);
}

export async function verifyBlockSignature(blockHash: BlockHash, signature: Signature, publicKeyHex: HexString): Promise<boolean> {
  return verifySignature(createBlockSignData(blockHash), signature, publicKeyHex);
}

export function generateNonce(): number {
  return Math.floor(Math.random() * 1000000);
}

// ============================================
// 兼容性接口 (移除对 CryptoKey 的依赖)
// ============================================

export async function importPublicKey(publicKeyHex: HexString): Promise<HexString> {
  return publicKeyHex;
}

export async function importPrivateKey(privateKeyHex: HexString): Promise<HexString> {
  return privateKeyHex;
}

export async function generateRandomPrivateKey(): Promise<HexString> {
  const kp = await generateKeyPair();
  return kp.privateKey;
}

export function getTestKeyPair(index?: number): KeyPair {
  // 返回一个固定的测试密钥对（用于本地开发）
  return {
    privateKey: '0x80600bdc83df0a633693fa8babd17a99e3006c71a7b9c706ea33c9f80ed11133',
    publicKey: '0x262ec0e5cbab9ed4680a756cd77515d97bfd5b0774e1f6ad0449f6b9ed23c85b'
  };
}
