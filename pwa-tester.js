// PWA Feature Testing Script

// Wait for DOM content to load
document.addEventListener('DOMContentLoaded', () => {
    // Check if service worker is supported
    if ('serviceWorker' in navigator) {
        console.log('Service Worker is supported');
        initPwaFeatures();
    } else {
        console.error('Service Worker not supported in this browser');
        document.getElementById('pwa-status').textContent = 'Service Worker not supported in this browser';
    }
});

// Initialize PWA features
function initPwaFeatures() {
    // Register service worker if not already registered
    if (!navigator.serviceWorker.controller) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
                document.getElementById('pwa-status').textContent = 'Service Worker registered successfully!';
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
                document.getElementById('pwa-status').textContent = 'Service Worker registration failed!';
            });
    } else {
        console.log('Service Worker already controlling the page');
        document.getElementById('pwa-status').textContent = 'Service Worker already active';
    }

    // Set up network status listeners
    setupNetworkListeners();
    
    // Set up service worker message listeners
    setupServiceWorkerMessages();

    // Set up event listeners for testing buttons
    setupTestButtons();
    
    // Display network status
    updateNetworkStatus();
}

// Update the network status display
function updateNetworkStatus() {
    const statusEl = document.getElementById('pwa-status');
    if (statusEl) {
        const status = navigator.onLine ? 'online' : 'offline';
        statusEl.textContent = `Service Worker active and your device is ${status}`;
    }
}

// Set up event listeners for online/offline events
function setupNetworkListeners() {
    // Process pending requests when coming back online
    window.addEventListener('online', function() {
        console.log('Device is now online, processing pending requests...');
        processIndexedDBSyncRequests();
        
        // Also try to register a sync event with the service worker
        navigator.serviceWorker.ready.then(registration => {
            if ('sync' in registration) {
                registration.sync.register('sync-queue').then(() => {
                    console.log('Background sync registered after coming online');
                }).catch(err => {
                    console.error('Error registering sync after coming online:', err);
                });
            }
        });
    });
    
    // Display a notification when going offline
    window.addEventListener('offline', function() {
        console.log('Device is now offline, requests will be queued');
        const statusEl = document.getElementById('pwa-status');
        if (statusEl) {
            statusEl.textContent = 'You are offline. Requests will be queued until you reconnect.';
        }
    });
}

// Set up buttons for testing PWA features
function setupTestButtons() {
    // Test offline functionality
    document.getElementById('test-offline').addEventListener('click', testOfflineCapability);
    
    // Test background sync
    document.getElementById('test-sync').addEventListener('click', testBackgroundSync);
    
    // Test push notifications
    document.getElementById('test-push').addEventListener('click', testPushNotification);
}

// Test offline capability
function testOfflineCapability() {
    const statusEl = document.getElementById('fetch-status');
    statusEl.textContent = 'Testing offline capability...';
    
    // Create a timestamp to avoid caching
    const timestamp = new Date().getTime();
    
    // Fetch a resource
    fetch(`/index.html?cache-bust=${timestamp}`)
        .then(response => {
            if (response.ok) {
                statusEl.textContent = 'Successfully fetched content! Now try turning off your network.';
                statusEl.style.color = 'green';
            } else {
                statusEl.textContent = `Fetch failed with status: ${response.status}`;
                statusEl.style.color = 'red';
            }
        })
        .catch(error => {
            // If offline, this will show "Failed to fetch"
            if (error.message.includes('fetch')) {
                statusEl.textContent = 'You are offline, but the page is still available thanks to service worker!';
                statusEl.style.color = 'blue';
            } else {
                statusEl.textContent = `Error: ${error.message}`;
                statusEl.style.color = 'red';
            }
        });
}

