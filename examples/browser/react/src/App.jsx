import './App.css';
import { useWalletClient, useConnect, useDisconnect, useAccount, useSwitchChain } from "wagmi";
import { injected } from 'wagmi/connectors';
import { useEffect, useState } from "react";
import { arbitrumSepolia } from 'viem/chains';
import { FangornConfig } from 'fangorn-sdk';
import { createFangornMiddleware } from "../../../../packages/fetch/src/middleware.js";
// import { createFangornMiddleware } from "@x402f/fetch";

const FANGORN_CONFIG = {
    pinataJwt: import.meta.env.VITE_PINATA_JWT,
    pinataGateway: import.meta.env.VITE_PINATA_GATEWAY,
    domain: window.location.host,
};

function parseResourceUrl(url) {
    try {
        const parsed = new URL(url);
        const params = parsed.searchParams;
        return {
            baseUrl: parsed.origin,
            owner: params.get('owner') || '',
            datasourceName: params.get('name') || '',
            tag: params.get('tag') || '',
        };
    } catch {
        return null;
    }
}

function useFangornMiddleware() {
    const { data: walletClient } = useWalletClient();
    const [middleware, setMiddleware] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!walletClient) { setMiddleware(null); return; }
        setIsLoading(true);
        setError(null);
        createFangornMiddleware(
            walletClient,
            FangornConfig.ArbitrumSepolia,
            "localhost:5173",
            FANGORN_CONFIG.pinataJwt,
            FANGORN_CONFIG.pinataGateway
        ).then(setMiddleware).catch(setError).finally(() => setIsLoading(false));
    }, [walletClient]);

    return { middleware, isLoading, error };
}

function ConnectWallet() {
    const { connect } = useConnect();
    const { disconnect } = useDisconnect();
    const { address, isConnected, chainId } = useAccount();
    const { switchChain } = useSwitchChain();

    useEffect(() => {
        if (isConnected && chainId !== arbitrumSepolia.id) {
            switchChain({ chainId: arbitrumSepolia.id });
        }
    }, [isConnected, chainId]);

    if (isConnected) return (
        <div className="wallet-connected">
            <span className="wallet-address">{address.slice(0, 6)}...{address.slice(-4)}</span>
            <button onClick={() => disconnect()}>Disconnect</button>
        </div>
    );
    return <button onClick={() => connect({ connector: injected() })}>Connect Wallet</button>;
}

function ResourceForm({ onSubmit }) {
    const [url, setUrl] = useState('');
    const [baseUrl, setBaseUrl] = useState('https://server-133282782456.us-central1.run.app');
    const [owner, setOwner] = useState('');
    const [datasourceName, setDatasourceName] = useState('');
    const [tag, setTag] = useState('');

    const handleUrlChange = (e) => {
        const val = e.target.value;
        setUrl(val);
        const parsed = parseResourceUrl(val);
        if (parsed) {
            if (parsed.baseUrl) setBaseUrl(parsed.baseUrl);
            if (parsed.owner) setOwner(parsed.owner);
            if (parsed.datasourceName) setDatasourceName(parsed.datasourceName);
            if (parsed.tag) setTag(parsed.tag);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!owner || !datasourceName || !tag) return;
        onSubmit({ owner, datasourceName, tag, baseUrl });
    };

    return (
        <form onSubmit={handleSubmit} className="resource-form">
            <div className="form-group">
                <label>Resource URL <span className="hint">(paste to auto-fill)</span></label>
                <input type="text" value={url} onChange={handleUrlChange}
                    placeholder="http://localhost:4021/?owner=0x...&name=demo&tag=file.txt" />
            </div>
            <div className="form-divider">or enter manually</div>
            <div className="form-group">
                <label>Base URL</label>
                <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:4021" />
            </div>
            <div className="form-group">
                <label>Owner</label>
                <input type="text" value={owner} onChange={e => setOwner(e.target.value)} placeholder="0x..." />
            </div>
            <div className="form-group">
                <label>Datasource Name</label>
                <input type="text" value={datasourceName} onChange={e => setDatasourceName(e.target.value)} placeholder="demo" />
            </div>
            <div className="form-group">
                <label>Tag</label>
                <input type="text" value={tag} onChange={e => setTag(e.target.value)} placeholder="helloFangorn.txt" />
            </div>
            <button type="submit" disabled={!owner || !datasourceName || !tag}>
                Load Resource
            </button>
        </form>
    );
}

function PaywallContent({ resource, onReset }) {
    const { middleware, isLoading: middlewareLoading } = useFangornMiddleware();
    const [content, setContent] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleUnlock = async () => {
        if (!middleware) return;
        setIsLoading(true);
        setError(null);
        const result = await middleware.fetchResource({
            owner: resource.owner,
            datasourceName: resource.datasourceName,
            tag: resource.tag,
            baseUrl: resource.baseUrl,
        });

        if (result.success) {
            setContent(atob(result.dataString));
        } else {
            setError(result.error ?? 'Unknown error');
        }
        setIsLoading(false);
    };

    if (middlewareLoading) return <div className="status">Initializing...</div>;
    if (!middleware) return <div className="status">Connect your wallet to continue.</div>;

    return (
        <div className="paywall">
            <div className="resource-meta">
                <span><strong>Owner:</strong> {resource.owner.slice(0, 6)}...{resource.owner.slice(-4)}</span>
                <span><strong>Source:</strong> {resource.datasourceName}</span>
                <span><strong>Tag:</strong> {resource.tag}</span>
                <button className="reset" onClick={onReset}>← Change</button>
            </div>
            {error && <div className="error">{error}</div>}
            {content
                ? <pre className="content">{content}</pre>
                : <button onClick={handleUnlock} disabled={isLoading}>
                    {isLoading ? "Unlocking..." : "Pay & Unlock"}
                  </button>
            }
        </div>
    );
}

function App() {
    const { isConnected } = useAccount();
    const [resource, setResource] = useState(null);

    return (
        <div className="App">
            <header>
                <h1>Fangorn</h1>
                <ConnectWallet />
            </header>
            <main>
                {!resource
                    ? <ResourceForm onSubmit={setResource} />
                    : isConnected
                        ? <PaywallContent resource={resource} onReset={() => setResource(null)} />
                        : <div className="status">Connect your wallet to unlock this resource.</div>
                }
            </main>
        </div>
    );
}

export default App;