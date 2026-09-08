'use client';

import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Check,
  CircleDashed,
  Clipboard,
  Cookie,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Radio,
  RefreshCw,
  Sparkles,
  WalletMinimal,
  Zap,
} from 'lucide-react';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { useCallback, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

const COOKIE_RPC = 'https://rpc.cookiescan.io';
const COOKIE_EXPLORER = 'https://cookiescan.io';
const COOKIE_CHECKPOINT_MEMO = 'CookieCheckpoint:v1';
const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
);
const ACTIVITY_STORAGE_KEY = 'cookie-checkpoint:activity';

type Checkpoint = {
  signature: string;
  createdAt: number;
  streak: number;
};

type NightlyAccount = {
  address: string;
  publicKey?: Uint8Array;
  chains?: readonly string[];
  features?: readonly string[];
};

type NightlySolana = {
  genesisHash?: string;
  changeNetwork?: (network: {
    genesisHash: string;
    url: string;
  }) => Promise<void>;
  features: {
    'standard:connect'?: {
      connect: (input?: { silent?: boolean }) => Promise<{
        accounts: readonly NightlyAccount[];
      }>;
    };
    'standard:disconnect'?: { disconnect: () => Promise<void> };
    'standard:signTransaction'?: {
      signTransaction: (input: {
        account: NightlyAccount;
        transaction: Uint8Array;
      }) => Promise<readonly { signedTransaction: Uint8Array }[]>;
    };
  };
};

