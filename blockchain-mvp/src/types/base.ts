/**
 * Base Types for Blockchain MVP
 */

/** 十六进制字符串 */
export type HexString = string;

/** 地址（Ed25519 公钥前 20 字节） */
export type Address = string;

/** 交易哈希 */
export type TxHash = HexString;

/** 区块哈希 */
export type BlockHash = HexString;

/** Ed25519 签名 */
export type Signature = HexString;

/** 时间戳（毫秒） */
export type Timestamp = number;