// Test background sync
function testBackgroundSync() {
    const statusEl = document.getElementById('sync-status');
    statusEl.textContent = 'Testing background sync with IndexedDB...';
    
    // Get data from input
    const syncData = document.getElementById('sync-data').value || 'Default test data';
    
    // Create a timestamp for the request
    const timestamp = new Date().toISOString();
    const requestData = { data: syncData, timestamp: timestamp };
    
    // Open IndexedDB directly in the page context
    const dbName = 'backgroundSyncDB';
    const storeName = 'syncRequests';
    const dbVersion = 1;
    
    // First check if we can access IndexedDB
    if (!window.indexedDB) {
        statusEl.textContent = 'IndexedDB not supported in this browser!';
        statusEl.style.color = 'red';
        return;
    }
    
    statusEl.textContent = 'Opening IndexedDB...';
    
    // Open (and create if needed) the database
    const request = indexedDB.open(dbName, dbVersion);
    
    request.onerror = function(event) {
        console.error('Error opening IndexedDB:', event.target.error);
        statusEl.textContent = `IndexedDB Error: ${event.target.error.message || 'Access denied'}`;
        statusEl.style.color = 'red';
    };
    
    request.onblocked = function() {
        statusEl.textContent = 'IndexedDB blocked. Close other tabs with this site open.';
        statusEl.style.color = 'orange';
    };
    
    request.onupgradeneeded = function(event) {
        console.log('Creating or upgrading database...');
        const db = event.target.result;
        
        // Create an object store if it doesn't exist
        if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
            console.log('Created object store:', storeName);
        }
    };
    
    request.onsuccess = function(event) {
        const db = event.target.result;
        console.log('Successfully opened database!');
        statusEl.textContent = 'Successfully opened IndexedDB!'; 
        
        try {
            // Start a transaction
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            // Define request object (for mock purposes)
            const mockRequest = {
                url: '/api/test-endpoint',
                method: 'POST',
                body: JSON.stringify(requestData),
                timestamp: Date.now()
            };
            
            // Add to IndexedDB
            const addRequest = store.add(mockRequest);
            
            addRequest.onsuccess = function() {
                console.log('Successfully stored sync request in IndexedDB!');
                
                // Update UI based on network status
                if (navigator.onLine) {
                    // Process immediately if online, but don't remove data so user can inspect it
                    statusEl.textContent = 'Online: Request stored in IndexedDB successfully!'; 
                    statusEl.style.color = 'green';
                    
                    // Tell user how to view the data
                    console.log('%c HOW TO VIEW INDEXED DB DATA ', 'background: #222; color: #bada55; font-size: 16px;');
                    console.log('1. Open DevTools (F12)');
                    console.log('2. Go to Application tab');
                    console.log('3. Expand "IndexedDB" in the left sidebar');
                    console.log('4. Click on "backgroundSyncDB"');
                    console.log('5. Click on "syncRequests" to see your stored data');
                    
                    // Add message to UI
                    const viewInstructions = document.createElement('div');
                    viewInstructions.innerHTML = '<p class="mt-3">To view stored data: Open DevTools (F12) → Application tab → IndexedDB → backgroundSyncDB → syncRequests</p>';
                    statusEl.parentNode.appendChild(viewInstructions);
                    
                    // Don't trigger sync immediately to allow inspection
                    setTimeout(() => {
                        // Trigger background sync after delay
                        navigator.serviceWorker.ready
                            .then(registration => {
                                if ('sync' in registration) {
                                    return registration.sync.register('sync-queue');
                                }
                                throw new Error('Background Sync not supported');
                            })
                            .then(() => {
                                const processingMsg = document.createElement('p');
                                processingMsg.textContent = 'Sync registered! Data will be processed shortly.';
                                processingMsg.style.color = 'blue';
                                statusEl.parentNode.appendChild(processingMsg);
                            })
                            .catch(error => {
                                statusEl.textContent = `Sync registration error: ${error.message}`;
                                statusEl.style.color = 'red';
                            });
                    }, 10000); // Wait 10 seconds before processing
                } else {
                    // Queue for later if offline
                    statusEl.textContent = 'Offline: Request stored in IndexedDB for later sync!'; 
                    statusEl.style.color = 'orange';
                }
            };
            
            addRequest.onerror = function(event) {
                console.error('Error adding item to IndexedDB:', event.target.error);
                statusEl.textContent = `Error storing data: ${event.target.error.message}`;
                statusEl.style.color = 'red';
            };
            
            // Close transaction when done
            transaction.oncomplete = function() {
                console.log('Transaction completed');
                db.close();
            };
            
            transaction.onerror = function(event) {
                console.error('Transaction error:', event.target.error);
                statusEl.textContent = `Transaction error: ${event.target.error.message}`;
                statusEl.style.color = 'red';
            };
            
        } catch (error) {
            console.error('Error during IndexedDB operations:', error);
            statusEl.textContent = `Error: ${error.message || error}`;
            statusEl.style.color = 'red';
            db.close();
        }
    };
}

