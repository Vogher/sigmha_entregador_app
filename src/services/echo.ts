import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { API_BASE_URL, api } from './api';

// Hack para compatibilidade com React Native
// @ts-ignore
window.Pusher = Pusher;

// IMPORTANT: Use only the PUBLIC key (before the colon)
// Full key: Hm7fZw.JrHMxA:0UTUBwxOI1Hxr5O2Lbg45Xhwz0O4Ux6WyLCfbzPcqqA
// Public key only: Hm7fZw.JrHMxA
const ABLY_PUBLIC_KEY = "Hm7fZw.JrHMxA";

let currentToken: string | null = null;
let echoInstance: Echo | null = null;
let isInitialized = false;

/**
 * Inicializa Echo com a configuração correta
 * IMPORTANTE: Só inicializa quando há um token válido
 */
export const initializeEcho = (token: string) => {
  if (echoInstance && isInitialized) {
    console.log('[Echo] Already initialized');
    return echoInstance;
  }

  currentToken = token;
  console.log('[Echo] Creating new Echo instance with token:', token.substring(0, 30) + '...');

  try {
    echoInstance = new Echo({
      broadcaster: 'pusher',
      key: ABLY_PUBLIC_KEY, // Use ONLY the public key part
      wsHost: 'realtime-pusher.ably.io',
      wsPort: 443,
      disableStats: true,
      encrypted: true,
      cluster: 'mt1',
      enabledTransports: ['ws', 'wss'],
      auth: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      authorizer: (channel, options) => {
        return {
          authorize: async (socketId: string, callback: any) => {
            try {
              console.log('[Echo] Authorizing channel:', channel.name, 'socketId:', socketId);
              console.log('[Echo] Current token:', currentToken?.substring(0, 30) + '...');
              
              // Extract the clean channel name without "private-" prefix
              let channelNameForAuth = channel.name;
              if (channelNameForAuth.startsWith('private-')) {
                channelNameForAuth = channelNameForAuth.substring('private-'.length);
              }
              
              console.log('[Echo] Sending auth request with channel_name:', channelNameForAuth);
              console.log('[Echo] Auth endpoint:', API_BASE_URL + '/broadcasting/auth');
              
              // Make direct API call to /broadcasting/auth with the token in headers
              const response = await api.post('/broadcasting/auth', {
                socket_id: socketId,
                channel_name: `private-${channelNameForAuth}`, // Ably format: private-courier.17
              }, {
                headers: {
                  Authorization: `Bearer ${currentToken}`,
                },
              });
              console.log('[Echo] ✅ Authorization successful for', channel.name);
              console.log('[Echo] Auth response:', response.data);
              callback(null, response.data);
            } catch (error: any) {
              console.error('[Echo] ❌ Authorization failed for', channel.name);
              console.error('[Echo] Request was to:', API_BASE_URL + '/broadcasting/auth');
              console.error('[Echo] With token:', currentToken?.substring(0, 30) + '...');
              console.error('[Echo] Error status:', error?.response?.status);
              console.error('[Echo] Error message:', error?.response?.data?.message);
              console.error('[Echo] Full error:', error?.response?.data);
              callback(error);
            }
          },
        };
      },
    });

    isInitialized = true;
    console.log('[Echo] ✅ Echo instance created and initialized');

    // Monitor connection
    const connector = (echoInstance as any).connector;
    const pusher = connector?.pusher;

    if (pusher?.connection) {
      pusher.connection.bind('connected', () => {
        console.log('[Echo] 🟢 WebSocket CONNECTED');
      });

      pusher.connection.bind('error', (error: any) => {
        console.error('[Echo] 🔴 WebSocket ERROR:', error);
      });

      pusher.connection.bind('failed', (error: any) => {
        console.error('[Echo] 🔴 WebSocket FAILED:', error);
      });

      pusher.connection.bind('unavailable', () => {
        console.error('[Echo] 🔴 WebSocket UNAVAILABLE');
      });

      pusher.connection.bind('disconnected', () => {
        console.log('[Echo] 🟡 WebSocket DISCONNECTED');
      });
    }

    return echoInstance;
  } catch (error) {
    console.error('[Echo] ❌ Failed to initialize:', error);
    isInitialized = false;
    throw error;
  }
};

