const CACHE_NAME = 'pwa-cache-v1';
const OFFLINE_URL = '/offline.html';
const DATA_CACHE_NAME = 'data-cache-v1';

// Create a queue for failed requests to be synced later
let syncQueue = [];

// IndexedDB configuration
const DB_NAME = 'sync-store';
const STORE_NAME = 'sync-queue';
const DB_VERSION = 1;

// Open or create the IndexedDB for storing sync queue
function openSyncDatabase() {
    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = event => {
                console.error('[SW] IndexedDB error:', event.target.error);
                reject('Error opening sync database');
            };
            
            request.onblocked = event => {
                console.warn('[SW] IndexedDB blocked, please close other tabs');
            };
            
            request.onsuccess = event => {
                console.log('[SW] Successfully opened IndexedDB');
                resolve(event.target.result);
            };
            
            request.onupgradeneeded = event => {
                console.log('[SW] Upgrading or creating IndexedDB');
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    console.log('[SW] Creating object store:', STORE_NAME);
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
        } catch (error) {
            console.error('[SW] Failed to open IndexedDB:', error);
            reject(error);
        }
    });
}

const HOSTNAME_WHITELIST = [
    self.location.hostname,
    'fonts.gstatic.com',
    'fonts.googleapis.com',
    'cdn.jsdelivr.net'
];

// Assets to precache
const PRECACHE_ASSETS = [
    '/IP-LAB3/index.html',
    '/IP-LAB3/offline.html',
    '/IP-LAB3/manifest.json',
    '/IP-LAB3/coder.avif'
];

// Pre-cache static assets
self.addEventListener('install', event => {
    console.log('Service Worker installing.');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Caching app shell');
                return cache.addAll(PRECACHE_ASSETS);
            })
            .catch(error => {
                console.error('Precaching failed:', error);
            })
    );
    self.skipWaiting();
});

// Activate and clean old caches
self.addEventListener('activate', event => {
    console.log('Service Worker activating.');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker now controls the page');
            return self.clients.claim();
        })
    );
});

// Fix URL for cache busting
const getFixedUrl = (req) => {
    const now = Date.now();
    const url = new URL(req.url);
    url.protocol = self.location.protocol;
    if (url.hostname === self.location.hostname) {
        url.search += (url.search ? '&' : '?') + 'cache-bust=' + now;
    }
    return url.href;
};

// Improved fetch and cache strategy
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const isAPIRequest = url.pathname.startsWith('/api');

    // Handle API requests differently
    if (isAPIRequest) {
        event.respondWith(handleAPIRequest(event));
        return;
    }

    // For non-API requests (static assets and pages)
    if (HOSTNAME_WHITELIST.includes(url.hostname)) {
        event.respondWith(
            caches.match(event.request)
                .then(cachedResponse => {
                    // If there's a cache hit, return it
                    if (cachedResponse) {
                        // Get fresh version in the background
                        fetchAndUpdateCache(event.request);
                        return cachedResponse;
                    }

                    // Otherwise try to fetch from network
                    return fetchAndUpdateCache(event.request)
                        .catch(() => {
                            // If network fails, show offline page
                            if (event.request.mode === 'navigate') {
                                return caches.match(OFFLINE_URL);
                            }
                            // For non-HTML requests, just return a simple response
                            return new Response('Offline content unavailable');
                        });
                })
        );
    }
});

// Function to fetch and update cache
function fetchAndUpdateCache(request) {
    const fixedUrl = getFixedUrl(request);
    return fetch(fixedUrl, { cache: 'no-store' })
        .then(response => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
                return response;
            }

            // Clone the response so we can add it to cache and return it
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
                .then(cache => {
                    cache.put(request, responseToCache);
                });

            return response;
        });
}

