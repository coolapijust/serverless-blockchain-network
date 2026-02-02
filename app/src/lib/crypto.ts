/**
 * ============================================
 * Cryptographic Utilities for Frontend
 * Uses @noble/ed25519 (Unified with Backend)
 * ============================================
 */

import type { HexString, Signature, Address, TxHash, KeyPair } from '../types';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// 注册哈希函数库（@noble/ed25519 v3.0.0 必需）
ed.hashes.sha512 = (msg) => sha512(ed.etc.concatBytes(msg));
ed.hashes.sha512Async = (msg) => Promise.resolve(sha512(ed.etc.concatBytes(msg)));

// ============================================
// Encoding Utilities
// ============================================

export function hexToBytes(hex: HexString): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) throw new Error('Invalid hex string');
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
// Hashing (SHA-256) - Keep Web Crypto for SHA256 as it's standard
// ============================================

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? stringToBytes(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as any);
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
  publicKey: HexString; // Added publicKey to hash for uniqueness security
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
  return sha256Hex(objectToBytes(txData));
}

// ============================================
// Ed25519 Signing (Noble Implementation)
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
    console.error('[Crypto] Frontend import failed:', e);
    throw new Error(`Invalid private key: ${e.message}`);
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
    console.error('[Crypto] Frontend sign failed:', e);
    throw new Error(`Signing failed: ${e.message}`);
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
    console.error('[Crypto] Frontend verify failed:', error);
    return false;
  }
}


// ============================================
// Address & Helper Functions
// ============================================

export function publicKeyToAddress(publicKey: HexString): Address {
  const cleanKey = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
  // Ensure we rely on standard behavior: slice first 20 bytes (40 hex chars)
  const address = cleanKey.slice(0, 40).toLowerCase();
  return addHexPrefix(address);
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
  tx: {
    from: string;
    to: string;
    amount: string;
    nonce: number;
    timestamp: number;
  },
  privateKeyHex: HexString
): Promise<Signature> {
  const signData = createSignData(tx);
  return signWithPrivateKey(signData, privateKeyHex);
}

// ============================================
// Formatting Helpers
// ============================================

export function shortenAddress(address: string): string {
  if (!address || typeof address !== 'string') return '';
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatAmount(amount: string | number | bigint): string {
  if (amount === undefined || amount === null || amount === '') return '0';
  try {
    const val = BigInt(amount.toString());
    const divisor = 1000000000000000000n;
    const integerPart = val / divisor;

    // 如果是整数，直接返回
    if (val % divisor === 0n) {
      return integerPart.toString();
    }

    // 如果有小数，保留最多 6 位有效（根据之前的约定）
    const fractionalPart = val % divisor;
    let fracStr = fractionalPart.toString().padStart(18, '0');
    fracStr = fracStr.replace(/0+$/, ''); // 即移除尾部0

    if (fracStr.length > 6) {
      fracStr = fracStr.slice(0, 6);
    }

    // 处理如 0.0001
    return `${integerPart}.${fracStr}`;
  } catch (e) {
    return String(amount);
  }
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
