import './App.css';
import { useWalletClient, useConnect, useDisconnect, useAccount, useSwitchChain } from "wagmi";
import { injected } from 'wagmi/connectors';
import { useEffect, useState } from "react";
import { createFangornMiddleware } from "x402f";
import { FangornConfig } from 'fangorn-sdk/lib/config';
import { arbitrumSepolia } from 'viem/chains';

const FANGORN_CONFIG = {
    pinataJwt: import.meta.env.VITE_PINATA_JWT,
    pinataGateway: import.meta.env.VITE_PINATA_GATEWAY,
    domain: window.location.host,
};

const owner = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6";
const datasourceName = "demo";
const tag = "helloFangorn.txt";

function useFangornMiddleware() {
    const { data: walletClient } = useWalletClient();

    const [middleware, setMiddleware] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!walletClient) {
            setMiddleware(null);
            return;
        }

        setIsLoading(true);
        setError(null);
        createFangornMiddleware(
            walletClient,
            FangornConfig.ArbitrumSepolia,
            "localhost:5173",
            FANGORN_CONFIG.pinataJwt,
            FANGORN_CONFIG.pinataGateway
        ).then(setMiddleware)
            .catch(setError)
            .finally(() => setIsLoading(false));
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
        <div>
            <span>{address}</span>
            <button onClick={() => disconnect()}>Disconnect</button>
        </div>
    );

    return (
        <button onClick={() => connect({ connector: injected() })}>
            Connect Wallet
        </button>
    );
}
function PaywallContent({ owner, datasourceName, tag }) {
    const { middleware, isLoading: middlewareLoading } = useFangornMiddleware();
    const [content, setContent] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleUnlock = async () => {
        if (!middleware) return;
        setIsLoading(true);

        const result = await middleware.fetchResource({
            owner,
            datasourceName,
            tag,
            baseUrl: 'http://localhost:4021'
        });
        if (result.success) {
            setContent(atob(result.dataString) ?? null);
        } else {
            console.error(result.error);
        }
        setIsLoading(false);
    };

    if (middlewareLoading) return <div>Initializing...</div>;
    if (!middleware) return <div>Connect wallet to continue</div>;

    return (
        <div>
            {content ? (
                <pre>{content}</pre>
            ) : (
                <button onClick={handleUnlock} disabled={isLoading}>
                    {isLoading ? "Unlocking..." : "Pay & Unlock"}
                </button>
            )}
        </div>
    );
}

function App() {
    return (
        <div className="App">
            <ConnectWallet />
            <PaywallContent owner={owner} datasourceName={datasourceName} tag={tag} />
        </div>
    );
}

export default App;