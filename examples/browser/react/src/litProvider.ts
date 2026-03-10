import { createAuthManager, GoogleAuthenticator, storagePlugins, WalletClientAuthenticator } from "@lit-protocol/auth";
import { createLitClient, NagaLitClient } from "@lit-protocol/lit-client";
import { nagaDev } from "@lit-protocol/networks";
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { RpcError } from "viem";
import { Chain, http } from "viem";
import { useConnect, useConnectors, useWalletClient } from "wagmi";

interface LitContextType {
  litClient: NagaLitClient | null;
  authManager: any | null;
  viemWalletClient: any | null;
  authData: any | null;
  authContext: any | null;
  initialized: boolean;
  authMethod: AuthMethod;
}

const LitContext = createContext<LitContextType>({
  litClient: null,
  authManager: null,
  viemWalletClient: null,
  authData: null,
  authContext: null,
  initialized: true,
  authMethod: 'none',
});

const viemChainConfig: Readonly<Chain> = Object.freeze({
  id: 175188,
  name: "Chronicle Yellowstone",
  nativeCurrency: {
    name: "Chronicle Yellowstone",
    symbol: "tstLPX",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://yellowstone-rpc.litprotocol.com/"],
    },
    public: {
      http: ["https://yellowstone-rpc.litprotocol.com/"],
    },
  },
  blockExplorers: {
    default: {
      name: "Yellowstone Explorer",
      url: "https://yellowstone-explorer.litprotocol.com/",
    },
  },
});

type AuthMethod = 'none' | 'wallet' | 'sso';

export function LitProvider({ children }: { children: ReactNode }) {
    const [hasMounted, setHasMounted] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const [pendingWalletAuth, setPendingWalletAuth] = useState(false);
    const [isChoosingPkp, setIsChoosingPkp] = useState(false);
    const [pkpList, setPkpList] = useState<any | null>(null);
    const [viemWalletClient, setViemWalletClient] = useState<any | null>(null);

    const [ssoLoading, setSsoLoading] = useState(false);
    const [ssoError, setSsoError] = useState<string | null>(null);

    const [authMethod, setAuthMethod] = useState<AuthMethod>('none');
    const [litClient, setlitClient] = useState<NagaLitClient | null>(null);
    // idk if this is needed since we will use PKP creds
    const [authManager, setAuthManager] = useState<any | null>(null);
    //
    const [authContext, setAuthContext] = useState(null);
    const [authData, setAuthData] = useState<any | null>(null)

    const didUserReject = useRef(false);

    const { mutate: connect, status: connectStatus, error } = useConnect();
    const { data: walletClient } = useWalletClient()
    const connectors = useConnectors();
    // Filter wallet connectors (exclude any SSO-related ones if you add them to wagmi)
    const walletConnectors = connectors.filter((c) => 
      c.id !== 'google' && c.id !== 'apple'
    );

    useEffect(() => {
        if (error) {
          console.log('received error', error);
          const isRejection =
            error.name === 'UserRejectedRequestError' ||
            (error as RpcError).code === 4001;
          if (isRejection) {
            didUserReject.current = true;
            setAuthMethod('none');
          }
        }
    }, [error]);

    useEffect(() => {
    
    if (!hasMounted) {
          setHasMounted(true);
          const authManager = createAuthManager({
            storage: storagePlugins.localStorage({
              appName: "my-app",
              networkName: "naga-dev",
            }),
          });
          setAuthManager(authManager);
        }
    }, [hasMounted]);

    // effect for authenticating user when they choose a wallet to connect to
    useEffect(() => {
      const authenticateWallet = async () => {
        if (!walletClient || !pendingWalletAuth) {
            console.log('walletClient: ', walletClient)
            console.log('pendingWalletAuth: ', pendingWalletAuth)
            console.log('walletClient isnt available or we are wallet auth is complete')
            return;
        } 

        try {
          console.log('Wallet client available, authenticating...');
          const litClient = await createLitClient({ network: nagaDev });
          setlitClient(litClient);
        
          console.log('Authenticating with Lit...');
          const authData = await WalletClientAuthenticator.authenticate(walletClient);
          setAuthData(authData);

          console.log('authenticated with user wallet. Retrieving PKPs.')
        
          const result = await litClient.viewPKPsByAuthData({
            authData,
            pagination: {
              limit: 5,
              offset: 0,
            }
          });

          console.log('received pkp list: ', result);

          setPkpList(result.pkps);
          setIsChoosingPkp(true);
          setInitialized(true);
        } catch (err) {
          console.error('Authentication error:', err);
          setAuthMethod('none');
          setInitialized(false);
          setIsChoosingPkp(false);
        } finally {
          setPendingWalletAuth(false);
        }
      };

      authenticateWallet();
    }, [walletClient, pendingWalletAuth]);

    const handleSSOSignIn = async (provider: 'google' | 'apple') => {
    
        didUserReject.current = false;
        setSsoLoading(true);
        setSsoError(null);
        setAuthMethod('sso');
        
        try {
          // Replace with your actual SSO implementation
          const authenticate = await GoogleAuthenticator.authenticate('https://login.litgateway.com');
          console.log(`Signing in with ${provider}`);
        } catch (err) {
          setSsoError(err instanceof Error ? err.message : 'SSO sign-in failed');
          setAuthMethod('none');
        } finally {
          setSsoLoading(false);
        }
      };
    
    const handleWalletConnect = (connector: typeof connectors[0]) => {
      setAuthMethod('wallet');
      didUserReject.current = false;
      setPendingWalletAuth(true);
      console.log('Connecting with connector:', connector.name);
      try {
        connect({ connector });
      } catch {

        console.log("there was an error trying to connect")

      }

    };

    const handlePkpCreate = async() => {

        if(!litClient || !authData || !walletClient) {
            console.log("the litClient, walletClient, or auth data was empty")
            return
        } else {
        console.log('going to mint a PKP for', walletClient.account)
        try {

        const mintedPkpWithEoaAuth = await litClient.mintWithAuth({
            account: walletClient,
            authData: authData,
            scopes: ['sign-anything'],
        })
        console.log('created a pkp I think: ', mintedPkpWithEoaAuth);

        handlePkpSelect(mintedPkpWithEoaAuth)

        } catch {
            console.log("something went wrong when trying to mint a Pkp")
        }

    };
    }

    const handlePkpSelect = async (pkp: any) => {
        console.log("selected pkp account: ", pkp);
        const authContext = await authManager.createPkpAuthContext({
            authData: authData,
            pkpPublicKey: pkp.pubkey,
            authConfig: {
              resources: [
                ["pkp-signing", "*"],
                ["lit-action-execution", "*"],
              ],
              expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
              statement: "",
              domain: window.location.origin,
            },
            litClient,
        });

        setAuthContext(authContext);

        const pkpAccount = await litClient?.getPkpViemAccount({
            pkpPublicKey: pkp.pubkey,
            authContext: authContext,
            chainConfig: viemChainConfig
        })
        setViemWalletClient(pkpAccount);
        setIsChoosingPkp(false);
    }


    if (!hasMounted) {
      return (
        <div className="loading-container">
          <div className="spinner"></div>
          <p className="loading-text">Getting Things Ready...</p>
        </div>
      );
    }
    
    if (!initialized) {
        return (
          <div className="screen-container">
            <div className="content-wrapper">
              <div className="space-y-8 max-w-md mx-auto">
                {/* Header */}
                <div className="text-center">
                  <div className="icon-lg mb-4">🔐</div>
                  <h1 className="section-title">Welcome to your Web3 Vault</h1>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Choose how you'd like to sign in
                  </p>
                </div>

                {/* Error display */}
                {(ssoError || (error && didUserReject.current)) && (
                  <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                    <p className="text-sm text-red-600">
                      {ssoError || 'Connection was rejected. Please try again.'}
                    </p>
                  </div>
                )}

                {/* SSO Options */}
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                    Continue with
                  </p>

                  <button
                    onClick={() => handleSSOSignIn('google')}
                    disabled={ssoLoading}
                    className="w-full p-4 flex items-center justify-center gap-3 border rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t" style={{ borderColor: 'var(--border-color, #e5e7eb)' }}></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase" style = {{borderColor: 'var(--border-color, #e5e7eb'}} >
                    <span className="px-2 bg-black" style={{ color: 'var(--text-secondary) var(--border-color, #e5e7eb)' }}>
                      Or connect wallet
                    </span>
                  </div>
                </div>

                {/* Wallet Options */}
                <div className="space-y-3">
                  {walletConnectors.map((connector) => (
                    <button
                      key={connector.id}
                      onClick={() => handleWalletConnect(connector)}
                      disabled={connectStatus === 'pending'}
                      className="w-full p-4 flex items-center justify-center gap-3 border rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      {connector.icon ? (
                        <img 
                          src={connector.icon} 
                          alt={`${connector.name} icon`}
                          className="w-5 h-5"
                        />
                      ) : (
                        <span className="text-xl"></span>
                      )}
                      <span>{connector.name}</span>
                    </button>
                  ))}
                </div>

                {/* Footer */}
                <p className="text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                  By signing in, you agree to our{' '}
                  <a href="/terms" className="underline hover:no-underline">Terms of Service</a>
                  {' '}and{' '}
                  <a href="/privacy" className="underline hover:no-underline">Privacy Policy</a>
                </p>
              </div>
            </div>
          </div>
        );
    }