export const getEcho = (): Echo | null => {
  if (!echoInstance || !isInitialized) {
    console.warn('[Echo] Echo not initialized. Call initializeEcho(token) first.');
    return null;
  }
  return echoInstance;
};

// Don't export echo directly - force calling initializeEcho first
// export const echo = getEcho();

export const configureEcho = (token?: string | null): Echo | null => {
  if (!token) {
    console.warn('[Echo] No token provided to configureEcho');
    return null;
  }
  
  console.log('[Echo] configureEcho called with token:', token.substring(0, 20) + '...');
  return initializeEcho(token);
};

/**
 * Log event data in a formatted way for debugging
 */
export const logEventData = (eventName: string, data: any) => {
  console.group(`[Echo Event] ${eventName}`);
  console.log('Raw Data:', data);
  console.log('Data Type:', typeof data);
  console.log('Data Keys:', Object.keys(data || {}));
  console.log('Data JSON:', JSON.stringify(data, null, 2));
  console.log('Timestamp:', new Date().toISOString());
  console.groupEnd();
};

/**
 * Diagnose Echo connection status
 */
export const diagnoseEchoConnection = () => {
  console.group('[Echo Diagnosis] Connection Status');
  console.log('Current Token:', currentToken ? 'SET' : 'NOT SET');
  console.log('Echo Instance:', echoInstance ? 'INITIALIZED' : 'NOT INITIALIZED');
  
  if (echoInstance) {
    const connector = (echoInstance as any).connector;
    console.log('Connector Type:', connector?.constructor?.name || 'UNKNOWN');
    
    // Check Pusher/Ably connection
    const pusher = connector?.pusher;
    if (pusher) {
      console.log('Pusher/Ably Connection State:', (pusher as any).connection?.state || 'UNKNOWN');
      console.log('Pusher/Ably Ready:', (pusher as any).ready || false);
      console.log('Pusher/Ably Channels:', Object.keys((pusher as any).channels || {}));
    }
    
    // Check subscribed channels
    const channels = (echoInstance as any).channels || {};
    console.log('Echo Channels:', Object.keys(channels));
    
    // List all channels and their state
    Object.entries(channels).forEach(([name, channel]: [string, any]) => {
      console.log(`  - ${name}:`, {
        subscribed: channel?.subscribed || false,
        state: channel?.state || 'UNKNOWN',
      });
    });
  }
  
  console.groupEnd();
};

/**
 * Monitor all WebSocket events for debugging
 */
export const enableEchoDebugMode = () => {
  if (!echoInstance) {
    console.warn('[Echo Debug] Echo not initialized yet');
    return;
  }

  const connector = (echoInstance as any).connector;
  const pusher = connector?.pusher;
  
  if (!pusher) {
    console.warn('[Echo Debug] Pusher/Ably connection not available');
    return;
  }

  console.log('[Echo Debug] Enabling debug mode for all events');

  // Listen to connection events
  pusher.connection?.bind('connected', () => {
    console.log('[Echo WebSocket] 🟢 CONNECTED');
  });

  pusher.connection?.bind('connecting', () => {
    console.log('[Echo WebSocket] 🟡 CONNECTING');
  });

  pusher.connection?.bind('disconnected', () => {
    console.log('[Echo WebSocket] 🔴 DISCONNECTED');
  });

  pusher.connection?.bind('failed', () => {
    console.log('[Echo WebSocket] ❌ FAILED');
  });

  pusher.connection?.bind('unavailable', () => {
    console.log('[Echo WebSocket] ⚠️  UNAVAILABLE');
  });
};
