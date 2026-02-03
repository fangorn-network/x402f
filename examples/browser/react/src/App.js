import './App.css';
import { useWalletClient } from "wagmi";
import { useEffect, useState } from "react";
// import { createFangornMiddleware, FangornX402Middleware } from "x402f";
// import { FangornX402Middleware, createFangornMiddleware } from "x402f";
import { FangornX402Middleware, createFangornMiddleware } from "x402f";
// import { Hex } from "viem";

const FANGORN_CONFIG = {
    appConfig: {
        rpcUrl: process.env.REACT_APP_CHAIN_RPC_URL,
        litActionCid: process.env.REACT_APP__LIT_ACTION_CID,
        contentRegistryContractAddress: process.env.REACT_APP_CONTENT_REGISTRY_ADDR,
        usdcContractAddress: process.env.REACT_APP_USDC_CONTRACT_ADDR,
        chainName: "baseSepolia",
    },
    pinataJwt: process.env.REACT_APP_PINATA_JWT,
    pinataGateway: process.env.REACT_APP_PINATA_GATEWAY,
    domain: window.location.host,
};

function useFangornMiddleware() {
    const { data: walletClient } = useWalletClient();
    const [middleware, setMiddleware] = useState<FangornX402Middleware | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!walletClient) {
            setMiddleware(null);
            return;
        }

        setIsLoading(true);
        setError(null);

        createFangornMiddleware(walletClient, FANGORN_CONFIG)
            .then(setMiddleware)
            .catch(setError)
            .finally(() => setIsLoading(false));
    }, [walletClient]);

    return { middleware, isLoading, error };
}

// Usage in component:
function PaywallContent(vaultId, tag) {
    console.log(vaultId);
    const { middleware, isLoading: middlewareLoading } = useFangornMiddleware();
    const [content, setContent] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleUnlock = async () => {
        if (!middleware) return;
        
        setIsLoading(true);
        const result = await middleware.fetchResource({ vaultId, tag });
        
        if (result.success) {
            setContent(result.dataString ?? null);
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

const vaultId = "0x32d2132278f4c895b8985d90ca8e5a92feb7e9136933a50f2281dc1bc27e9231";
const tag = "helloFangorn.txt";

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <p>
            x402f React Demo
        </p>
      </header>
      <body>
        <PaywallContent vaultId tag />
      </body>
    </div>
  );
}

export default App;
