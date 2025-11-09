const SessionManager = require('./src/sessionManager');

async function initializeSession(clientId = 'phone1') {
    console.log(`🚀 Initializing session: ${clientId}`);
    
    const sessionManager = new SessionManager();
    
    try {
        // Check if session already exists
        const existingStatus = sessionManager.getSessionStatus(clientId);
        if (existingStatus.exists) {
            console.log(`📱 Session ${clientId} already exists:`, existingStatus);
            if (existingStatus.ready) {
                console.log('✅ Session is ready to use!');
                return sessionManager;
            }
        }
        
        console.log(`📱 Creating new session: ${clientId}`);
        const result = await sessionManager.createSession(clientId);
        console.log('✅ Session initialized:', result.message);
        
        console.log('📱 Session is initializing. Check QR code in logs or UI at http://localhost:3001/ui');
        
        return sessionManager;
        
    } catch (error) {
        console.error('❌ Error initializing session:', error.message);
        throw error;
    }
}

// Export for use in other scripts
module.exports = initializeSession;

// Run directly if called as script
if (require.main === module) {
    const clientId = process.argv[2] || 'phone1';
    initializeSession(clientId)
        .then(sessionManager => {
            console.log('🎉 Session manager ready');
            // Keep process alive
            process.stdin.resume();
        })
        .catch(error => {
            console.error('💥 Failed to initialize:', error.message);
            process.exit(1);
        });
}