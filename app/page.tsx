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
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  const [walletDetected, setWalletDetected] = useState(false);
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

  const detectWallet = useCallback(() => {
    const detected =
      typeof window !== 'undefined' && Boolean(window.nightly?.solana);
    setWalletDetected(detected);
    return detected;
  }, []);

  useEffect(() => {
    let attempts = 0;
    const check = () => {
      attempts += 1;
      if (detectWallet() || attempts >= 24) window.clearInterval(timer);
    };
    const timer = window.setInterval(check, 250);
    const handleFocus = () => detectWallet();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') detectWallet();
    };

    check();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [detectWallet]);

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

  function checkWallet() {
    if (detectWallet()) {
      setStatus('idle');
      setMessage('Nightly detected. Connect when you are ready.');
      return;
    }

    setStatus('error');
    setMessage(
      'Nightly is still unavailable. Enable this site in the extension, then reload.',
    );
  }

  async function connectWallet() {
    const nightly = window.nightly?.solana;
    setWalletDetected(Boolean(nightly));
    if (!nightly) {
      setStatus('error');
      setMessage(
        'Nightly was not detected. Enable this site in the extension, then reload.',
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
      let networkSwitchFailed = false;
      if (nightly.genesisHash !== targetGenesisHash) {
        if (!nightly.changeNetwork) {
          networkSwitchFailed = true;
        } else {
          try {
            await nightly.changeNetwork({
              genesisHash: targetGenesisHash,
              url: COOKIE_RPC,
            });
          } catch {
            networkSwitchFailed = true;
          }
        }
      }

      const result = await connect({ silent: false });
      const connectedAccount = result.accounts[0];
      if (!connectedAccount)
        throw new Error('No account was returned by Nightly.');

      setAccount(connectedAccount);
      setWalletDetected(true);
      if (networkSwitchFailed) {
        setStatus('error');
        setMessage(
          'Nightly connected, but could not switch automatically. Select Cookie Chain in Nightly, then try again.',
        );
      } else {
        setStatus('idle');
        setMessage(
          'Wallet ready. Your next checkpoint will be written to Cookie Chain.',
        );
      }
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

    const nightly = window.nightly?.solana;
    const signTransaction =
      nightly?.features['standard:signTransaction']?.signTransaction;
    if (!nightly || !signTransaction) {
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
      const targetGenesisHash = await connection.getGenesisHash();
      if (nightly.genesisHash && nightly.genesisHash !== targetGenesisHash) {
        setStatus('error');
        setMessage(
          'Nightly is connected to another network. Select Cookie Chain in Nightly, then try again.',
        );
        return;
      }

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
    <main className="min-h-screen bg-[#f7f8f3] text-[#131b2b]">
      <div className="mx-auto max-w-[1600px] px-5 pb-12 sm:px-10 lg:px-16">
        <header className="site-header flex items-center justify-between border-b border-[#d6dee8] py-5">
          <div className="flex items-center gap-3">
            <div className="cookie-mark" aria-hidden="true">
              <Cookie className="size-5" strokeWidth={2.4} />
            </div>
            <div>
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-[#53647d]">
                Cookie Chain
              </p>
              <p className="font-mono text-sm font-semibold tracking-tight">
                CHECKPOINT
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-7 text-sm font-medium text-[#5d6b80] md:flex">
            <a className="text-[#131b2b]" href="#check-in">
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
                className="border border-[#cbd4e0] bg-white text-[#1e2d4d] hover:bg-[#f3f6fa]"
                onClick={copyAddress}
                variant="outline"
              >
                {copied ? <Check /> : <WalletMinimal />}
                {copied ? 'Copied' : shortAddress(account.address)}
              </Button>
            ) : (
              <Button
                className="bg-[#101a36] text-[#f8fbff] shadow-[0_5px_0_#c9d2df] hover:bg-[#203dc2]"
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

        <section className="zoomed-section webflow-hero grid gap-10 pb-16 pt-16 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-end lg:pb-24 lg:pt-28">
          <div className="max-w-5xl">
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <Badge className="h-7 border border-[#86d0ad] bg-[#d9f4e6] px-3 font-semibold text-[#176443] shadow-[0_3px_0_#b9dfca]">
                <span className="live-dot" /> Live on Cookie Chain
              </Badge>
              <span className="text-sm font-semibold text-[#335cff]">
                A tiny action. A permanent signal.
              </span>
            </div>
            <h1 className="webflow-display max-w-6xl text-[clamp(3.5rem,8vw,8.5rem)] font-semibold leading-[0.9] tracking-[-0.085em] text-[#0e1931]">
              Make your mark.
              <span className="block text-[#335cff]">Keep the streak.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-[#52627a]">
              Cookie Checkpoint turns a daily check-in into a verifiable Cookie
              Chain transaction. Connect Nightly, sign once, and leave a
              lightweight proof that you showed up.
            </p>
          </div>

          <div className="snapshot-card rounded-[24px] border border-[#d6dee8] bg-white p-5 shadow-[0_20px_50px_rgb(20_35_65/8%)]">
            <div className="flex items-center justify-between border-b border-[#e1e7ee] pb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#24324a]">
                <Radio className="size-4 text-[#3f8c68]" /> Network snapshot
              </div>
              <span className="font-mono text-xs text-[#738099]">
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
            <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-[#617083]">
              <LockKeyhole className="size-3.5 shrink-0" /> No custody. Nightly
              signs locally in your wallet.
            </p>
          </div>
        </section>

        <section
          id="check-in"
          className="zoomed-section grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]"
        >
          <Card className="checkin-card overflow-visible rounded-[24px] border-0 bg-[#101a36] text-[#f8fbff] shadow-[0_22px_0_#c9d2df]">
            <CardHeader className="gap-5 p-7 pb-0 sm:p-10 sm:pb-0">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="eyebrow text-[#aab8cf]">Your next checkpoint</p>
                  <CardTitle className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#f8fbff] sm:text-3xl">
                    One block. One signal.
                  </CardTitle>
                  <CardDescription className="mt-2 max-w-md text-[#b6c2d3]">
                    A zero-value self-transfer plus a readable memo makes your
                    check-in easy to verify in Cookiescan.
                  </CardDescription>
                </div>
                <div className="hidden rounded-full border border-[#445579] p-3 text-[#f4c95d] sm:block">
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
                      <span className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-[#aab5c7]">
                        days
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-lg font-semibold">
                      {streak ? 'You are in motion.' : 'Start your streak.'}
                    </p>
                    <p className="mt-1 max-w-[230px] text-sm leading-6 text-[#b6c2d3]">
                      {streak
                        ? 'Come back tomorrow to make the signal stronger.'
                        : 'Your first check-in creates a public, verifiable proof of presence.'}
                    </p>
                  </div>
                </div>
                <div className="min-w-[220px] flex-1 sm:max-w-[290px]">
                  <div className="mb-2 flex justify-between text-xs font-semibold text-[#b6c2d3]">
                    <span>7-day rhythm</span>
                    <span>{streak}/7</span>
                  </div>
                  <Progress
                    value={progress}
                    className="gap-0 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-[#324266] [&_[data-slot=progress-indicator]]:bg-[#f4c95d]"
                  />
                  <p className="mt-3 text-xs text-[#9da8b9]">
                    Network fees are paid by your connected wallet.
                  </p>
                </div>
              </div>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  className="h-12 justify-center bg-[#f4c95d] px-5 text-[#101a36] hover:bg-[#f7d77b] sm:min-w-[230px]"
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
                    className="text-[#b6c2d3] hover:bg-[#263660] hover:text-[#f8fbff]"
                    onClick={disconnectWallet}
                    variant="ghost"
                  >
                    Disconnect
                  </Button>
                )}
              </div>

              <output
                className={`mt-5 flex items-start gap-2 rounded-xl border px-3 py-3 text-sm ${status === 'error' ? 'border-[#d67e73]/50 bg-[#542a35]/50 text-[#f4b3ab]' : status === 'confirmed' ? 'border-[#82c9a9]/40 bg-[#234838]/50 text-[#d0f0df]' : 'border-[#445579] bg-[#1d2b4d] text-[#c1ccdc]'}`}
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
            className="activity-card rounded-[24px] border-[#d6dee8] bg-white shadow-[0_20px_50px_rgb(20_35_65/7%)]"
          >
            <CardHeader className="p-7 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow text-[#335cff]">Activity</p>
                  <CardTitle className="mt-1 text-2xl tracking-[-0.04em]">
                    Your signal trail
                  </CardTitle>
                </div>
                <Activity className="size-5 text-[#335cff]" />
              </div>
              <CardDescription className="pt-1 text-[#617083]">
                Local streak history and recent network signatures.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-7 pt-3">
              <div className="space-y-3">
                {activity.length === 0 && networkActivity.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#d6dee8] bg-[#f7f8f3] p-5 text-center">
                    <Cookie className="mx-auto size-6 text-[#8b98ab]" />
                    <p className="mt-3 text-sm font-semibold text-[#52627a]">
                      No checkpoints yet
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#758399]">
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
                          <span className="block text-sm font-semibold text-[#24324a]">
                            Checkpoint #{item.streak}
                          </span>
                          <span className="block text-xs text-[#738099]">
                            {formatTime(item.createdAt)} · confirmed
                          </span>
                        </span>
                        <ArrowUpRight className="size-4 text-[#7a90e8]" />
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
                            <span className="block text-sm font-semibold text-[#24324a]">
                              Network transaction
                            </span>
                            <span className="block truncate text-xs text-[#738099]">
                              {shortAddress(item.signature)}
                            </span>
                          </span>
                          <ArrowUpRight className="size-4 text-[#7a90e8]" />
                        </a>
                      ))}
                  </>
                )}
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-[#e1e7ee] pt-5">
                <span className="text-xs text-[#738099]">
                  {walletDetected ? 'Nightly detected' : 'Wallet not detected'}
                </span>
                <Button
                  className="h-8 gap-1 px-2 text-xs font-semibold text-[#335cff]"
                  variant="ghost"
                  onClick={() =>
                    account ? refreshNetwork(account) : checkWallet()
                  }
                >
                  <RefreshCw className="size-3.5" />
                  {account ? 'Refresh' : 'Check wallet'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section
          id="how-it-works"
          className="zoomed-section grid gap-5 py-24 lg:grid-cols-[0.8fr_1.2fr] lg:items-start"
        >
          <div>
            <p className="eyebrow text-[#335cff]">How it works</p>
            <h2 className="mt-3 max-w-lg text-5xl font-semibold leading-[0.95] tracking-[-0.07em] text-[#101a36] sm:text-6xl">
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
                className="workflow-card rounded-[20px] border border-[#d6dee8] bg-white p-6"
              >
                <span className="font-mono text-xs font-bold text-[#7a90e8]">
                  {number}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-[#24324a]">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#617083]">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="webflow-footer mt-10 overflow-hidden rounded-[28px] bg-[#101a36] text-[#f8fbff]">
          <div className="grid gap-12 px-7 py-10 sm:px-10 sm:py-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-14 lg:py-16">
            <div className="max-w-md">
              <div className="flex items-center gap-3">
                <div className="cookie-mark footer-mark" aria-hidden="true">
                  <Cookie className="size-5" strokeWidth={2.4} />
                </div>
                <div>
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-[#9da8b9]">
                    Cookie Chain
                  </p>
                  <p className="font-mono text-sm font-semibold tracking-tight text-[#f8fbff]">
                    CHECKPOINT
                  </p>
                </div>
              </div>
              <p className="mt-8 max-w-sm text-[clamp(2rem,4vw,4rem)] font-semibold leading-[0.95] tracking-[-0.07em]">
                Leave a signal.
              </p>
              <p className="mt-5 max-w-sm text-sm leading-6 text-[#b6c2d3]">
                A small open-source ritual for wallets, builders, and the chain
                that moves fast.
              </p>
            </div>

            <div>
              <p className="footer-label">Explore</p>
              <div className="mt-5 grid gap-3 text-sm text-[#d5deea]">
                <a className="footer-link" href="#check-in">
                  Check in
                </a>
                <a className="footer-link" href="#activity">
                  Activity
                </a>
                <a className="footer-link" href="#how-it-works">
                  How it works
                </a>
                <a
                  className="footer-link"
                  href={COOKIE_EXPLORER}
                  target="_blank"
                  rel="noreferrer"
                >
                  Cookiescan <ExternalLink className="size-3.5" />
                </a>
              </div>
            </div>

            <div>
              <p className="footer-label">Build</p>
              <div className="mt-5 grid gap-3 text-sm text-[#d5deea]">
                <a
                  className="footer-link"
                  href="https://docs.cookiechain.wtf/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Cookie docs <ExternalLink className="size-3.5" />
                </a>
                <a
                  className="footer-link"
                  href="https://docs.cookiechain.wtf/developer-guide"
                  target="_blank"
                  rel="noreferrer"
                >
                  Developer guide <ExternalLink className="size-3.5" />
                </a>
                <a
                  className="footer-link"
                  href="https://docs.nightly.app/docs/solana/solana/connect/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Nightly docs <ExternalLink className="size-3.5" />
                </a>
                <a
                  className="footer-link"
                  href="https://github.com/phcodesage/cookie-checkpoint"
                  target="_blank"
                  rel="noreferrer"
                >
                  Source code <ExternalLink className="size-3.5" />
                </a>
              </div>
            </div>

            <div>
              <p className="footer-label">Network</p>
              <div className="mt-5 space-y-4 text-sm text-[#d5deea]">
                <p className="flex items-start gap-2">
                  <Radio className="mt-0.5 size-4 text-[#f4c95d]" /> Cookie
                  Chain RPC
                  <br />
                  <span className="font-mono text-xs text-[#9da8b9]">
                    rpc.cookiescan.io
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <LockKeyhole className="mt-0.5 size-4 text-[#82c9a9]" />{' '}
                  Non-custodial by design
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#2b3a5d] px-7 py-5 text-xs text-[#9da8b9] sm:flex-row sm:items-center sm:justify-between sm:px-14">
            <span className="inline-flex items-center gap-2">
              <Clipboard className="size-3.5" /> Open-source experiment for
              Cookie Chain.
            </span>
            <span>Built for the Cookie Chain cApp bounty.</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
