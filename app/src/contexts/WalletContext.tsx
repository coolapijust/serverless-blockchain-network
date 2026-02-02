/**
 * ============================================
 * Wallet Context
 * ============================================
 */

import { useState, useCallback, useContext, createContext, useEffect, type ReactNode } from 'react';
import { generateKeyPair, importKeyPairFromPrivateKey, publicKeyToAddress } from '@/lib/crypto';
import { api } from '@/lib/api';

interface Wallet {
  address: string;
  publicKey: string;
  privateKey: string;
  balance: string;
  nonce: number;
}

// LocalStorage Keys
const STORAGE_KEY_WALLETS = 'blockchain_wallets';
const STORAGE_KEY_ACTIVE = 'blockchain_active_account';

interface StoredWallet {
  address: string;
  publicKey: string;
  privateKey: string;
}

interface WalletContextType {
  wallet: Wallet | null;
  wallets: Wallet[];
  isConnected: boolean;
  connect: (privateKey: string) => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  generateWallet: () => Promise<Wallet>;
  switchAccount: (address: string) => void;
  removeAccount: (address: string) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeAddress, setActiveAddress] = useState<string | null>(null);

  // Computed active wallet
  const wallet = wallets.find(w => w.address === activeAddress) || null;

  // Initialize from LocalStorage
  useState(() => {
    try {
      const storedWalletsJson = localStorage.getItem(STORAGE_KEY_WALLETS);
      const storedActive = localStorage.getItem(STORAGE_KEY_ACTIVE);

      if (storedWalletsJson) {
        const storedWallets: StoredWallet[] = JSON.parse(storedWalletsJson);
        // Hydrate wallets (initial balance 0, need refresh)
        const hydratedWallets: Wallet[] = storedWallets.map(w => ({
          ...w,
          balance: '0',
          nonce: 0
        }));
        setWallets(hydratedWallets);

        if (storedActive && hydratedWallets.some(w => w.address === storedActive)) {
          setActiveAddress(storedActive);
        } else if (hydratedWallets.length > 0) {
          setActiveAddress(hydratedWallets[0].address);
        }
      }
    } catch (e) {
      console.error('Failed to load wallets from storage', e);
    }
  });

  // Persist Wallets
  const persistWallets = (currentWallets: Wallet[]) => {
    const stored: StoredWallet[] = currentWallets.map(w => ({
      address: w.address,
      publicKey: w.publicKey,
      privateKey: w.privateKey
    }));
    localStorage.setItem(STORAGE_KEY_WALLETS, JSON.stringify(stored));
  };

  // Persist Active Account
  const persistActive = (address: string | null) => {
    if (address) {
      localStorage.setItem(STORAGE_KEY_ACTIVE, address);
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE);
    }
  };

  const generateWallet = useCallback(async (): Promise<Wallet> => {
    const keyPair = await generateKeyPair();
    const address = publicKeyToAddress(keyPair.publicKey);

    return {
      address,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      balance: '0',
      nonce: 0,
    };
  }, []);

  const refreshWalletBalance = async (w: Wallet): Promise<Wallet> => {
    try {
      const account = await api.getAccount(w.address);
      return { ...w, balance: account.balance, nonce: account.nonce };
    } catch {
      return w;
    }
  };


  // Trigger refresh when active address changes (basic)
  // We can also refresh all wallets

  const connect = useCallback(async (privateKey: string) => {
    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      throw new Error('Invalid private key format');
    }

    const keyPair = await importKeyPairFromPrivateKey(privateKey);
    const address = publicKeyToAddress(keyPair.publicKey);

    // Check if checks exist
    let newWallet: Wallet = {
      address,
      publicKey: keyPair.publicKey,
      privateKey,
      balance: '0',
      nonce: 0
    };

    // Fetch initial info
    newWallet = await refreshWalletBalance(newWallet);

    setWallets(prev => {
      const exists = prev.find(w => w.address === address);
      if (exists) return prev; // Already exists, just switch?
      const next = [...prev, newWallet];
      persistWallets(next);
      return next;
    });

    setActiveAddress(address);
    persistActive(address);
  }, []);

  const disconnect = useCallback(() => {
    // Current behavior: Logout (Clear Active)
    // Multi-account behavior: Just clear active? Or remove?
    // User requested "Prevent logout". So disconnect button should probably explicitly "Log out".
    setActiveAddress(null);
    persistActive(null);
  }, []);

  const removeAccount = useCallback((address: string) => {
    setWallets(prev => {
      const next = prev.filter(w => w.address !== address);
      persistWallets(next);
      return next;
    });
    if (activeAddress === address) {
      setActiveAddress(null);
      persistActive(null);
    }
  }, [activeAddress]);

  const switchAccount = useCallback((address: string) => {
    if (wallets.some(w => w.address === address)) {
      setActiveAddress(address);
      persistActive(address);
    }
  }, [wallets]);

  const refreshBalance = useCallback(async () => {
    if (!activeAddress) return;
    const w = wallets.find(w => w.address === activeAddress);
    if (!w) return;

    const updated = await refreshWalletBalance(w);
    setWallets(prev => prev.map(p => p.address === updated.address ? updated : p));
  }, [activeAddress, wallets]);

  // Initialize Effect (Load balances for all)
  useEffect(() => {
    if (wallets.length > 0) {
      Promise.all(wallets.map(refreshWalletBalance)).then(updated => {
        setWallets(updated);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        wallets,
        isConnected: !!wallet,
        connect,
        disconnect,
        refreshBalance,
        generateWallet,
        switchAccount,
        removeAccount
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
