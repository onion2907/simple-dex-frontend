import React, { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers";
import cfg from "./config.json";

const SimpleDEXABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function getAmountOut(address tokenIn, uint256 amountIn) view returns (uint256)",
  "function swapExactInput(address tokenIn, uint256 amountIn, uint256 minOut, address to) returns (uint256)"
];

const ERC20ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)"
];

export default function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [status, setStatus] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [tokenIn, setTokenIn] = useState("token0");
  const [quote, setQuote] = useState("");
  const [reserves, setReserves] = useState({ r0: "...", r1: "..." });

  const amm = useMemo(() => {
    if (!provider) return null;
    return new Contract(cfg.ammAddress, SimpleDEXABI, provider);
  }, [provider]);

  useEffect(() => {
    if (!window.ethereum) return;
    const prov = new BrowserProvider(window.ethereum);
    setProvider(prov);
  }, []);

  async function connect() {
    try {
      if (!provider) return;
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== Number(cfg.chainId)) {
        setStatus(`Wrong network. Please switch to chainId ${cfg.chainId}.`);
        return;
      }
      const s = await provider.getSigner();
      setSigner(s);
      const addr = await s.getAddress();
      setAccount(addr);
      setStatus("Connected.");
      await refresh();
    } catch (e) {
      setStatus(`Connect error: ${e.message}`);
    }
  }

  async function refresh() {
    if (!amm) return;
    const r0 = await amm.reserve0();
    const r1 = await amm.reserve1();
    setReserves({ r0: r0.toString(), r1: r1.toString() });
    if (amountIn) await fetchQuote(amountIn, tokenIn);
  }

  async function ensureAllowance() {
    if (!signer) throw new Error("Connect wallet first");
    const inAddr = tokenIn === "token0" ? cfg.token0 : cfg.token1;
    const erc = new Contract(inAddr, ERC20ABI, signer);
    const bal = await erc.balanceOf(await signer.getAddress());
    const amt = parseUnits(amountIn || "0", cfg.decimals);
    if (bal < amt) throw new Error("Insufficient token balance");
    const allowance = await erc.allowance(await signer.getAddress(), cfg.ammAddress);
    if (allowance < amt) {
      const tx = await erc.approve(cfg.ammAddress, amt);
      setStatus("Approving allowance...");
      await tx.wait();
    }
  }

  async function fetchQuote(v, which) {
    try {
      if (!amm) return;
      const inAddr = which === "token0" ? cfg.token0 : cfg.token1;
      const amt = parseUnits(v || "0", cfg.decimals);
      if (amt === 0n) {
        setQuote("");
        return;
      }
      const out = await amm.getAmountOut(inAddr, amt);
      setQuote(formatUnits(out, cfg.decimals));
    } catch (e) {
      setQuote("");
    }
  }

  async function doSwap() {
    try {
      if (!signer || !amm) throw new Error("Connect wallet first");
      await ensureAllowance();

      const inAddr = tokenIn === "token0" ? cfg.token0 : cfg.token1;
      const amt = parseUnits(amountIn, cfg.decimals);
      const minOut = 0n; // demo only; add slippage control for production
      const ammWithSigner = amm.connect(signer);
      setStatus("Sending swap...");
      const tx = await ammWithSigner.swapExactInput(inAddr, amt, minOut, await signer.getAddress());
      const receipt = await tx.wait();
      setStatus(`Swap confirmed in block ${receipt.blockNumber}`);
      await refresh();
    } catch (e) {
      setStatus(`Swap failed: ${e.message}`);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: "40px auto", padding: 24, border: "1px solid #ddd", borderRadius: 12, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h2>Simple DEX (Testnet)</h2>
      <p><strong>AMM:</strong> {cfg.ammAddress}</p>
      <p><strong>Reserves:</strong> {reserves.r0} {cfg.token0Symbol} | {reserves.r1} {cfg.token1Symbol}</p>

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <button onClick={connect}>{account ? "Connected" : "Connect Wallet"}</button>
        <button onClick={refresh}>Refresh</button>
      </div>

      <div style={{ marginTop: 24 }}>
        <label style={{ display: "block", marginBottom: 8 }}>Token In</label>
        <select value={tokenIn} onChange={(e) => { setTokenIn(e.target.value); fetchQuote(amountIn, e.target.value); }}>
          <option value="token0">{cfg.token0Symbol} → {cfg.token1Symbol}</option>
          <option value="token1">{cfg.token1Symbol} → {cfg.token0Symbol}</option>
        </select>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 8 }}>Amount In</label>
        <input
          type="number"
          min="0"
          step="0.0001"
          value={amountIn}
          onChange={(e) => { setAmountIn(e.target.value); fetchQuote(e.target.value, tokenIn); }}
          placeholder="0.0"
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 8 }}>Estimated Out</label>
        <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
          {quote ? quote : "-"}
        </div>
      </div>

      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <button onClick={doSwap} disabled={!account || !amountIn}>Swap</button>
      </div>

      <p style={{ marginTop: 12, fontSize: 12, color: "#555" }}>
        Note: Demo AMM with 0.30% fee and no LP tokens/withdraw. Testnet only.
      </p>
    </div>
  );
}