// Process IndexedDB sync requests (used in online mode or when browser comes back online)
function processIndexedDBSyncRequests() {
    const statusEl = document.getElementById('sync-status');
    const dbName = 'backgroundSyncDB';
    const storeName = 'syncRequests';
    
    try {
        // Open the database
        const openRequest = indexedDB.open(dbName, 1);
        
        openRequest.onerror = function(event) {
            console.error('Error opening IndexedDB for processing:', event.target.error);
            if (statusEl) {
                statusEl.textContent = `Error accessing IndexedDB: ${event.target.error.message}`;
                statusEl.style.color = 'red';
            }
        };
        
        openRequest.onsuccess = function(event) {
            const db = event.target.result;
            console.log('Successfully opened database for processing');
            
            try {
                // Get all sync requests
                const transaction = db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const getAllRequest = store.getAll();
                
                getAllRequest.onsuccess = function() {
                    const requests = getAllRequest.result;
                    
                    if (requests.length === 0) {
                        console.log('No sync requests to process');
                        if (statusEl) {
                            statusEl.textContent = 'No pending requests to process';
                        }
                        db.close();
                        return;
                    }
                    
                    console.log(`Processing ${requests.length} sync requests from IndexedDB`);
                    
                    // Process each request
                    requests.forEach(request => {
                        console.log('Would process request:', request);
                        console.log('Request data:', JSON.parse(request.body));
                        
                        // In a real app, you would make the network request here
                        // For demo purposes, we'll keep the data and just mark it as processed
                        // by adding a 'processed' flag instead of deleting it
                        const updateRequest = store.put({
                            ...request,
                            processed: true,
                            processedAt: new Date().toISOString()
                        });
                        
                        updateRequest.onsuccess = function() {
                            console.log(`Marked request ${request.id} as processed (but kept in DB for inspection)`);
                        };
                    });
                    
                    // Update UI when done
                    if (statusEl) {
                        statusEl.textContent = `Successfully processed ${requests.length} requests!`;
                        statusEl.style.color = 'green';
                    }
                    
                    // Show notification
                    if ('Notification' in window && Notification.permission === 'granted') {
                        navigator.serviceWorker.ready.then(registration => {
                            registration.showNotification('Sync Complete', {
                                body: `${requests.length} requests processed successfully`,
                                icon: '/coder.avif'
                            });
                        });
                    }
                };
                
                getAllRequest.onerror = function(event) {
                    console.error('Error getting sync requests:', event.target.error);
                    if (statusEl) {
                        statusEl.textContent = `Error retrieving requests: ${event.target.error.message}`;
                        statusEl.style.color = 'red';
                    }
                };
                
                transaction.oncomplete = function() {
                    console.log('Processing transaction completed');
                    db.close();
                };
                
            } catch (error) {
                console.error('Error in processing transaction:', error);
                if (statusEl) {
                    statusEl.textContent = `Processing error: ${error.message}`;
                    statusEl.style.color = 'red';
                }
                db.close();
            }
        };
        
    } catch (error) {
        console.error('Error in processIndexedDBSyncRequests:', error);
        if (statusEl) {
            statusEl.textContent = `Error: ${error.message || error}`;
            statusEl.style.color = 'red';
        }
    }
}

// Listen for messages from the service worker
function setupServiceWorkerMessages() {
    navigator.serviceWorker.addEventListener('message', function(event) {
        console.log('Received message from service worker:', event.data);
        
        // Handle sync completed messages
        if (event.data && event.data.type === 'SYNC_COMPLETED') {
            const statusEl = document.getElementById('sync-status');
            if (statusEl) {
                statusEl.textContent = 'Background sync completed successfully!';
                statusEl.style.color = 'green';
            }
        }
    });
}