// Handle API requests with a focus on offline-first approach
async function handleAPIRequest(event) {
    const cacheName = DATA_CACHE_NAME;
    const request = event.request;

    // Try to get a match from the cache first
    const cachedResponse = await caches.match(request);
    
    // Try network and update cache
    try {
        const networkResponse = await fetch(request);
        const responseToCache = networkResponse.clone();
        
        // If successful, update cache
        if (networkResponse.ok) {
            const cache = await caches.open(cacheName);
            await cache.put(request, responseToCache);
        }
        
        return networkResponse;
    } catch (error) {
        // If we have a cached response, return it
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // If it's a POST/PUT request, queue it for later syncing
        if (request.method === 'POST' || request.method === 'PUT') {
            await addToSyncQueue(request.clone());
            return new Response(JSON.stringify({ message: 'Request queued for sync', queued: true }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // For other methods, return an error response
        return new Response(JSON.stringify({ error: 'Network unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// Add a request to the sync queue for later processing
async function addToSyncQueue(request) {
    try {
        // Clone the request to store it
        const requestData = {
            url: request.url,
            method: request.method,
            headers: Object.fromEntries(request.headers.entries()),
            credentials: request.credentials,
            timestamp: Date.now()
        };
        
        // If it has a body, store that too
        if (['POST', 'PUT'].includes(request.method)) {
            const blob = await request.blob();
            requestData.body = await blob.arrayBuffer();
        }
        
        // Store in IndexedDB
        const db = await openSyncDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const addReq = store.add(requestData);
            
            addReq.onsuccess = () => {
                console.log('Request queued for background sync');
                // Register a sync if supported
                if ('sync' in self.registration) {
                    self.registration.sync.register('sync-queue');
                }
                resolve();
            };
            
            addReq.onerror = () => {
                console.error('Error queueing request', addReq.error);
                reject(addReq.error);
            };
        });
    } catch (error) {
        console.error('Failed to queue request for sync', error);
    }
}

// Process the sync queue
async function processSyncQueue() {
    console.log('[SW] Starting to process sync queue');
    try {
        // Open the database
        const db = await openSyncDatabase();
        if (!db) {
            console.error('[SW] Failed to open database for processing sync queue');
            return;
        }
        
        // Get all queued requests
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const requests = await new Promise((resolve, reject) => {
            const getAll = store.getAll();
            getAll.onsuccess = () => resolve(getAll.result);
            getAll.onerror = (event) => {
                console.error('[SW] Error getting queued items:', event.target.error);
                reject(event.target.error);
            }
        });
        
        console.log(`[SW] Processing ${requests.length} queued requests`);
        
        if (requests.length === 0) {
            console.log('[SW] No items in sync queue');
            db.close();
            return;
        }
        
        // Process each request
        for (const requestData of requests) {
            try {
                console.log('[SW] Processing queued request:', requestData.url);
                
                // For mock endpoints, simulate success
                if (requestData.url === '/api/mock-endpoint') {
                    console.log('[SW] Mock endpoint detected, simulating successful sync');
                    console.log('[SW] Data that would be sent:', requestData.body);
                    
                    // Remove from queue
                    await new Promise((resolve, reject) => {
                        const deleteReq = store.delete(requestData.id);
                        deleteReq.onsuccess = () => {
                            console.log('[SW] Successfully removed mock request from queue');
                            resolve();
                        };
                        deleteReq.onerror = (event) => {
                            console.error('[SW] Error removing from queue:', event.target.error);
                            reject(event.target.error);
                        };
                    });
                    
                    // Continue to next request
                    continue;
                }
                
                // Recreate the request from stored data
                const requestInit = {
                    method: requestData.method,
                    headers: requestData.headers,
                    credentials: requestData.credentials
                };
                
                // Add body if present
                if (requestData.body) {
                    requestInit.body = requestData.body;
                }
                
                // Attempt to make the request
                console.log('[SW] Attempting to resend request to:', requestData.url);
                const response = await fetch(requestData.url, requestInit);
                
                if (response.ok) {
                    // Request succeeded, remove it from the queue
                    console.log('[SW] Successfully synced request:', requestData.url);
                    await new Promise((resolve, reject) => {
                        const deleteReq = store.delete(requestData.id);
                        deleteReq.onsuccess = () => resolve();
                        deleteReq.onerror = (event) => reject(event.target.error);
                    });
                } else {
                    console.warn('[SW] Failed to sync request:', response.status, response.statusText);
                }
            } catch (error) {
                console.error('[SW] Error processing queued request', error);
            }
        }
        
        // Close the database when done
        db.close();
        console.log('[SW] Completed sync queue processing');
        
    } catch (error) {
        console.error('[SW] Failed to process sync queue', error);
    }
}

// Register for Background Sync
self.addEventListener('sync', event => {
    console.log('[SW] Sync event fired:', event.tag);
    if (event.tag === 'sync-queue') {
        console.log('[SW] Processing sync-queue event');
        event.waitUntil(processSyncQueue()
            .then(() => {
                console.log('[SW] Sync completed successfully');
                
                // Broadcast a message to any open clients
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'SYNC_COMPLETED',
                            timestamp: new Date().toISOString()
                        });
                    });
                });
            })
            .catch(error => {
                console.error('[SW] Sync error:', error);
            })
        );
    }
});

// Push Notification Support
self.addEventListener('push', event => {
    console.log('Push message received:', event);
    
    let notificationData = {};
    
    try {
        notificationData = event.data.json();
    } catch (e) {
        notificationData = {
            title: 'New Notification',
            body: event.data ? event.data.text() : 'No content',
            icon: '/IP-LAB3/coder.avif'
        };
    }
    
    const options = {
        body: notificationData.body || 'No details available',
        icon: notificationData.icon || '/IP-LAB3/coder.avif',
        badge: '/IP-LAB3/coder.avif',
        vibrate: [100, 50, 100],
        data: {
            url: notificationData.url || '/IP-LAB3/index.html',
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            { action: 'explore', title: 'View' },
            { action: 'close', title: 'Close' }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(notificationData.title, options)
    );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
    console.log('Notification clicked:', event);
    event.notification.close();
    
    // Get the notification data
    const notification = event.notification;
    const action = event.action;
    const notificationURL = notification.data.url;
    
    // Handle different actions
    let targetURL = notificationURL;
    
    if (action === 'close') {
        return;
    }
    
    // This looks to see if any of the current windows handle the target URL
    event.waitUntil(
        self.clients.matchAll({ type: 'window' })
            .then(windowClients => {
                // Check if there's already a window/tab open with the target URL
                for (let client of windowClients) {
                    // If so, focus it
                    if (client.url === targetURL && 'focus' in client) {
                        return client.focus();
                    }
                }
                
                // If not, open a new window/tab
                if (self.clients.openWindow) {
                    return self.clients.openWindow(targetURL);
                }
            })
    );
});