declare global {
  interface Window {
    nightly?: { solana?: NightlySolana };
  }
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function readStoredActivity() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? '[]',
    );
    return Array.isArray(parsed) ? (parsed as Checkpoint[]).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [account, setAccount] = useState<NightlyAccount | null>(null);
  const [walletDetected, setWalletDetected] = useState(
    () => typeof window !== 'undefined' && Boolean(window.nightly?.solana),
  );
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'signing' | 'confirmed' | 'error'
  >('idle');
  const [message, setMessage] = useState(
    'Connect Nightly to make your first checkpoint.',
  );
  const [activity, setActivity] = useState<Checkpoint[]>(readStoredActivity);
  const [networkActivity, setNetworkActivity] = useState<
    { signature: string; blockTime?: number | null }[]
  >([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const connection = useMemo(() => new Connection(COOKIE_RPC, 'confirmed'), []);

  const refreshNetwork = useCallback(
    async (wallet: NightlyAccount) => {
      const publicKey = new PublicKey(wallet.address);
      const [lamports, currentSlot, signatures] = await Promise.all([
        connection.getBalance(publicKey, 'confirmed'),
        connection.getSlot('confirmed'),
        connection.getSignaturesForAddress(
          publicKey,
          { limit: 5 },
          'confirmed',
        ),
      ]);
      setBalance(lamports / LAMPORTS_PER_SOL);
      setSlot(currentSlot);
      setNetworkActivity(
        signatures.map((item) => ({
          signature: item.signature,
          blockTime: item.blockTime,
        })),
      );
    },
    [connection],
  );

  const streak = activity.length ? activity[0].streak : 0;
  const progress = Math.min((streak / 7) * 100, 100);

  async function connectWallet() {
    const nightly = window.nightly?.solana;
    if (!nightly) {
      setStatus('error');
      setMessage(
        'Nightly was not detected. Install the Nightly extension, then reload this page.',
      );
      return;
    }

    const connect = nightly.features['standard:connect']?.connect;
    if (!connect) {
      setStatus('error');
      setMessage(
        'This Nightly version does not expose the standard Solana connector yet.',
      );
      return;
    }

    setStatus('connecting');
    setMessage('Opening Nightly…');
    try {
      const targetGenesisHash = await connection.getGenesisHash();
      if (nightly.genesisHash !== targetGenesisHash && nightly.changeNetwork) {
        await nightly.changeNetwork({
          genesisHash: targetGenesisHash,
          url: COOKIE_RPC,
        });
      }

      const result = await connect({ silent: false });
      const connectedAccount = result.accounts[0];
      if (!connectedAccount)
        throw new Error('No account was returned by Nightly.');

      setAccount(connectedAccount);
      setWalletDetected(true);
      setStatus('idle');
      setMessage(
        'Wallet ready. Your next checkpoint will be written to Cookie Chain.',
      );
      refreshNetwork(connectedAccount).catch(() => undefined);
    } catch (error) {
      setStatus('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nightly connection was cancelled.',
      );
    }
  }

  async function disconnectWallet() {
    await window.nightly?.solana?.features['standard:disconnect']?.disconnect();
    setAccount(null);
    setStatus('idle');
    setMessage('Wallet disconnected.');
  }

  async function createCheckpoint() {
    if (!account) {
      await connectWallet();
      return;
    }

    const signTransaction =
      window.nightly?.solana?.features['standard:signTransaction']
        ?.signTransaction;
    if (!signTransaction) {
      setStatus('error');
      setMessage(
        'Nightly signing is unavailable. Update Nightly and try again.',
      );
      return;
    }

    setStatus('signing');
    setMessage(
      'Approve the checkpoint in Nightly. Only the network fee is charged.',
    );
    try {
      const publicKey = new PublicKey(account.address);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed');
      const nextStreak = streak + 1;
      const memo = JSON.stringify({
        app: COOKIE_CHECKPOINT_MEMO,
        action: 'check-in',
        streak: nextStreak,
        day: new Date().toISOString().slice(0, 10),
      });
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: publicKey,
          lamports: 0,
        }),
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(memo, 'utf8'),
        }),
      );
      transaction.feePayer = publicKey;
      transaction.recentBlockhash = blockhash;

      const [signed] = await signTransaction({
        account,
        transaction: transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
      });
      if (!signed?.signedTransaction)
        throw new Error('Nightly did not return a signed transaction.');

      const signature = await connection.sendRawTransaction(
        signed.signedTransaction,
        { preflightCommitment: 'confirmed' },
      );
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      );

      const newCheckpoint = {
        signature,
        createdAt: Date.now(),
        streak: nextStreak,
      };
      const nextActivity = [newCheckpoint, ...activity].slice(0, 8);
      setActivity(nextActivity);
      window.localStorage.setItem(
        ACTIVITY_STORAGE_KEY,
        JSON.stringify(nextActivity),
      );
      setStatus('confirmed');
      setMessage('Checkpoint confirmed. Your streak is now on-chain.');
      refreshNetwork(account).catch(() => undefined);
    } catch (error) {
      setStatus('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'The transaction was not completed.',
      );
    }
  }

  async function copyAddress() {
    if (!account) return;
    await navigator.clipboard.writeText(account.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const actionLabel = account ? 'Check in on Cookie Chain' : 'Connect Nightly';
  const isBusy = status === 'connecting' || status === 'signing';

  return (
    <main className="min-h-screen bg-[#f5f0e8] text-[#201913]">
      <div className="mx-auto max-w-[1440px] px-5 pb-12 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-[#d8cdbd] py-5">
          <div className="flex items-center gap-3">
            <div className="cookie-mark" aria-hidden="true">
              <Cookie className="size-5" strokeWidth={2.4} />
            </div>
            <div>
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-[#846f59]">
                Cookie Chain
              </p>
              <p className="font-mono text-sm font-semibold tracking-tight">
                CHECKPOINT
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-7 text-sm font-medium text-[#766653] md:flex">
            <a className="text-[#201913]" href="#check-in">
              Check in
            </a>
            <a href="#activity">Activity</a>
            <a href="#how-it-works">How it works</a>
            <a
              className="inline-flex items-center gap-1"
              href={COOKIE_EXPLORER}
              target="_blank"
              rel="noreferrer"
            >
              Explorer <ExternalLink className="size-3.5" />
            </a>
          </nav>

          <div className="flex items-center gap-2">
            {account ? (
              <Button
                className="border border-[#cbbda9] bg-[#fbf8f2] text-[#3d3023] hover:bg-white"
                onClick={copyAddress}
                variant="outline"
              >
                {copied ? <Check /> : <WalletMinimal />}
                {copied ? 'Copied' : shortAddress(account.address)}
              </Button>
            ) : (
              <Button
                className="bg-[#2e241c] text-[#fff9ed] shadow-[0_5px_0_#b5a38d] hover:bg-[#49382b]"
                onClick={connectWallet}
                disabled={isBusy}
              >
                {isBusy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <WalletMinimal />
                )}
                Connect Nightly
              </Button>
            )}
          </div>
        </header>

        <section className="grid gap-10 pb-12 pt-12 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-end lg:pt-20">
          <div className="max-w-3xl">
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <Badge className="border border-[#b8d7a0] bg-[#e8f2df] text-[#3f6d32]">
                <span className="live-dot" /> Live on Cookie Chain
              </Badge>
              <span className="text-sm text-[#897764]">
                A tiny action. A permanent signal.
              </span>
            </div>
            <h1 className="max-w-4xl text-[clamp(3rem,7vw,6.6rem)] font-semibold leading-[0.92] tracking-[-0.075em] text-[#2a2019]">
              Make your mark.
              <span className="block text-[#a96738]">Keep the streak.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[#6d5c4a]">
              Cookie Checkpoint turns a daily check-in into a verifiable Cookie
              Chain transaction. Connect Nightly, sign once, and leave a
              lightweight proof that you showed up.
            </p>
          </div>

          <div className="rounded-[26px] border border-[#d8cdbd] bg-[#eee6da] p-5 shadow-[0_16px_40px_rgb(67_45_24/7%)]">
            <div className="flex items-center justify-between border-b border-[#d8cdbd] pb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#493b2d]">
                <Radio className="size-4 text-[#7a9b50]" /> Network snapshot
              </div>
              <span className="font-mono text-xs text-[#917c64]">
                RPC / COOKIE
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-5">
              <div>
                <p className="metric-label">Latest slot</p>
                <p className="metric-value">
                  {slot ? slot.toLocaleString() : '—'}
                </p>
              </div>
              <div>
                <p className="metric-label">COOK balance</p>
                <p className="metric-value">
                  {balance === null ? '—' : balance.toFixed(4)}
                </p>
              </div>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-[#806e5b]">
              <LockKeyhole className="size-3.5 shrink-0" /> No custody. Nightly
              signs locally in your wallet.
            </p>
          </div>
        </section>

        <section
          id="check-in"
          className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]"
        >
          <Card className="overflow-visible rounded-[30px] border-0 bg-[#2d241d] text-[#fff8ea] shadow-[0_22px_0_#c6b49e]">
            <CardHeader className="gap-5 p-7 pb-0 sm:p-10 sm:pb-0">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="eyebrow text-[#c7b79f]">Your next checkpoint</p>
                  <CardTitle className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#fff8ea] sm:text-3xl">
                    One block. One signal.
                  </CardTitle>
                  <CardDescription className="mt-2 max-w-md text-[#c7b9a6]">
                    A zero-value self-transfer plus a readable memo makes your
                    check-in easy to verify in Cookiescan.
                  </CardDescription>
                </div>
                <div className="hidden rounded-full border border-[#665342] p-3 text-[#f0bd78] sm:block">
                  <Zap className="size-6" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-7 pt-7 sm:p-10 sm:pt-8">
              <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-5">
                  <div className="streak-dial">
                    <div className="streak-dial-inner">
                      <span className="font-mono text-4xl font-semibold">
                        {streak}
                      </span>
                      <span className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-[#bfae98]">
                        days
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-lg font-semibold">
                      {streak ? 'You are in motion.' : 'Start your streak.'}
                    </p>
                    <p className="mt-1 max-w-[230px] text-sm leading-6 text-[#c7b9a6]">
                      {streak
                        ? 'Come back tomorrow to make the signal stronger.'
                        : 'Your first check-in creates a public, verifiable proof of presence.'}
                    </p>
                  </div>
                </div>
                <div className="min-w-[220px] flex-1 sm:max-w-[290px]">
                  <div className="mb-2 flex justify-between text-xs font-semibold text-[#c7b9a6]">
                    <span>7-day rhythm</span>
                    <span>{streak}/7</span>
                  </div>
                  <Progress
                    value={progress}
                    className="gap-0 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-[#4b3c2f] [&_[data-slot=progress-indicator]]:bg-[#f0bd78]"
                  />
                  <p className="mt-3 text-xs text-[#a99782]">
                    Network fees are paid by your connected wallet.
                  </p>
                </div>
              </div>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  className="h-12 justify-center bg-[#f0bd78] px-5 text-[#2d241d] hover:bg-[#f7ca8d] sm:min-w-[230px]"
                  onClick={createCheckpoint}
                  disabled={isBusy}
                >
                  {status === 'signing' ? (
                    <LoaderCircle className="animate-spin" />
                  ) : status === 'confirmed' ? (
                    <Check />
                  ) : (
                    <Sparkles />
                  )}
                  {status === 'signing'
                    ? 'Waiting for Nightly'
                    : status === 'confirmed'
                      ? 'Checkpoint confirmed'
                      : actionLabel}
                </Button>
                {account && (
                  <Button
                    className="text-[#c7b9a6] hover:bg-[#403329] hover:text-[#fff8ea]"
                    onClick={disconnectWallet}
                    variant="ghost"
                  >
                    Disconnect
                  </Button>
                )}
              </div>

              <output
                className={`mt-5 flex items-start gap-2 rounded-xl border px-3 py-3 text-sm ${status === 'error' ? 'border-[#b86b5c]/50 bg-[#5b332d]/50 text-[#f2c2b8]' : status === 'confirmed' ? 'border-[#86ac68]/40 bg-[#415833]/50 text-[#d4edc1]' : 'border-[#665342] bg-[#3b3027] text-[#d4c4ae]'}`}
                aria-live="polite"
              >
                {status === 'error' ? (
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                ) : status === 'confirmed' ? (
                  <Check className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <CircleDashed className="mt-0.5 size-4 shrink-0" />
                )}
                <span>{message}</span>
              </output>
            </CardContent>
          </Card>

          <Card
            id="activity"
            className="rounded-[30px] border-[#d8cdbd] bg-[#fbf8f2] shadow-[0_16px_36px_rgb(67_45_24/6%)]"
          >
            <CardHeader className="p-7 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow text-[#a96738]">Activity</p>
                  <CardTitle className="mt-1 text-2xl tracking-[-0.04em]">
                    Your signal trail
                  </CardTitle>
                </div>
                <Activity className="size-5 text-[#a96738]" />
              </div>
              <CardDescription className="pt-1 text-[#806e5b]">
                Local streak history and recent network signatures.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-7 pt-3">
              <div className="space-y-3">
                {activity.length === 0 && networkActivity.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#d8cdbd] bg-[#f5f0e8] p-5 text-center">
                    <Cookie className="mx-auto size-6 text-[#b49d83]" />
                    <p className="mt-3 text-sm font-semibold text-[#5d4c3b]">
                      No checkpoints yet
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#8b7964]">
                      Connect Nightly and make the first one.
                    </p>
                  </div>
                ) : (
                  <>
                    {activity.slice(0, 4).map((item) => (
                      <a
                        key={item.signature}
                        className="activity-row"
                        href={`${COOKIE_EXPLORER}/tx/${item.signature}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="activity-icon">
                          <Check className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-[#45372a]">
                            Checkpoint #{item.streak}
                          </span>
                          <span className="block text-xs text-[#917d66]">
                            {formatTime(item.createdAt)} · confirmed
                          </span>
                        </span>
                        <ArrowUpRight className="size-4 text-[#ae9679]" />
                      </a>
                    ))}
                    {activity.length === 0 &&
                      networkActivity.slice(0, 3).map((item) => (
                        <a
                          key={item.signature}
                          className="activity-row"
                          href={`${COOKIE_EXPLORER}/tx/${item.signature}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="activity-icon">
                            <Radio className="size-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-[#45372a]">
                              Network transaction
                            </span>
                            <span className="block truncate text-xs text-[#917d66]">
                              {shortAddress(item.signature)}
                            </span>
                          </span>
                          <ArrowUpRight className="size-4 text-[#ae9679]" />
                        </a>
                      ))}
                  </>
                )}
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-[#e2d8ca] pt-5">
                <span className="text-xs text-[#917d66]">
                  {walletDetected ? 'Nightly detected' : 'Wallet not detected'}
                </span>
                <Button
                  className="h-7 gap-1 px-2 text-xs text-[#6c563f]"
                  variant="ghost"
                  onClick={() => account && refreshNetwork(account)}
                >
                  <RefreshCw className="size-3.5" /> Refresh
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section
          id="how-it-works"
          className="grid gap-5 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:items-start"
        >
          <div>
            <p className="eyebrow text-[#a96738]">How it works</p>
            <h2 className="mt-3 max-w-md text-4xl font-semibold leading-tight tracking-[-0.06em] text-[#2e241c]">
              A little ritual for a chain that moves fast.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [
                '01',
                'Connect',
                'Nightly gives the app a public address without sharing custody.',
              ],
              [
                '02',
                'Check in',
                'A signed memo transaction records your checkpoint on Cookie Chain.',
              ],
              [
                '03',
                'Keep going',
                'Your local trail links back to Cookiescan for verification.',
              ],
            ].map(([number, title, copy]) => (
              <div
                key={number}
                className="rounded-2xl border border-[#d8cdbd] bg-[#eee6da] p-5"
              >
                <span className="font-mono text-xs font-bold text-[#b4875f]">
                  {number}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-[#45372a]">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#806e5b]">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-col gap-4 border-t border-[#d8cdbd] pt-6 text-xs text-[#8d7963] sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <Cookie className="size-3.5" /> Open source experiment for Cookie
            Chain.
          </span>
          <span className="inline-flex items-center gap-2">
            <Clipboard className="size-3.5" /> RPC: rpc.cookiescan.io
          </span>
        </footer>
      </div>
    </main>
  );
}