// Test push notifications
function testPushNotification() {
    const statusEl = document.getElementById('push-status');
    statusEl.textContent = 'Testing push notifications...';
    
    // First check if notifications are supported
    if (!('Notification' in window)) {
        statusEl.textContent = 'Notifications not supported in this browser';
        statusEl.style.color = 'red';
        return;
    }
    
    // Check current permission status
    if (Notification.permission === 'denied') {
        statusEl.textContent = 'Notification permission previously denied. Please enable notifications in your browser settings.';
        statusEl.style.color = 'red';
        
        // Show instructions for enabling notifications
        const instructions = document.createElement('div');
        instructions.innerHTML = `
            <div class="alert alert-warning mt-2">
                <p><strong>How to enable notifications:</strong></p>
                <ol>
                    <li>Click the lock/info icon in your browser's address bar</li>
                    <li>Find "Notifications" in the site settings</li>
                    <li>Change it from "Block" to "Allow"</li>
                    <li>Refresh the page and try again</li>
                </ol>
            </div>
        `;
        statusEl.parentNode.appendChild(instructions);
        return;
    }
    
    // Request permission if not already granted
    if (Notification.permission !== 'granted') {
        statusEl.textContent = 'Requesting notification permission...';
        statusEl.style.color = 'blue';
        
        // Show a prompt explaining why we need notification permission
        const permissionPrompt = document.createElement('div');
        permissionPrompt.innerHTML = `
            <div class="alert alert-info mt-2">
                <p><strong>Browser permission dialog incoming!</strong></p>
                <p>Please click "Allow" in the browser permission dialog that appears.</p>
            </div>
        `;
        statusEl.parentNode.appendChild(permissionPrompt);
        
        // Request permission
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                permissionPrompt.remove(); // Remove the prompt
                sendTestNotification(statusEl);
            } else {
                statusEl.textContent = 'Notification permission denied';
                statusEl.style.color = 'red';
            }
        });
    } else {
        sendTestNotification(statusEl);
    }
}

// Send a test notification
function sendTestNotification(statusEl) {
    // Get data from input
    const notificationTitle = document.getElementById('notification-title').value || 'Test Notification';
    const notificationBody = document.getElementById('notification-body').value || 'This is a test notification from your PWA';
    
    // Show a direct notification first to verify permissions
    try {
        const directNotification = new Notification('Permission Test', {
            body: 'Testing if notifications work directly',
            icon: '/coder.avif'
        });
        
        console.log('Direct notification created:', directNotification);
        statusEl.textContent = 'Direct notification sent successfully!';
        statusEl.style.color = 'green';
        
        // Close the direct notification after 3 seconds
        setTimeout(() => {
            directNotification.close();
        }, 3000);
    } catch (error) {
        console.error('Error showing direct notification:', error);
        statusEl.textContent = `Direct notification error: ${error.message}`;
        statusEl.style.color = 'red';
        return;
    }
    
    // Continue with service worker notification
    statusEl.textContent = 'Now trying service worker notification...';
    
    navigator.serviceWorker.ready.then(registration => {
        // Define notification options
        const notificationOptions = {
            body: notificationBody,
            icon: '/coder.avif',
            badge: '/coder.avif',
            vibrate: [100, 50, 100],
            requireInteraction: true, // Keep notification visible until user interacts with it
            data: {
                url: window.location.href,
                dateOfArrival: Date.now()
            },
            actions: [
                { action: 'explore', title: 'View' },
                { action: 'close', title: 'Close' }
            ]
        };
        
        console.log('Showing notification with options:', notificationOptions);
        
        // Show the notification through service worker
        registration.showNotification(notificationTitle, notificationOptions)
            .then(() => {
                statusEl.textContent = 'Both notifications sent successfully!';
                statusEl.style.color = 'green';
                
                const notificationInfo = document.createElement('div');
                notificationInfo.innerHTML = `
                    <div class="alert alert-success mt-2">
                        <p><strong>Notification sent!</strong></p>
                        <p>If you don't see it, check:</p>
                        <ol>
                            <li>Browser notification settings</li>
                            <li>Windows notification settings</li>
                            <li>Focus mode or Do Not Disturb settings</li>
                        </ol>
                    </div>
                `;
                statusEl.parentNode.appendChild(notificationInfo);
            })
            .catch(error => {
                console.error('Service worker notification error:', error);
                statusEl.textContent = `Service worker notification error: ${error.message}`;
                statusEl.style.color = 'red';
            });
    }).catch(error => {
        console.error('Error getting service worker registration:', error);
        statusEl.textContent = `Service worker error: ${error.message}`;
        statusEl.style.color = 'red';
    });
}