if (isChoosingPkp) {
  return (
    <div className="screen-container">
      <div className="content-wrapper">
        <div className="space-y-8 max-w-md mx-auto">
          {/* Header */}
          <div className="text-center">
            <div className="icon-lg mb-4">🔑</div>
            <h1 className="section-title">Select a PKP</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Choose an existing PKP or create a new one
            </p>
          </div>

          {/* PKP List or Empty State */}
          <div className="space-y-3">
            <p className="form-label">Your PKPs</p>
            
            {pkpList && pkpList.length > 0 ? (
              <div className="space-y-2">
                {pkpList.map((pkp, index) => (
                  <button
                    key={pkp.tokenId || index}
                    onClick={() => handlePkpSelect(pkp)}
                    className="secret-item"
                  >
                    <div className="secret-item-label">
                      {pkp.ethAddress 
                        ? `${pkp.ethAddress.slice(0, 6)}...${pkp.ethAddress.slice(-4)}`
                        : `PKP ${index + 1}`
                      }
                    </div>
                    {pkp.tokenId && (
                      <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                        Token ID: {pkp.tokenId.toString().slice(0, 8)}...
                      </p>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="vault-empty">
                No PKPs found for this account
              </div>
            )}
          </div>

          {/* Create PKP Button - Always visible */}
          <div className="space-y-3">
            <button 
              onClick={() => handlePkpCreate()}
              className="btn-primary"
            >
              Create New PKP
            </button>
            
            <button 
              onClick={() => {
                setIsChoosingPkp(false);
                setInitialized(false);
                setAuthMethod('none');
              }}
              className="btn-secondary"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

    return (
        <LitContext.Provider
          value={{ litClient, authManager, authContext, authMethod, initialized, authData, viemWalletClient }}
        >
          {children}
        </LitContext.Provider>
    )

}


export function useLit() {
  const context = useContext(LitContext);
  if (!context) {
    throw new Error('useLit must be used within a LitContextProvider');
  }
  return context;
}



